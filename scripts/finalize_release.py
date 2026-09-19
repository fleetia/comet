"""Validate signed release assets and prepare public updater URLs and release notes."""
import json
import os
from pathlib import Path
import re
import sys
from urllib.parse import unquote, urlparse


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def public_url(asset: dict, prefix: str) -> str:
    url = asset['url']
    require(isinstance(url, str), 'Invalid asset URL.')
    parsed = urlparse(url)
    name = asset['name']
    require(
        parsed.scheme == 'https' and parsed.netloc == 'github.com'
        and not parsed.query and not parsed.fragment
        and '/' not in name and '\\' not in name
        and unquote(parsed.path) == prefix + name,
        'Asset must belong to this repository and release tag.',
    )
    return url


def nonempty(asset: dict) -> bool:
    return type(asset.get('size')) is int and asset['size'] > 0


def finalize() -> None:
    repo = os.environ['GH_REPO']
    tag = os.environ['RELEASE_TAG']
    require(re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo) is not None, 'Invalid repository.')
    require(tag.startswith('v') and '/' not in tag, 'Invalid release tag.')
    path = Path('release/latest.json')
    manifest = json.loads(path.read_text(encoding='utf-8'))
    release = json.loads(Path('release.json').read_text(encoding='utf-8'))
    require(isinstance(manifest, dict) and isinstance(release, dict), 'Invalid release input.')
    version = manifest['version']
    require(isinstance(version, str) and version.removeprefix('v') == tag[1:], 'Version does not match release tag.')
    body = release.get('body')
    require(isinstance(body, str) and bool(body.strip()), 'Release notes must not be empty.')
    body = body.strip()
    entries = release['assets']
    require(isinstance(entries, list), 'Invalid release assets.')
    assets = {}
    for asset in entries:
        require(isinstance(asset, dict) and isinstance(asset.get('name'), str) and bool(asset['name']), 'Invalid release asset.')
        require(asset['name'] not in assets, 'Duplicate asset names.')
        assets[asset['name']] = asset
    prefix = f'/{repo}/releases/download/{tag}/'
    downloads = []
    for platform, extension in [('macOS 14+ · Apple Silicon', '.dmg'), ('Windows · x64', '.exe')]:
        installers = [asset for name, asset in assets.items() if name.endswith(extension)]
        require(len(installers) == 1 and nonempty(installers[0]), 'Missing, empty or ambiguous installer.')
        url = public_url(installers[0], prefix)
        downloads.append(f'| {platform} | [{extension[1:].upper()} 다운로드]({url}) |')
    platforms = manifest['platforms']
    require(isinstance(platforms, dict), 'Invalid updater targets.')
    for candidates in [('darwin-aarch64-app', 'darwin-aarch64'), ('windows-x86_64-nsis', 'windows-x86_64')]:
        require(any(key in platforms for key in candidates), 'Missing required updater target.')
    for target in platforms.values():
        require(isinstance(target, dict), 'Invalid updater target.')
        require(isinstance(target.get('signature'), str) and bool(target['signature'].strip()), 'Missing target signature.')
        url = target.get('url')
        require(isinstance(url, str) and bool(url), 'Missing updater URL.')
        matches = [asset for asset in assets.values() if url == asset.get('url') or url == asset.get('apiUrl')]
        require(len(matches) == 1 and nonempty(matches[0]), 'Updater URL must match one nonempty release asset.')
        asset = matches[0]
        signature = assets.get(asset['name'] + '.sig')
        require(signature is not None and nonempty(signature), 'Missing or empty signature asset.')
        public_url(signature, prefix)
        target['url'] = public_url(asset, prefix)
    manifest['notes'] = body
    notes = '\n'.join([
        '## 다운로드', '', '| 운영체제 | 설치 파일 |', '| --- | --- |', *downloads, '',
        'macOS는 DMG를 열고 Nanika Box를 Applications 폴더로 옮겨 실행하세요. Windows는 EXE 설치 파일을 실행하세요.', '',
        '앱 updater 서명은 적용됩니다. macOS notarization과 Windows Authenticode 서명은 아직 제공하지 않습니다.', '',
        '## 업데이트 노트', '', body, '',
    ])
    # No output is changed until every target, alias and note has passed validation.
    content = json.dumps(manifest, ensure_ascii=False, indent=2) + '\n'
    path.write_text(content, encoding='utf-8')
    Path('release-notes.md').write_text(notes, encoding='utf-8')


if __name__ == '__main__':
    try:
        finalize()
    except (OSError, KeyError, TypeError, ValueError) as error:
        message = str(error) if type(error) is ValueError else 'Invalid or unreadable release input.'
        print(f'Release finalization failed: {message}', file=sys.stderr)
        sys.exit(1)
