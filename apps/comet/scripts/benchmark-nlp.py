#!/usr/bin/env python3
"""Measure a release helper on public fixtures; never label these as reference-device results."""
import argparse,hashlib,json,os,platform,subprocess,threading,time
from pathlib import Path

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['helper','runtime','kiwi','semantic','output']:parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args();rss=[];stop=threading.Event()
    started=time.perf_counter()
    process=subprocess.Popen([str(args.helper.resolve()),'--runtime',str(args.runtime.resolve()),'--kiwi',str(args.kiwi.resolve()),'--semantic',str(args.semantic.resolve())],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
    def sample():
        while not stop.is_set():
            sample=subprocess.run(['ps','-o','rss=','-p',str(process.pid)],capture_output=True,text=True)
            if sample.stdout.strip():rss.append(int(sample.stdout.strip())*1024)
            stop.wait(.05)
    thread=threading.Thread(target=sample,daemon=True);thread.start()
    try:
        ready=json.loads(process.stdout.readline());cold=time.perf_counter()-started
        if not ready.get('kiwi') or not ready.get('semantic'):raise RuntimeError('Both models must be ready')
        fixture=json.loads(Path('nlp/fixtures/korean-retrieval.json').read_text());latencies=[]
        for index in range(100):
            text=fixture['queries'][index%len(fixture['queries'])]['text']
            if index>=90:text=('원문과 정정 문맥을 보존하는 긴 한국어 검색 요청이에요. 😀 '*45)[:2000]
            start=time.perf_counter()
            process.stdin.write(json.dumps({'version':1,'id':index+1,'operation':'query','text':text},ensure_ascii=False)+'\n');process.stdin.flush()
            response=json.loads(process.stdout.readline());latencies.append((time.perf_counter()-start)*1000)
            if response.get('error') or not response['result']['embeddings']:raise RuntimeError('Native inference failed')
        def cpu_seconds():
            value=subprocess.run(['ps','-o','time=','-p',str(process.pid)],capture_output=True,text=True).stdout.strip()
            parts=value.split(':');return float(parts[-1])+60*int(parts[-2])+(3600*int(parts[-3]) if len(parts)>2 else 0)
        before=cpu_seconds();idle_start=time.perf_counter();time.sleep(3);idle_seconds=time.perf_counter()-idle_start;idle_cpu=cpu_seconds()-before
        start=time.perf_counter();process.stdin.close();process.wait(timeout=5);exit_ms=(time.perf_counter()-start)*1000
        latencies.sort();report={'schema':1,'scope':'Actual release helper, public fixture queries; not Windows reference hardware',
            'host':{'platform':platform.platform(),'architecture':platform.machine(),'logicalCpu':os.cpu_count(),
            'cpu':subprocess.run(['sysctl','-n','machdep.cpu.brand_string'],capture_output=True,text=True).stdout.strip()},
            'models':['Kiwi 0.24.0 CoNg default dictionary (multi/typo disabled)','E5 CPU U8S8'],
            'helperSha256':hashlib.sha256(args.helper.read_bytes()).hexdigest(),
            'execution':{'cpuThreads':1,'sequential':True,'spinning':False,'cpuArena':False,'memoryPattern':False},
            'workload':{'publicFixtureQueries':90,'longQueriesNear2000Characters':10}, 'queries':100,'coldStartSeconds':cold,
            'nativeQueryP50Ms':latencies[50],'nativeQueryP95Ms':latencies[94], 'sampledPeakRssBytes':max(rss),
            'rssSamplingIntervalMs':50,'idleObservationSeconds':idle_seconds,'idleCpuSeconds':idle_cpu,
            'gracefulExitMs':exit_ms,'exitCode':process.returncode,
            'limitations':['RSS is sampled and can miss shorter spikes.','Does not include SQLite search/application RSS.','Does not validate the 8GB/4CPU Windows target.']}
        args.output.parent.mkdir(parents=True,exist_ok=True);args.output.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
    finally:
        stop.set();thread.join(timeout=1)
        if process.poll() is None:process.kill();process.wait(timeout=5)

if __name__=='__main__':main()
