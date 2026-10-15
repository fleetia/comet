#!/usr/bin/env python3
"""Exercise the real native executable with synthetic public text and isolated corrupt fixtures."""
import argparse,json,subprocess,tempfile
from pathlib import Path

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ['helper','runtime','kiwi','semantic']:parser.add_argument('--'+name,type=Path,required=True)
    args=parser.parse_args();completed=[]
    def scenario(name,kiwi=None,semantic=None):
        command=[str(args.helper.resolve()),'--runtime',str(args.runtime.resolve())]
        if kiwi:command.extend(['--kiwi',str(kiwi.resolve())])
        if semantic:command.extend(['--semantic',str(semantic.resolve())])
        process=subprocess.Popen(command,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,text=True)
        ready=json.loads(process.stdout.readline());sequence=0
        def request(text,operation='query',version=1):
            nonlocal sequence
            sequence+=1;process.stdin.write(json.dumps({'version':version,'id':sequence,'operation':operation,'text':text},ensure_ascii=False)+'\n');process.stdin.flush()
            response=json.loads(process.stdout.readline());assert response['id']==sequence
            return response
        try:
            assert ready['version']==1 and ready['ready']
            text='한😀e\u0301\r\n고양이는 미루예요. 커피는 안 마셔요.'
            response=request(text);assert response['error'] is None
            result=response['result'];raw=text.encode();boundaries={len(text[:i].encode()) for i in range(len(text)+1)}
            for token in result['tokens']:assert token['start'] in boundaries and token['end'] in boundaries and token['start']<=token['end']<=len(raw)
            if ready['kiwi']:assert result['tokens']
            if ready['semantic']:
                embedding=result['embeddings'][0];assert len(embedding['vector'])==384
                assert abs(sum(value*value for value in embedding['vector'])-1)<1e-4
                assert embedding['start']==0 and embedding['end']==len(raw)
                long='기억은 원문 그대로 보존하고 검색용 구간만 나눠요. 😀 '*80
                windows=request(long,'index')['result']['embeddings'];assert len(windows)>1
                raw=long.encode()
                for window in windows:raw[window['start']:window['end']].decode();assert len(window['vector'])==384
                for before,after in zip(windows,windows[1:]):assert after['start']<before['end'] and after['end']>before['end']
            if ready['kiwi']:
                nul=request('앞\0뒤')['result'];assert nul.get('kiwi_error')=='kiwi_embedded_nul'
                if ready['semantic']:assert nul['embeddings']
            assert request('원문',version=2)['error']=='invalid_request'
            completed.append({'scenario':name,'kiwi':ready['kiwi'],'semantic':ready['semantic']})
        finally:
            process.stdin.close()
            try:process.wait(timeout=5)
            except subprocess.TimeoutExpired:process.kill();process.wait(timeout=5)
            assert process.returncode==0,(name,process.returncode)
    scenario('no_models');scenario('kiwi_only',kiwi=args.kiwi);scenario('semantic_only',semantic=args.semantic);scenario('both',args.kiwi,args.semantic)
    with tempfile.TemporaryDirectory(prefix='comet-corrupt-model-') as directory:
        broken=Path(directory);(broken/'model.onnx').write_bytes(b'broken')
        scenario('corrupt_semantic_keeps_kiwi',args.kiwi,broken)
    print(json.dumps({'passed':len(completed),'scenarios':completed},indent=2))

if __name__=='__main__':main()
