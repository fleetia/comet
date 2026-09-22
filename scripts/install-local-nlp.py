#!/usr/bin/env python3
"""Developer-only installer for verified local artifacts in an explicitly chosen QA data directory.
Never defaults to the user's application directory. Does not enable a model or bypass
its calibrated retrieval threshold. The application must be closed during installation.
"""
import argparse,hashlib,json,shutil,struct,tarfile,tempfile
from pathlib import Path

def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir',type=Path,required=True)
    parser.add_argument('--kind',choices=['kiwi','semantic'],required=True)
    parser.add_argument('--manifest',type=Path,required=True)
    parser.add_argument('--source',type=Path,required=True,help='Directory containing exact manifest file names')
    args=parser.parse_args();manifest=json.loads(args.manifest.read_text());root=args.data_dir/'nlp';root.mkdir(parents=True,exist_ok=True)
    if not manifest['files']:raise SystemExit('Manifest contains no generated artifacts')
    for file in manifest['files']:
        name=file['name'];source=args.source/name
        if Path(name).name!=name or source.stat().st_size!=file['size'] or digest(source)!=file['sha256']:raise SystemExit('Local artifact integrity mismatch')
    stage=Path(tempfile.mkdtemp(prefix='.local-verified-',dir=root))
    try:
        for file in manifest['files']:shutil.copyfile(args.source/file['name'],stage/file['name'])
        if args.kind=='kiwi':
            with tarfile.open(stage/'kiwi.tgz') as archive:archive.extractall(stage,filter='data')
            (stage/'kiwi.tgz').unlink()
        profile=hashlib.sha256();profile.update(manifest['model'].encode());profile.update(manifest['revision'].encode())
        for file in manifest['files']:profile.update(file['name'].encode());profile.update(struct.pack('<Q',file['size']));profile.update(file['sha256'].encode())
        (stage/'verified-artifacts').write_text(profile.hexdigest())
        destination=root/args.kind
        if destination.exists():raise SystemExit('QA model already exists; remove it through the application before reinstalling')
        stage.rename(destination)
        print(f'Installed verified {args.kind} into {destination}. Model settings were preserved.')
    finally:
        if stage.exists():shutil.rmtree(stage)

if __name__=='__main__':main()
