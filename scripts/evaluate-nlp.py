#!/usr/bin/env python3
"""Calibrate/evaluate the actual packaged JSONL helper. Never logs user inputs.
The input corpus is the explicitly public CC0 fixture, not an application database.
"""
import argparse
import json
import math
import struct
import subprocess
import time
from pathlib import Path

def float32(value):
    return struct.unpack('<f',struct.pack('<f',value))[0]

def dot_float32(left,right):
    # Match Rust's f32 multiply followed by its sequential Iterator::sum, including
    # rounding at each step. f64 Python summation shifts near-threshold decisions.
    total=0.0
    for a,b in zip(left,right):total=float32(total+float32(a*b))
    return total

def next_float32(value):
    bits = struct.unpack('<I',struct.pack('<f',value))[0]
    return struct.unpack('<f',struct.pack('<I',bits+1 if value>=0 else bits-1))[0]

def metrics(rows, threshold):
    related = [row for row in rows if row['relevant']]
    unrelated = [row for row in rows if not row['relevant']]
    recalls=[]
    for row in related:
        found={memory for score,memory in row['scores'][:5] if score >= threshold}
        recalls.append(len(found.intersection(row['relevant']))/len(row['relevant']))
    false=sum(bool(row['scores'] and row['scores'][0][0]>=threshold) for row in unrelated)
    return {'recallAt5':sum(recalls)/len(recalls) if recalls else 0,
            'unrelatedFalsePositiveRate':false/len(unrelated) if unrelated else 0,
            'relatedQueries':len(related),'unrelatedQueries':len(unrelated),'falsePositives':false}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--helper',type=Path,required=True)
    parser.add_argument('--runtime',type=Path,required=True)
    parser.add_argument('--model',type=Path,required=True)
    parser.add_argument('--fixture',type=Path,default=Path('nlp/fixtures/korean-retrieval.json'))
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--manifest',type=Path)
    parser.add_argument('--kiwi',type=Path)
    parser.add_argument('--export-vectors',type=Path)
    args=parser.parse_args()
    fixture=json.loads(args.fixture.read_text())
    started=time.perf_counter()
    process=subprocess.Popen([str(args.helper.resolve()),'--runtime',str(args.runtime.resolve()),'--semantic',str(args.model.resolve()),*(['--kiwi',str(args.kiwi.resolve())] if args.kiwi else [])],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
    try:
        ready=json.loads(process.stdout.readline())
        cold=time.perf_counter()-started
        if not ready.get('semantic'): raise RuntimeError(f'Embedding model failed to initialize: {ready}')
        sequence=0;latencies=[]; analyses={}
        def encode(text,operation):
            nonlocal sequence
            sequence+=1
            start=time.perf_counter()
            process.stdin.write(json.dumps({'version':1,'id':sequence,'operation':operation,'text':text},ensure_ascii=False)+'\n');process.stdin.flush()
            response=json.loads(process.stdout.readline())
            latencies.append((time.perf_counter()-start)*1000)
            if response['id']!=sequence or response.get('error'): raise RuntimeError('Native embedding request failed')
            analyses[(text,operation)]=response['result']
            return [[float32(value) for value in row['vector']] for row in response['result']['embeddings']]
        memories={row['id']:encode(row['content'],'index') for row in fixture['memories']}
        rows=[]
        for query in fixture['queries']:
            vector=encode(query['text'],'query')[0]
            scores=sorted([(max(dot_float32(vector,window) for window in windows),key) for key,windows in memories.items()],key=lambda item:(-item[0],item[1]))
            rows.append({'id':query['id'],'split':query['split'],'relevant':query['relevant'],'scores':scores})
        calibration=[row for row in rows if row['split']=='calibration']; evaluation=[row for row in rows if row['split']=='evaluation']
        candidates={0.,1.}
        for row in calibration:
            for score,_ in row['scores']:
                candidates.add(score);candidates.add(next_float32(score))
        candidates=[threshold for threshold in candidates if metrics(calibration,threshold)['unrelatedFalsePositiveRate']<=0.05]
        threshold=max(candidates,key=lambda t:(metrics(calibration,t)['recallAt5'],t))
        calibrated=metrics(calibration,threshold);evaluated=metrics(evaluation,threshold)
        gate=calibrated['recallAt5']>=0.9 and evaluated['recallAt5']>=0.9 and evaluated['unrelatedFalsePositiveRate']<=0.05
        timings=sorted(latencies)
        report={'schema':1,'scoring':'f32 product and sequential f32 sum, matching Rust store','fixture':str(args.fixture),'threshold':threshold,'releaseQualityGate':gate,
                'calibration':calibrated,'evaluation':evaluated,'coldStartSeconds':cold,
                'nativeRequestP50Ms':timings[len(timings)//2],'nativeRequestP95Ms':timings[math.ceil(len(timings)*.95)-1],
                'limitations':['Public fixture is small and synthetic.','Latency is this host/helper only, not reference Windows performance.'],
                'queries':[{'id':row['id'],'split':row['split'],'relevant':row['relevant'],'top5':[{'id':key,'score':score} for score,key in row['scores'][:5]]} for row in rows]}
        args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,indent=2,ensure_ascii=False)+'\n')
        if args.export_vectors:
            exported={'threshold':threshold,
                      'memories':[{**row,'analysis':analyses[(row['content'],'index')]} for row in fixture['memories']],
                      'queries':[{**row,'analysis':analyses[(row['text'],'query')]} for row in fixture['queries']]}
            args.export_vectors.write_text(json.dumps(exported,ensure_ascii=False)+'\n')
        if args.manifest and gate:
            manifest=json.loads(args.manifest.read_text());manifest['threshold']=threshold
            args.manifest.write_text(json.dumps(manifest,indent=2)+'\n')
        print(json.dumps({key:value for key,value in report.items() if key!='queries'},indent=2))
    finally:
        process.stdin.close()
        try: process.wait(timeout=5)
        except subprocess.TimeoutExpired: process.kill();process.wait(timeout=5)

if __name__=='__main__':main()
