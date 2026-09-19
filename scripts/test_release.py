import json
from pathlib import Path
import subprocess
import sys
import tempfile
import tomllib
import unittest


SCRIPT = Path(__file__).with_name("release.py").resolve()


def fixture(root: Path, version: str = "0.4.0") -> None:
    (root / "src-tauri").mkdir()
    (root / "package.json").write_text(json.dumps({"name": "comet", "version": version, "private": True}), encoding="utf-8")
    (root / "src-tauri/tauri.conf.json").write_text(json.dumps({"productName": "comet", "version": "0.4.0", "bundle": {"active": True}}), encoding="utf-8")
    (root / "src-tauri/Cargo.toml").write_text(
        '[package]\nname = "comet"\nversion = "0.4.0" # app\nedition = "2021"\n\n'
        '[dependencies]\nserde = { version = "1", features = ["derive"] }\n\n'
        '[dependencies.example]\nversion = "0.4.0"\n', encoding="utf-8")
    (root / "src-tauri/Cargo.lock").write_text(
        '# Generated lockfile\nversion = 4\n\n'
        '[[package]]\nname = "before"\nversion = "0.4.0"\n\n'
        '[[package]]\nname = "comet"\nversion = "0.4.0"\ndependencies = ["before", "serde"]\n\n'
        '[[package]]\nname = "serde"\nversion = "1.0.0"\nsource = "registry+https://example.com"\n', encoding="utf-8")


def run(root: Path, command: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run([sys.executable, str(SCRIPT), command], cwd=root, capture_output=True, text=True, check=False)


def test_sync_versions_and_preserve_dependencies() -> None:
    for version in ["0.4.1", "0.5.0"]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(root, version)
            assert run(root, "check").returncode != 0
            result = run(root, "sync")
            assert result.returncode == 0, result.stderr
            result = run(root, "check")
            assert result.returncode == 0, result.stderr
            cargo = tomllib.loads((root / "src-tauri/Cargo.toml").read_text())
            lock = tomllib.loads((root / "src-tauri/Cargo.lock").read_text())
            assert cargo["dependencies"] == {"serde": {"version": "1", "features": ["derive"]}, "example": {"version": "0.4.0"}}
            assert [entry["version"] for entry in lock["package"]] == ["0.4.0", version, "1.0.0"]
            assert lock["package"][1]["dependencies"] == ["before", "serde"]
            assert lock["version"] == 4
            assert json.loads((root / "src-tauri/tauri.conf.json").read_text())["bundle"] == {"active": True}
            before = {path: path.read_bytes() for path in root.rglob("*") if path.is_file()}
            assert run(root, "sync").returncode == 0
            assert all(path.read_bytes() == content for path, content in before.items())


def test_invalid_identity_prevents_writes() -> None:
    for path, old, new in [
        ("package.json", "comet", "other-app"),
        ("src-tauri/Cargo.toml", "comet", "other-app"),
        ("src-tauri/Cargo.lock", 'name = "comet"', 'name = "missing-root"'),
    ]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(root, "0.4.1")
            target = root / path
            target.write_text(target.read_text().replace(old, new))
            before = {file: file.read_bytes() for file in root.rglob("*") if file.is_file()}
            assert run(root, "check").returncode != 0
            assert run(root, "sync").returncode != 0
            assert all(file.read_bytes() == content for file, content in before.items())


def test_notes_select_current_release() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        fixture(root, "0.4.1")
        (root / "CHANGELOG.md").write_text(
            '# comet\n\n## 0.5.0\n\nFuture release\n\n## 0.4.1\n\n'
            '### Patch Changes\n\n- Windows 설치와 macOS DMG 개선\n\n## 0.4.0\n\nOlder release\n', encoding="utf-8")
        result = run(root, "notes")
        assert result.returncode == 0, result.stderr
        assert result.stdout == "### Patch Changes\n\n- Windows 설치와 macOS DMG 개선\n"


def test_invalid_lock_prevents_partial_sync() -> None:
    for suffix in ['\n[[package]]\nname = "comet"\nversion = "0.4.0"\n', '\ninvalid = [\n']:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(root, "0.4.1")
            path = root / "src-tauri/Cargo.lock"
            path.write_text(path.read_text() + suffix)
            before = {file: file.read_bytes() for file in root.rglob("*") if file.is_file()}
            result = run(root, "sync")
            assert result.returncode != 0
            assert all(file.read_bytes() == content for file, content in before.items())


def test_notes_reject_missing_empty_or_duplicate_release() -> None:
    for content in [None, "## 0.3.0\n\nPrevious version\n", "## 0.4.0\n\n## 0.3.0\n\nOld\n", "## 0.4.0\n\nFirst\n\n## 0.4.0\n\nDuplicate\n"]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(root)
            if content is not None:
                (root / "CHANGELOG.md").write_text(content, encoding="utf-8")
            result = run(root, "notes")
            assert result.returncode != 0
            assert result.stdout == ""


def load_tests(loader: unittest.TestLoader, tests: unittest.TestSuite, pattern: str | None) -> unittest.TestSuite:
    return unittest.TestSuite(unittest.FunctionTestCase(test) for test in [
        test_sync_versions_and_preserve_dependencies,
        test_invalid_identity_prevents_writes,
        test_invalid_lock_prevents_partial_sync,
        test_notes_select_current_release,
        test_notes_reject_missing_empty_or_duplicate_release,
    ])


if __name__ == "__main__":
    unittest.main()
