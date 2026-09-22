# Comet NLP build and validation

`comet-nlp` is a separate Rust 1.85 executable. It owns one Kiwi CoNg instance and one CPU ONNX session. Kiwi loads the default dictionary with integrated allomorphs; optional `multi.dict` and typo dictionaries stay unloaded. ORT disables its CPU arena and memory pattern cache as well as worker spinning. This configuration reduced measured peak RSS without rewriting model inputs. The installed application does not run Python. The parent controls startup, request deadlines, cancellation, cooldown, idle shutdown, and process reaping. Installation receipts identify verified artifact bytes independently of the retrieval policy; policy changes invalidate derived indexes while keeping installed models. Legacy receipts are upgraded only after background verification of the actual model files, with cancellation support.

## Reproduce the native helper

```sh
rustup toolchain install 1.85.0 --profile minimal
RUSTUP_TOOLCHAIN=1.85.0 node scripts/prepare-nlp.mjs
cargo +1.85.0 test --locked --manifest-path crates/comet-nlp/Cargo.toml
```

The preparation script verifies the fixed official Kiwi 0.24.0 and ORT 1.22.0 archives, builds the helper with the locked dependency tree, and writes `src-tauri/binaries/comet-nlp-<target>` plus `src-tauri/binaries/nlp-runtime/`. It never modifies the llama runtime directory. `COMET_NLP_CACHE` can point to a directory containing archives with their official file names; cached files pass the same size and SHA-256 checks. `CARGO` can override the Cargo executable. Windows packaging also copies the four VC++ runtime DLLs required by the official ORT archive from the installed Visual Studio redistributable directory and records their hashes in the bundled runtime release record; packaging fails if they are missing. The helper alone receives this runtime directory at the front of its child process `PATH`. A clean Windows installation still requires native validation.

macOS links the official dynamic libraries at runtime. `ort` rc.10 has an upstream environment destruction ordering issue on macOS ([ORT issue 25038](https://github.com/microsoft/onnxruntime/issues/25038)). The helper scopes its single ORT environment after its session and explicitly releases it before native static destructors run. It never initializes another ORT session after this cleanup. This preserves Rust 1.85 without silently upgrading to rc.11.

## Reproduce the optional E5 models

Download `onnx/model.onnx` and `tokenizer.json` from the fixed official [`intfloat/multilingual-e5-small` revision](https://huggingface.co/intfloat/multilingual-e5-small/tree/614241f622f53c4eeff9890bdc4f31cfecc418b3). The exporter checks both input hashes before conversion.

```sh
python3.13 -m venv /tmp/comet-nlp-export
/tmp/comet-nlp-export/bin/pip install -r scripts/requirements-nlp-export.txt
/tmp/comet-nlp-export/bin/python scripts/export-e5.py \
  --source /path/to/model.onnx --tokenizer /path/to/tokenizer.json \
  --output nlp/artifacts
```

The exporter produces separate portable U8S8 (macOS arm64) and U8U8 (Windows x64) CPU graphs, tokenizer copies, manifests, and conversion provenance. No AVX512 model is used. The two outputs were reproduced twice with identical hashes on 2026-09-21; their committed manifests record the actual file sizes and SHA-256 values. This verifies conversion reproducibility on the current host, not Windows runtime compatibility.

`models/e5-*.json` deliberately has `url: null` and `threshold: null`. These artifacts have not been published and the initial semantic retrieval quality gate did not pass. The app reports this state and continues lexical/Kiwi retrieval. Do not replace these fields with guessed URLs or a threshold fitted to the held-out evaluation queries. Publishing requires verified release artifacts, an independent quality result, and explicit release authorization.

## Evaluate the actual helper and Rust retrieval

[`fixtures/korean-retrieval.json`](fixtures/korean-retrieval.json) is a public CC0 fixture with separate calibration and evaluation queries. The evaluator selects the most restrictive threshold among those maximizing calibration Recall@5 while calibration unrelated-query false positives stay at or below 5%. It only writes a release threshold when the held-out quality gate also passes.

```sh
python3 scripts/evaluate-nlp.py \
  --helper src-tauri/binaries/comet-nlp-aarch64-apple-darwin \
  --runtime src-tauri/binaries/nlp-runtime \
  --model nlp/artifacts/macos-arm64 \
  --kiwi /path/to/kiwi/models/cong/base \
  --output nlp/validation/e5-macos-arm64.json \
  --export-vectors /tmp/comet-nlp-evaluation.json
COMET_NLP_EVAL_INPUT=/tmp/comet-nlp-evaluation.json \
COMET_NLP_EVAL_RESULT=/absolute/path/to/combined.json \
cargo +1.85.0 test --locked --manifest-path src-tauri/Cargo.toml \
  evaluate_combined_search_from_native_fixture_vectors -- --ignored --nocapture
```

The ignored Rust evaluation calls the production store's FTS, current memory checks, vector comparison, and RRF with the actual native vectors and Kiwi terms. It reports quality without turning an unmet release target into a passing quality assertion. Fixture-based results are not general Korean-language accuracy claims.

```sh
python3 scripts/benchmark-nlp.py \
  --helper src-tauri/binaries/comet-nlp-aarch64-apple-darwin \
  --runtime src-tauri/binaries/nlp-runtime \
  --kiwi /path/to/kiwi/models/cong/base --semantic nlp/artifacts/macos-arm64 \
  --output nlp/validation/native-macos-arm64.json
```

The benchmark samples the owned helper's RSS and idle CPU, and measures native query latency and graceful exit on the current host. It does not include SQLite/application memory and does not substitute for the specified Windows 8GB/4CPU reference-device test.

For a closed isolated QA app, `scripts/install-local-nlp.py --data-dir /explicit/qa/directory --kind semantic --manifest nlp/models/e5-macos-arm64.json --source nlp/artifacts/macos-arm64` verifies a local artifact before activating it. It never defaults to the real user's data directory, never enables a model, and never bypasses the threshold gate.
