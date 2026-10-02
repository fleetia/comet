use super::{custom_model_path, spec};
use crate::types::Settings;
use serde::Serialize;
use std::io::{self, Read};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetGenerationEligibility {
    pub allowed: bool,
    pub reason: String,
    pub model: String,
    pub parameter_billions: Option<f64>,
    pub source: &'static str,
}

impl WidgetGenerationEligibility {
    pub fn require(&self) -> Result<(), String> {
        if self.allowed {
            Ok(())
        } else {
            Err(self.reason.clone())
        }
    }
}

pub fn widget_generation_eligibility(settings: &Settings) -> WidgetGenerationEligibility {
    let (model, parameter_billions, source) = if settings.mode == "api" {
        let size = api_size_billions(&settings.api_model);
        (
            settings.api_model.clone(),
            size,
            if size.is_some() {
                "api-name"
            } else {
                "unknown"
            },
        )
    } else if let Some(spec) = spec(settings.local_model) {
        (
            spec.name.to_owned(),
            Some(spec.parameter_billions),
            "catalog",
        )
    } else {
        let label = custom_model_path(settings)
            .and_then(|path| std::fs::File::open(path).ok())
            .and_then(|file| gguf_size_label(io::BufReader::new(file)).ok().flatten());
        match label {
            Some(label) => (
                format!("직접 지정 모델 ({label})"),
                size_billions(&label),
                "gguf",
            ),
            None => ("직접 지정 모델".into(), None, "unknown"),
        }
    };
    let allowed = parameter_billions.map_or(settings.mode == "api", allows_widget_generation);
    let reason = match parameter_billions {
        Some(size) if allowed && settings.mode == "api" => format!("API 모델 이름에 {size}B로 표시되어 있어 위젯 제작을 허용해요."),
        Some(size) if allowed => format!("{size}B 모델은 위젯을 제작할 수 있어요."),
        Some(size) => format!("위젯 제작·수정에는 9B보다 큰 모델이 필요해요. 현재 모델은 {size}B예요."),
        None if settings.mode == "api" => "크기가 공개되지 않은 API 모델은 크기 판정 없이 제작을 허용해요. 이름에 9B 이하가 명시된 모델은 사용할 수 없어요.".into(),
        None => "직접 지정한 GGUF의 general.size_label에서 모델 크기를 확인할 수 없어 위젯 제작·수정을 사용할 수 없어요. 크기가 확인된 9B 초과 모델이 필요해요.".into(),
    };
    WidgetGenerationEligibility {
        allowed,
        reason,
        model,
        parameter_billions,
        source,
    }
}

/// Widget creation and repair need a model above 9B; the local model list shows the same line.
pub(super) fn allows_widget_generation(size: f64) -> bool {
    size > 9.
}

fn api_size_billions(model: &str) -> Option<f64> {
    model
        .split(|character: char| !character.is_ascii_alphanumeric() && character != '.')
        .filter_map(|token| {
            let token = token.to_ascii_uppercase();
            size_billions(token.strip_prefix('E').unwrap_or(&token))
        })
        .min_by(f64::total_cmp)
}

fn size_billions(label: &str) -> Option<f64> {
    let number = label.trim().strip_suffix('B')?;
    if number.is_empty()
        || !number
            .bytes()
            .all(|byte| byte.is_ascii_digit() || byte == b'.')
    {
        return None;
    }
    let size: f64 = number.parse().ok()?;
    (size.is_finite() && size > 0.).then_some(size)
}

fn invalid_metadata() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, "Unsupported GGUF metadata")
}

fn read_u32(reader: &mut impl Read) -> io::Result<u32> {
    let mut bytes = [0; 4];
    reader.read_exact(&mut bytes)?;
    Ok(u32::from_le_bytes(bytes))
}

fn read_u64(reader: &mut impl Read) -> io::Result<u64> {
    let mut bytes = [0; 8];
    reader.read_exact(&mut bytes)?;
    Ok(u64::from_le_bytes(bytes))
}

fn read_string(reader: &mut impl Read, limit: usize) -> io::Result<String> {
    let length = read_u64(reader)?;
    if length > limit as u64 {
        return Err(invalid_metadata());
    }
    let mut bytes = vec![0; length as usize];
    reader.read_exact(&mut bytes)?;
    String::from_utf8(bytes).map_err(|_| invalid_metadata())
}

fn skip_value(reader: &mut impl Read, kind: u32, depth: usize) -> io::Result<()> {
    if depth > 4 {
        return Err(invalid_metadata());
    }
    let bytes = match kind {
        0 | 1 | 7 => 1,
        2 | 3 => 2,
        4..=6 => 4,
        10..=12 => 8,
        8 => read_u64(reader)?,
        9 => {
            let element_kind = read_u32(reader)?;
            let length = read_u64(reader)?;
            if length > 1_000_000 {
                return Err(invalid_metadata());
            }
            for _ in 0..length {
                skip_value(reader, element_kind, depth + 1)?;
            }
            return Ok(());
        }
        _ => return Err(invalid_metadata()),
    };
    if bytes > 8 * 1024 * 1024 {
        return Err(invalid_metadata());
    }
    if io::copy(&mut reader.take(bytes), &mut io::sink())? != bytes {
        return Err(invalid_metadata());
    }
    Ok(())
}

// Read bounded little-endian GGUF v2/v3 metadata, never tensor data or filename hints.
// Format: https://github.com/ggml-org/ggml/blob/master/docs/gguf.md
fn gguf_size_label(reader: impl Read) -> io::Result<Option<String>> {
    let mut reader = reader.take(8 * 1024 * 1024);
    let mut magic = [0; 4];
    reader.read_exact(&mut magic)?;
    if &magic != b"GGUF" || !matches!(read_u32(&mut reader)?, 2 | 3) {
        return Err(invalid_metadata());
    }
    let _tensor_count = read_u64(&mut reader)?;
    let count = read_u64(&mut reader)?;
    if count > 8192 {
        return Err(invalid_metadata());
    }
    for _ in 0..count {
        let key = read_string(&mut reader, 1024)?;
        let kind = read_u32(&mut reader)?;
        if key == "general.size_label" {
            if kind != 8 {
                return Err(invalid_metadata());
            }
            return read_string(&mut reader, 64).map(Some);
        }
        skip_value(&mut reader, kind, 0)?;
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::LocalModel;

    fn gguf(label: Option<&str>) -> Vec<u8> {
        let mut data = b"GGUF".to_vec();
        data.extend(3_u32.to_le_bytes());
        data.extend(1_u64.to_le_bytes());
        data.extend(u64::from(label.is_some()).to_le_bytes());
        if let Some(label) = label {
            data.extend(18_u64.to_le_bytes());
            data.extend(b"general.size_label");
            data.extend(8_u32.to_le_bytes());
            data.extend((label.len() as u64).to_le_bytes());
            data.extend(label.as_bytes());
        }
        data
    }

    #[test]
    fn only_catalog_models_strictly_above_nine_b_can_develop_widgets() {
        for local_model in super::super::CATALOG {
            let settings = Settings {
                local_model,
                ..Settings::default()
            };
            let policy = widget_generation_eligibility(&settings);
            assert_eq!(
                policy.allowed,
                local_model == LocalModel::Gemma4_12B,
                "{local_model:?}"
            );
            assert_eq!(policy.source, "catalog");
            assert_eq!(policy.require().is_ok(), policy.allowed);
        }
    }

    #[test]
    fn custom_gguf_uses_metadata_and_never_filename_or_raw_parameter_rounding() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("Pretend-70B.gguf");
        let settings = Settings {
            local_model: LocalModel::Custom,
            local_model_path: path.display().to_string(),
            ..Settings::default()
        };
        for (label, allowed) in [
            (Some("4B"), false),
            (Some("9B"), false),
            (Some("12B"), true),
            (Some("32B"), true),
            (Some("12B-A3B"), false),
            (None, false),
        ] {
            std::fs::write(&path, gguf(label)).unwrap();
            assert_eq!(
                widget_generation_eligibility(&settings).allowed,
                allowed,
                "{label:?}"
            );
        }
        std::fs::write(&path, b"12B not a GGUF").unwrap();
        assert!(!widget_generation_eligibility(&settings).allowed);
    }

    #[test]
    fn api_named_sizes_are_enforced_and_unpublished_sizes_are_explicitly_unverified() {
        for (api_model, size, allowed) in [
            ("gpt-4.1", None, true),
            ("qwen3.5-9b", Some(9.), false),
            ("Qwen/Qwen3.8-4B-Distill", Some(4.), false),
            ("gemma-4-E4B-it", Some(4.), false),
            ("ministral-3-8b", Some(8.), false),
            ("gemma-4-12b", Some(12.), true),
            ("qwen3:32b", Some(32.), true),
        ] {
            let settings = Settings {
                mode: "api".into(),
                api_model: api_model.into(),
                ..Settings::default()
            };
            let policy = widget_generation_eligibility(&settings);
            assert_eq!(policy.allowed, allowed, "{api_model}");
            assert_eq!(policy.parameter_billions, size, "{api_model}");
            assert_eq!(
                policy.source,
                if size.is_some() {
                    "api-name"
                } else {
                    "unknown"
                }
            );
            if size.is_none() {
                assert!(policy.reason.contains("크기 판정 없이"));
            }
        }
        for label in ["9B-A3B", "8x7B", "E4B", "NaNB", "-12B", "1e2B", "", "12"] {
            assert_eq!(size_billions(label), None, "{label}");
        }
        assert_eq!(size_billions("9B"), Some(9.));
        assert_eq!(size_billions("12.5B"), Some(12.5));
    }

    #[test]
    fn malformed_or_oversized_metadata_is_bounded_and_rejected() {
        let valid = gguf(Some("12B"));
        for end in 0..valid.len() {
            assert!(gguf_size_label(&valid[..end]).is_err());
        }
        let mut oversized = gguf(Some("12B"));
        oversized[16..24].copy_from_slice(&u64::MAX.to_le_bytes());
        assert!(gguf_size_label(oversized.as_slice()).is_err());
        let mut oversized = gguf(Some("12B"));
        oversized[24..32].copy_from_slice(&u64::MAX.to_le_bytes());
        assert!(gguf_size_label(oversized.as_slice()).is_err());
    }

    #[test]
    fn size_label_after_unrelated_scalar_array_and_string_metadata_is_read_correctly() {
        let mut data = gguf(None);
        data[16..24].copy_from_slice(&3_u64.to_le_bytes());
        data.extend(6_u64.to_le_bytes());
        data.extend(b"tokens");
        data.extend(9_u32.to_le_bytes());
        data.extend(4_u32.to_le_bytes());
        data.extend(2_u64.to_le_bytes());
        data.extend(123_u32.to_le_bytes());
        data.extend(456_u32.to_le_bytes());
        data.extend(12_u64.to_le_bytes());
        data.extend(b"general.name");
        data.extend(8_u32.to_le_bytes());
        data.extend(3_u64.to_le_bytes());
        data.extend(b"70B");
        data.extend(&gguf(Some("9B"))[24..]);
        assert_eq!(gguf_size_label(data.as_slice()).unwrap(), Some("9B".into()));
    }
}
