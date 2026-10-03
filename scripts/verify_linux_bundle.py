"""Validate a locally built Ubuntu x64 DEB without installing it or opening the app."""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def command(args: list[str], *, include_stderr: bool = False, **kwargs) -> str:
    result = subprocess.run(args, check=True, capture_output=True, text=True, timeout=60, **kwargs)
    return result.stdout + (result.stderr if include_stderr else '')


def elf_x64(path: Path) -> None:
    require(path.is_file(), f'Missing native file: {path.name}')
    with path.open('rb') as stream:
        header = stream.read(20)
    require(header[:6] == b'\x7fELF\x02\x01' and header[18:20] == b'\x3e\x00',
            f'Expected Linux x86_64 ELF: {path.name}')


def verify_tree(root: Path, product: str) -> None:
    root = root.resolve()
    # Resolve every alias before loading native code; no dangling/out-of-bundle links.
    for path in root.rglob('*'):
        if path.is_symlink():
            require(path.resolve().is_relative_to(root) and path.resolve().is_file(),
                    f'Invalid bundled symlink: {path.name}')
    binaries = root / 'usr/bin'
    resources = root / 'usr/lib' / product
    runtime, nlp_runtime = resources / 'runtime', resources / 'nlp-runtime'
    executables = [binaries / name for name in ['comet', 'llama-server', 'comet-nlp']]
    for executable in executables:
        elf_x64(executable)
        require(os.access(executable, os.X_OK), f'Native executable is not executable: {executable.name}')
    for directory, required in [
        (runtime, ['libllama.so', 'libllama-server-impl.so', 'libggml-cpu-x64.so',
                   'llama.cpp-LICENSE.txt', 'release.json']),
        (nlp_runtime, ['libkiwi.so', 'libonnxruntime.so', 'libonnxruntime_providers_shared.so',
                       'Kiwi-LICENSE', 'Kiwi-NOTICE', 'release.json']),
    ]:
        for name in required:
            path = directory / name
            require(path.is_file() and path.stat().st_size > 0, f'Missing or empty bundled runtime: {name}')
    require(any(path.is_file() and path.stat().st_size > 0 for path in nlp_runtime.glob('onnxruntime-LICENSE*')),
            'Missing ONNX Runtime license.')
    require((root / 'usr/share/applications' / f'{product}.desktop').is_file(), 'Missing desktop entry.')
    libraries = [path for directory in (runtime, nlp_runtime) for path in directory.iterdir()
                 if re.search(r'\.so(?:\.\d+)*$', path.name)]
    # Loading the complete runtime catches both direct and dlopen-only dependency gaps.
    env = {**os.environ, 'LD_LIBRARY_PATH': os.pathsep.join(map(str, [runtime, nlp_runtime]))}
    for path in executables + libraries:
        elf_x64(path)
        dependencies = command(['ldd', str(path)], env=env)
        require('not found' not in dependencies, f'Unresolved Linux dependency: {path.name}')
    version = command([str(binaries / 'llama-server'), '--version'], env=env, include_stderr=True)
    require(bool(version.strip()), 'llama-server did not report a version.')
    ready = command([str(binaries / 'comet-nlp'), '--runtime', str(nlp_runtime)], input='', env=env)
    greeting = json.loads(ready.strip())
    require(greeting.get('version') == 1 and greeting.get('ready') is True and greeting.get('kiwi') is False
            and greeting.get('semantic') is False and greeting.get('errors') == [],
            'Model-free NLP startup failed.')


def verify_package(package: Path, version: str, product: str) -> None:
    require(package.name == f'{product}_{version}_amd64.deb', 'DEB filename must match this version and amd64 architecture.')
    require(command(['dpkg-deb', '--field', str(package), 'Version']).strip() == version, 'DEB version mismatch.')
    require(command(['dpkg-deb', '--field', str(package), 'Architecture']).strip() == 'amd64', 'DEB architecture mismatch.')
    with tempfile.TemporaryDirectory(prefix='comet-linux-bundle-') as directory:
        command(['dpkg-deb', '--extract', str(package), directory])
        verify_tree(Path(directory), product)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('package', type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    version = json.loads((root / 'package.json').read_text())['version']
    product = json.loads((root / 'src-tauri/tauri.conf.json').read_text())['productName']
    verify_package(args.package, version, product)
    print(f'Validated {args.package.name}: amd64 ELF, bundled dependencies and model-free sidecars. Desktop interaction is a separate acceptance check.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f'Linux package validation failed: {error}', file=sys.stderr)
        sys.exit(1)
