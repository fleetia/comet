mod embedding;
mod kiwi;
#[path = "../../../src-tauri/src/nlp/protocol.rs"]
mod protocol;
use protocol::*;
use std::{
    io::{self, BufRead, Read, Write},
    path::PathBuf,
};

fn argument(name: &str) -> Option<PathBuf> {
    let mut args = std::env::args_os();
    while let Some(arg) = args.next() {
        if arg == name {
            return args.next().map(PathBuf::from);
        }
    }
    None
}
fn main() {
    // Hugging Face's tokenization stays sequential too.
    std::env::set_var("TOKENIZERS_PARALLELISM", "false");
    let Some(runtime) = argument("--runtime") else {
        std::process::exit(2);
    };
    let mut errors = Vec::new();
    let kiwi = argument("--kiwi").and_then(|path| {
        let library = runtime.join(if cfg!(windows) {
            "kiwi.dll"
        } else {
            "libkiwi.dylib"
        });
        match kiwi::Kiwi::load(&library, &path) {
            Ok(model) => Some(model),
            Err(error) => {
                errors.push(error);
                None
            }
        }
    });
    let mut encoder = argument("--semantic").and_then(|path| {
        let library = runtime.join(if cfg!(windows) {
            "onnxruntime.dll"
        } else {
            "libonnxruntime.dylib"
        });
        match embedding::Encoder::load(&library, &path) {
            Ok(model) => Some(model),
            Err(error) => {
                errors.push(error);
                None
            }
        }
    });
    let mut out = io::stdout().lock();
    let ready = Ready {
        version: PROTOCOL_VERSION,
        ready: true,
        kiwi: kiwi.is_some(),
        semantic: encoder.is_some(),
        errors,
    };
    if write_line(&mut out, &ready).is_err() {
        return;
    }
    let mut input = io::stdin().lock();
    loop {
        let mut line = Vec::new();
        // Limit before allocation can grow with a malformed sender.
        match input
            .by_ref()
            .take((MAX_LINE_BYTES + 1) as u64)
            .read_until(b'\n', &mut line)
        {
            Ok(0) => break,
            Ok(_) if line.len() > MAX_LINE_BYTES || line.last() != Some(&b'\n') => break,
            Err(_) => break,
            _ => {}
        }
        let request: Request = match serde_json::from_slice(&line) {
            Ok(request) => request,
            Err(_) => break,
        };
        let mut result = Analysis::default();
        let error = if request.version != PROTOCOL_VERSION || request.text.len() > MAX_TEXT_BYTES {
            Some("invalid_request".to_owned())
        } else {
            let operation = request.operation;
            if matches!(
                operation,
                Operation::Query | Operation::Index | Operation::Analyze
            ) {
                if let Some(model) = &kiwi {
                    match model.analyze(&request.text) {
                        Ok(tokens) => result.tokens = tokens,
                        Err(error) => result.kiwi_error = Some(error),
                    }
                }
            }
            if matches!(
                operation,
                Operation::Query
                    | Operation::Index
                    | Operation::EmbedQuery
                    | Operation::EmbedPassage
            ) {
                if let Some(model) = &mut encoder {
                    match model.encode(
                        &request.text,
                        matches!(operation, Operation::Index | Operation::EmbedPassage),
                    ) {
                        Ok(embeddings) => result.embeddings = embeddings,
                        Err(error) => result.semantic_error = Some(error),
                    }
                }
            }
            None
        };
        let response = Response {
            version: PROTOCOL_VERSION,
            id: request.id,
            result: error.is_none().then_some(result),
            error,
        };
        if write_line(&mut out, &response).is_err() {
            break;
        }
    }
}
fn write_line(out: &mut impl Write, value: &impl serde::Serialize) -> io::Result<()> {
    serde_json::to_writer(&mut *out, value)?;
    out.write_all(b"\n")?;
    out.flush()
}
