use crate::protocol::{Embedding, EMBEDDING_DIMENSIONS};
use ort::{session::Session, value::Tensor};
use std::path::Path;
use tokenizers::{Tokenizer, TruncationParams};

pub struct Encoder {
    tokenizer: Tokenizer,
    session: Session,
    _environment: EnvironmentGuard,
}
// rc.10 keeps its environment in a Rust static. Official ORT 1.22 destroys C++ logging
// statics first on macOS unless the environment is released explicitly. This helper
// creates exactly one session and terminates after dropping it; ORT is never re-entered.
// See microsoft/onnxruntime#25038 and pykeio/ort commit 317be20 (rc.11, MSRV 1.88).
struct EnvironmentGuard;
impl Drop for EnvironmentGuard {
    fn drop(&mut self) {
        use ort::AsPointer;
        if let Ok(environment) = ort::environment::get_environment() {
            unsafe {
                (ort::api().ReleaseEnv)(environment.ptr().cast_mut());
            }
        }
    }
}
impl Encoder {
    pub fn load(runtime: &Path, model: &Path) -> Result<Self, String> {
        ort::init_from(runtime.to_string_lossy())
            .with_name("comet-nlp")
            .commit()
            .map_err(|_| "ort_initialization_failed")?;
        let environment = EnvironmentGuard;
        let session = Session::builder()
            .map_err(|_| "ort_session_failed")?
            .with_execution_providers([ort::execution_providers::CPUExecutionProvider::default()
                .with_arena_allocator(false)
                .build()])
            .map_err(|_| "ort_memory_config_failed")?
            .with_memory_pattern(false)
            .map_err(|_| "ort_memory_config_failed")?
            .with_intra_threads(1)
            .map_err(|_| "ort_thread_config_failed")?
            .with_inter_threads(1)
            .map_err(|_| "ort_thread_config_failed")?
            .with_parallel_execution(false)
            .map_err(|_| "ort_thread_config_failed")?
            .with_config_entry("session.intra_op.allow_spinning", "0")
            .map_err(|_| "ort_thread_config_failed")?
            .with_config_entry("session.inter_op.allow_spinning", "0")
            .map_err(|_| "ort_thread_config_failed")?
            .commit_from_file(model.join("model.onnx"))
            .map_err(|_| "e5_model_invalid")?;
        let mut tokenizer = Tokenizer::from_file(model.join("tokenizer.json"))
            .map_err(|_| "e5_tokenizer_invalid")?;
        tokenizer.with_padding(None);
        tokenizer
            .with_truncation(Some(TruncationParams {
                max_length: 512,
                ..Default::default()
            }))
            .map_err(|_| "e5_tokenizer_invalid")?;
        Ok(Self {
            tokenizer,
            session,
            _environment: environment,
        })
    }
    pub fn encode(&mut self, text: &str, passage: bool) -> Result<Vec<Embedding>, String> {
        let windows = if passage {
            self.windows(text)?
        } else {
            vec![(0, text.len())]
        };
        windows.into_iter().map(|(start, end)| {
            let prefix = if passage { "passage: " } else { "query: " };
            let encoding = self.tokenizer.encode(format!("{prefix}{}", &text[start..end]), true)
                .map_err(|_| "e5_tokenization_failed")?;
            let len = encoding.len();
            let ids: Vec<i64> = encoding.get_ids().iter().map(|&n| n as i64).collect();
            let mask: Vec<i64> = encoding.get_attention_mask().iter().map(|&n| n as i64).collect();
            let ids = Tensor::from_array(([1, len], ids.into_boxed_slice())).map_err(|_| "e5_tensor_failed")?;
            let attention = Tensor::from_array(([1, len], mask.clone().into_boxed_slice())).map_err(|_| "e5_tensor_failed")?;
            let token_types = Tensor::from_array(([1, len], vec![0i64;len].into_boxed_slice())).map_err(|_| "e5_tensor_failed")?;
            let outputs = self.session.run(ort::inputs!["input_ids" => ids, "attention_mask" => attention, "token_type_ids" => token_types])
                .map_err(|_| "e5_inference_failed")?;
            let (shape, hidden) = outputs[0].try_extract_tensor::<f32>().map_err(|_| "e5_output_invalid")?;
            if shape.as_ref() != [1, len as i64, EMBEDDING_DIMENSIONS as i64] { return Err("e5_output_shape_invalid".into()); }
            Ok(Embedding { start, end, vector: mean_pool(hidden, &mask)? })
        }).collect()
    }
    fn windows(&self, text: &str) -> Result<Vec<(usize, usize)>, String> {
        let mut tokenizer = self.tokenizer.clone();
        tokenizer
            .with_truncation(None)
            .map_err(|_| "e5_tokenizer_invalid")?;
        let encoding = tokenizer
            .encode(text, false)
            .map_err(|_| "e5_tokenization_failed")?;
        let offsets = encoding.get_offsets();
        if offsets.is_empty() {
            return Ok(vec![(0, text.len())]);
        }
        let mut windows = Vec::new();
        let mut first = 0;
        while first < offsets.len() {
            let last = (first + 480).min(offsets.len());
            let start = offsets[first].0;
            let end = offsets[last - 1].1;
            if start > end || !text.is_char_boundary(start) || !text.is_char_boundary(end) {
                return Err("e5_invalid_span".into());
            }
            windows.push((start, end));
            if last == offsets.len() {
                break;
            }
            first = last - 32;
        }
        Ok(windows)
    }
}
fn mean_pool(hidden: &[f32], mask: &[i64]) -> Result<Vec<f32>, String> {
    if hidden.len() != mask.len() * EMBEDDING_DIMENSIONS {
        return Err("e5_output_shape_invalid".into());
    }
    let count = mask.iter().filter(|&&m| m != 0).count();
    if count == 0 {
        return Err("e5_empty_attention".into());
    }
    let mut vector = vec![0.0; EMBEDDING_DIMENSIONS];
    for (row, &enabled) in hidden.chunks_exact(EMBEDDING_DIMENSIONS).zip(mask) {
        if enabled != 0 {
            for (sum, &value) in vector.iter_mut().zip(row) {
                *sum += value / count as f32;
            }
        }
    }
    let norm = vector.iter().map(|x| x * x).sum::<f32>().sqrt();
    if !norm.is_finite() || norm <= f32::EPSILON {
        return Err("e5_invalid_vector".into());
    }
    for value in &mut vector {
        *value /= norm;
    }
    Ok(vector)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn padding_is_excluded_before_l2_normalization() {
        let mut hidden = vec![0.; EMBEDDING_DIMENSIONS * 3];
        hidden[0] = 3.;
        hidden[EMBEDDING_DIMENSIONS + 1] = 4.;
        hidden[EMBEDDING_DIMENSIONS * 2 + 2] = 1000.;
        let result = mean_pool(&hidden, &[1, 1, 0]).unwrap();
        assert!((result[0] - 0.6).abs() < 1e-6);
        assert!((result[1] - 0.8).abs() < 1e-6);
        assert_eq!(result[2], 0.);
    }
}
