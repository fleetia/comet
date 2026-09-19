import copy
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name('finalize_release.py').resolve()
REPO = 'fleetia/comet'
TAG = 'v0.4.1'
PREFIX = f'https://github.com/{REPO}/releases/download/{TAG}/'


def fixture() -> tuple[dict, dict]:
    names = ['Comet.dmg', 'Comet.exe', 'Comet.exe.sig', 'Comet.app.tar.gz', 'Comet.app.tar.gz.sig']
    assets = [dict(name=name, size=100, url=PREFIX + name,
                   apiUrl=f'https://api.github.com/repos/{REPO}/releases/assets/{index + 1}')
              for index, name in enumerate(names)]
    platforms = {}
    for keys, index in [(('darwin-aarch64', 'darwin-aarch64-app'), 3),
                        (('windows-x86_64', 'windows-x86_64-nsis'), 1)]:
        for key in keys:
            platforms[key] = dict(url=assets[index]['apiUrl'], signature='signed-content')
    return dict(version='0.4.1', notes='', platforms=platforms), dict(assets=assets, body='### Patch Changes\n\n- 서명 업데이트 개선')


def run(root: Path) -> subprocess.CompletedProcess[str]:
    env = {**os.environ, 'GH_REPO': REPO, 'RELEASE_TAG': TAG}
    return subprocess.run([sys.executable, str(SCRIPT)], cwd=root, env=env, capture_output=True, text=True, check=False)


def write_fixture(root: Path, manifest: dict, release: dict) -> Path:
    (root / 'release').mkdir()
    path = root / 'release/latest.json'
    path.write_text(json.dumps(manifest), encoding='utf-8')
    (root / 'release.json').write_text(json.dumps(release), encoding='utf-8')
    return path


def test_all_api_aliases_become_public_and_notes_are_preserved() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        manifest, release = fixture()
        path = write_fixture(root, manifest, release)
        result = run(root)
        assert result.returncode == 0, result.stderr
        actual = json.loads(path.read_text())
        assert actual['notes'] == release['body']
        assert len(actual['platforms']) == 4
        for key, target in actual['platforms'].items():
            name = 'Comet.app.tar.gz' if key.startswith('darwin') else 'Comet.exe'
            assert target == dict(url=PREFIX + name, signature='signed-content')
        notes = (root / 'release-notes.md').read_text()
        assert '## 다운로드' in notes and '## 업데이트 노트\n\n' + release['body'] in notes
        assert PREFIX + 'Comet.dmg' in notes and PREFIX + 'Comet.exe' in notes
        assert 'notarization' in notes and 'Authenticode' in notes
        assert run(root).returncode == 0
        assert json.loads(path.read_text()) == actual


def test_public_urls_remain_compatible() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        manifest, release = fixture()
        for key, target in manifest['platforms'].items():
            target['url'] = PREFIX + ('Comet.app.tar.gz' if key.startswith('darwin') else 'Comet.exe')
        path = write_fixture(root, manifest, release)
        result = run(root)
        assert result.returncode == 0, result.stderr
        assert json.loads(path.read_text())['platforms'] == manifest['platforms']


def test_invalid_input_never_changes_manifest_or_notes() -> None:
    original, release = fixture()
    cases = []
    for bad_url in ['https://example.com/private-secret', PREFIX.replace(TAG, 'v0.4.0') + 'Comet.exe']:
        manifest = copy.deepcopy(original)
        manifest['platforms']['windows-x86_64']['url'] = bad_url
        cases.append((manifest, release))
    bad_release = copy.deepcopy(release)
    bad_release['assets'][1]['url'] = PREFIX.replace(TAG, 'v0.4.0') + 'Comet.exe'
    cases.append((original, bad_release))
    manifest = copy.deepcopy(original)
    del manifest['platforms']['windows-x86_64']
    del manifest['platforms']['windows-x86_64-nsis']
    cases.append((manifest, release))
    manifest = copy.deepcopy(original)
    manifest['platforms']['windows-x86_64']['signature'] = ' '
    cases.append((manifest, release))
    manifest = copy.deepcopy(original)
    manifest['version'] = '0.5.0'
    cases.append((manifest, release))
    for change in ['empty-installer', 'missing-sig', 'empty-sig', 'empty-notes', 'duplicate-installer']:
        bad_release = copy.deepcopy(release)
        if change == 'empty-installer':
            bad_release['assets'][0]['size'] = 0
        elif change == 'missing-sig':
            bad_release['assets'].pop(2)
        elif change == 'empty-sig':
            bad_release['assets'][2]['size'] = 0
        elif change == 'empty-notes':
            bad_release['body'] = '  \n'
        else:
            bad_release['assets'].append(dict(name='Other.exe', size=100, url=PREFIX + 'Other.exe'))
        cases.append((original, bad_release))
    for manifest, release_data in cases:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = write_fixture(root, manifest, release_data)
            before = path.read_bytes()
            notes = root / 'release-notes.md'
            notes.write_text('existing notes')
            result = run(root)
            assert result.returncode != 0
            assert 'Traceback' not in result.stderr and 'private-secret' not in result.stderr
            assert path.read_bytes() == before
            assert notes.read_text() == 'existing notes'


def load_tests(loader: unittest.TestLoader, tests: unittest.TestSuite, pattern: str | None) -> unittest.TestSuite:
    return unittest.TestSuite(unittest.FunctionTestCase(test) for test in [
        test_all_api_aliases_become_public_and_notes_are_preserved,
        test_public_urls_remain_compatible,
        test_invalid_input_never_changes_manifest_or_notes,
    ])


if __name__ == '__main__':
    unittest.main()
