import argparse
import copy
import json
from pathlib import Path
import re
import tomllib


PACKAGE_NAME = "comet"


def read_package() -> dict:
    package = json.loads(Path("package.json").read_text(encoding="utf-8"))
    if package.get("name") != PACKAGE_NAME:
        raise ValueError(f"package.json name must be {PACKAGE_NAME}")
    if not re.fullmatch(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)", package.get("version", "")):
        raise ValueError("package.json version must be a stable X.Y.Z version")
    return package


def read_versions() -> tuple[dict, dict, str, dict, str, dict, int]:
    package = read_package()
    tauri = json.loads(Path("src-tauri/tauri.conf.json").read_text(encoding="utf-8"))
    cargo_text = Path("src-tauri/Cargo.toml").read_text(encoding="utf-8")
    cargo = tomllib.loads(cargo_text)
    lock_text = Path("src-tauri/Cargo.lock").read_text(encoding="utf-8")
    lock = tomllib.loads(lock_text)
    if cargo["package"]["name"] != PACKAGE_NAME:
        raise ValueError(f"Cargo.toml package name must be {PACKAGE_NAME}")
    matches = [index for index, entry in enumerate(lock["package"]) if entry["name"] == PACKAGE_NAME]
    if len(matches) != 1 or "source" in lock["package"][matches[0]]:
        raise ValueError(f"Cargo.lock must contain exactly one local {PACKAGE_NAME} package")
    return package, tauri, cargo_text, cargo, lock_text, lock, matches[0]


def replace_version(section: str, version: str) -> str:
    updated, count = re.subn(
        r'(?m)^(\s*version\s*=\s*)["\'][^"\'\n]*["\']',
        lambda match: f'{match[1]}"{version}"',
        section,
    )
    if count != 1:
        raise ValueError("Expected exactly one version field in the target TOML section")
    return updated


def synchronize() -> None:
    package, tauri, cargo_text, cargo, lock_text, lock, root_index = read_versions()
    version = package["version"]
    cargo_match = re.search(r"(?ms)^\[package\][ \t]*(?:#[^\n]*)?\n.*?(?=^\[|\Z)", cargo_text)
    if cargo_match is None:
        raise ValueError("Cargo.toml must contain a [package] section")
    updated_cargo = cargo_text[:cargo_match.start()] + replace_version(cargo_match[0], version) + cargo_text[cargo_match.end():]
    lock_sections = list(re.finditer(r"(?m)^\[\[package\]\][ \t]*(?:#[^\n]*)?\n", lock_text))
    if len(lock_sections) != len(lock["package"]):
        raise ValueError("Unsupported Cargo.lock package sections")
    start = lock_sections[root_index].start()
    end = lock_sections[root_index + 1].start() if root_index + 1 < len(lock_sections) else len(lock_text)
    updated_lock = lock_text[:start] + replace_version(lock_text[start:end], version) + lock_text[end:]
    expected_cargo = copy.deepcopy(cargo)
    expected_cargo["package"]["version"] = version
    expected_lock = copy.deepcopy(lock)
    expected_lock["package"][root_index]["version"] = version
    if tomllib.loads(updated_cargo) != expected_cargo or tomllib.loads(updated_lock) != expected_lock:
        raise ValueError("Version synchronization would change unrelated TOML values")
    updated_tauri = {**tauri, "version": version}
    updates = {
        Path("src-tauri/tauri.conf.json"): json.dumps(updated_tauri, ensure_ascii=False, indent=2) + "\n",
        Path("src-tauri/Cargo.toml"): updated_cargo,
        Path("src-tauri/Cargo.lock"): updated_lock,
    }
    for path, text in updates.items():
        if path.read_text(encoding="utf-8") != text:
            path.write_text(text, encoding="utf-8")


def check() -> None:
    package, tauri, _, cargo, _, lock, root_index = read_versions()
    versions = [tauri["version"], cargo["package"]["version"], lock["package"][root_index]["version"]]
    if any(version != package["version"] for version in versions):
        raise ValueError(f"Release versions must all match package.json {package['version']}")


def notes() -> str:
    version = read_package()["version"]
    changelog = Path("CHANGELOG.md").read_text(encoding="utf-8")
    headings = list(re.finditer(r"(?m)^##[ \t]+([^\n]+)\n?", changelog))
    matches = [index for index, heading in enumerate(headings) if heading[1].strip() == version]
    if len(matches) != 1:
        raise ValueError(f"CHANGELOG.md must contain exactly one ## {version} section")
    index = matches[0]
    end = headings[index + 1].start() if index + 1 < len(headings) else len(changelog)
    body = changelog[headings[index].end():end].strip()
    if not body:
        raise ValueError(f"CHANGELOG.md section {version} must not be empty")
    return body


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["sync", "check", "notes"])
    args = parser.parse_args()
    try:
        if args.command == "sync":
            synchronize()
        elif args.command == "check":
            check()
        else:
            print(notes())
    except (OSError, ValueError, KeyError, TypeError) as error:
        parser.exit(1, f"Release validation failed: {error}\n")


if __name__ == "__main__":
    main()
