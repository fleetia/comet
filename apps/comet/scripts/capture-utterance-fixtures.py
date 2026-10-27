#!/usr/bin/env python3
"""Record Kiwi `analyze` output for the request-reading corpus.

The Rust tests read the recorded morphemes, so they run without the Kiwi model. Re-run this
after changing the corpus, the helper's analysis options or the Kiwi release:

  python3 scripts/capture-utterance-fixtures.py --helper crates/comet-nlp/target/release/comet-nlp \
    --runtime src-tauri/binaries/nlp-runtime --kiwi /path/to/kiwi/models/cong/base
"""
import argparse
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "src-tauri/src/organizer/runtime/conversation_tools/utterance"
QUOTES = {'"': '"', "`": "`", "'": "'", "“": "”", "‘": "’", "「": "」", "『": "』"}


def ascii_digit(c):
    return c.isascii() and c.isdigit()


def ascii_alpha(c):
    return c.isascii() and c.isalpha()


def analysis_text(text):
    """Mirror of `utterance::analysis_text`: the colon ending the instruction becomes a period."""
    quote = None
    for index, c in enumerate(text):
        if quote:
            if c == quote:
                quote = None
            continue
        before = text[index - 1] if index else ""
        after = text[index + 1] if index + 1 < len(text) else ""
        if c in ":：" and not (ascii_digit(before) and ascii_digit(after)):
            return text[:index] + ("." if c == ":" else "。") + text[index + 1:]
        if c in QUOTES and not (c == "'" and ascii_alpha(before) and ascii_alpha(after)):
            quote = QUOTES[c]
    return text


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    for name in ("helper", "runtime", "kiwi"):
        parser.add_argument("--" + name, type=Path, required=True)
    args = parser.parse_args()
    corpus = [
        case
        for name in ("corpus.json", "holdout.json")
        for case in json.loads((FIXTURES / name).read_text(encoding="utf-8"))
    ]
    process = subprocess.Popen(
        [str(args.helper), "--runtime", str(args.runtime), "--kiwi", str(args.kiwi)],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
    )
    ready = json.loads(process.stdout.readline())
    if not ready.get("kiwi"):
        raise SystemExit(f"Kiwi did not load: {ready.get('errors')}")
    tokens = {}
    for index, case in enumerate(corpus, 1):
        analyzed = analysis_text(case["text"])
        request = {"version": 1, "id": index, "operation": "analyze", "text": analyzed}
        process.stdin.write(json.dumps(request, ensure_ascii=False) + "\n")
        process.stdin.flush()
        response = json.loads(process.stdout.readline())
        if response.get("error") or response["result"].get("kiwi_error"):
            raise SystemExit(f"analysis failed for {case['text']!r}: {response}")
        result = response["result"]
        tokens[case["text"]] = {
            "analyzed": analyzed,
            "tokens": result["tokens"],
            "typo_corrected": result.get("typo_corrected", []),
        }
    process.stdin.close()
    process.wait()
    output = FIXTURES / "kiwi_tokens.json"
    # One sentence per line keeps fixture diffs readable.
    lines = [
        f"{json.dumps(text, ensure_ascii=False)}:{json.dumps(value, ensure_ascii=False, separators=(',', ':'))}"
        for text, value in tokens.items()
    ]
    output.write_text("{\n" + ",\n".join(lines) + "\n}\n", encoding="utf-8")
    print(f"wrote {len(tokens)} analyses to {output.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
