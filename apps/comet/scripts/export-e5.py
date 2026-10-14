#!/usr/bin/env python3
"""Reproduce both portable CPU INT8 E5 artifacts from the pinned official FP32 ONNX.

Install scripts/requirements-nlp-export.txt into a temporary Python 3.13 venv.
This is a release build tool, never invoked by the installed application.
"""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import shutil
from onnxruntime.quantization import QuantType, quantize_dynamic

REVISION = "614241f622f53c4eeff9890bdc4f31cfecc418b3"
SOURCE_SHA = "ca456c06b3a9505ddfd9131408916dd79290368331e7d76bb621f1cba6bc8665"
TOKENIZER_SHA = "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39"

def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--tokenizer", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if digest(args.source) != SOURCE_SHA or digest(args.tokenizer) != TOKENIZER_SHA:
        raise SystemExit("Input does not match the pinned official E5 FP32/tokenizer revision")
    expected = {"onnxruntime":"1.22.0", "onnx":"1.18.0", "numpy":"2.2.6"}
    for package, version in expected.items():
        if importlib.metadata.version(package) != version:
            raise SystemExit(f"Expected {package}=={version}")
    for target, weight_type, policy in [("macos-arm64", QuantType.QInt8, "u8s8"), ("windows-x64", QuantType.QUInt8, "u8u8")]:
        output = args.output / target
        output.mkdir(parents=True, exist_ok=True)
        model = output / "model.onnx"
        quantize_dynamic(str(args.source), str(model), weight_type=weight_type,
                         per_channel=True, reduce_range=False,
                         op_types_to_quantize=["MatMul", "Gather"],
                         extra_options={"MatMulConstBOnly": True})
        shutil.copyfile(args.tokenizer, output / "tokenizer.json")
        manifest = {"schema":1, "model":"intfloat/multilingual-e5-small", "revision":REVISION,
                    "license":"MIT", "profile":f"e5-cpu-{policy}-ort1.22.0-tokenizer0.21.4-query-passage-mean-mask-l2-d384-w480-o32-v1",
                    "threshold":None,
                    "files":[{"name":name, "url":None, "size":(output/name).stat().st_size,
                              "sha256":digest(output/name)} for name in ["model.onnx", "tokenizer.json"]]}
        (output / "manifest.json").write_text(json.dumps(manifest, indent=2)+"\n")
        provenance = {"sourceRevision":REVISION,"sourceSha256":SOURCE_SHA,"tokenizerSha256":TOKENIZER_SHA,
                      "python":platform.python_version(),"packages":dict(sorted((d.metadata["Name"],d.version) for d in importlib.metadata.distributions())),
                      "quantization":{"activations":"QUInt8","weights":weight_type.name,"perChannel":True,"reduceRange":False,"operators":["MatMul","Gather"],"MatMulConstBOnly":True},
                      "target":target,"runtime":"1.22.0","published":False}
        (output / "provenance.json").write_text(json.dumps(provenance, indent=2)+"\n")
        print(f"Generated {target}: {model.stat().st_size} bytes, SHA-256 {digest(model)}", flush=True)

if __name__ == "__main__": main()
