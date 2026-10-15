use aes_gcm::{
    aead::{rand_core::RngCore, Aead, KeyInit, OsRng, Payload},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use std::{fs, io::Read, path::Path};

pub(crate) const SOURCE_LIMIT: usize = 1024 * 1024;
const HEADER: &str = "COMET-TALK-AES256GCM-V1\n";
const STORED_LIMIT: usize = (SOURCE_LIMIT + 28).div_ceil(3) * 4 + 32;
// A portable bundled key protects the stored format, not secrets from the app owner.
const KEY: &[u8; 32] = &[
    0x91, 0x6d, 0x24, 0xb7, 0x48, 0xca, 0xef, 0x08, 0x72, 0x35, 0x1c, 0xd9, 0x66, 0xa2, 0xf0, 0x53,
    0x4e, 0x83, 0x19, 0xbb, 0x07, 0xd2, 0x5c, 0xe6, 0xa8, 0x30, 0x7f, 0x41, 0x95, 0x0a, 0xc3, 0x6e,
];

pub(crate) fn is_encrypted(data: &[u8]) -> bool {
    encrypted_header(data).is_some()
}

fn encrypted_header(data: &[u8]) -> Option<&'static [u8]> {
    if data.starts_with(HEADER.as_bytes()) {
        Some(HEADER.as_bytes())
    } else if data.starts_with(crate::legacy_names::talk_header()) {
        Some(crate::legacy_names::talk_header())
    } else {
        None
    }
}

pub(crate) fn encode(source: &str) -> Result<Vec<u8>, String> {
    if source.len() > SOURCE_LIMIT {
        return Err("대본 파일은 1 MiB 이하여야 해요.".into());
    }
    let cipher = Aes256Gcm::new(KEY.into());
    let mut nonce = [0u8; 12];
    OsRng
        .try_fill_bytes(&mut nonce)
        .map_err(|_| "암호화 난수를 만들 수 없어요.")?;
    let encrypted = cipher
        .encrypt(
            Nonce::from_slice(&nonce),
            Payload {
                msg: source.as_bytes(),
                aad: HEADER.as_bytes(),
            },
        )
        .map_err(|_| "대본을 암호화하지 못했어요.")?;
    let mut payload = nonce.to_vec();
    payload.extend(encrypted);
    Ok(format!("{HEADER}{}", STANDARD.encode(payload)).into_bytes())
}

pub(crate) fn decode(data: &[u8]) -> Result<String, String> {
    if data.len() > STORED_LIMIT {
        return Err("암호화 대본 파일 크기 제한을 넘었어요.".into());
    }
    let plaintext = if let Some(header) = encrypted_header(data) {
        let payload = STANDARD
            .decode(&data[header.len()..])
            .map_err(|_| "암호화 대본 형식이 잘못됐어요.")?;
        if payload.len() < 28 {
            return Err("암호화 대본이 잘렸어요.".into());
        }
        Aes256Gcm::new(KEY.into())
            .decrypt(
                Nonce::from_slice(&payload[..12]),
                Payload {
                    msg: &payload[12..],
                    aad: header,
                },
            )
            .map_err(|_| "대본 인증에 실패했어요. 파일이 손상되었거나 키가 달라요.")?
    } else {
        data.to_vec()
    };
    if plaintext.len() > SOURCE_LIMIT {
        return Err("대본 파일은 1 MiB 이하여야 해요.".into());
    }
    String::from_utf8(plaintext).map_err(|_| "UTF-8 대본이 필요해요.".into())
}

pub(crate) fn read_bytes(path: &Path) -> Result<Vec<u8>, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > STORED_LIMIT as u64 {
        return Err("대본 파일 크기 제한을 넘었거나 일반 파일이 아니에요.".into());
    }
    let file = fs::File::open(path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > STORED_LIMIT as u64 {
        return Err("대본 파일 크기 제한을 넘었거나 일반 파일이 아니에요.".into());
    }
    let mut data = Vec::new();
    file.take(STORED_LIMIT as u64 + 1)
        .read_to_end(&mut data)
        .map_err(|error| error.to_string())?;
    if data.len() > STORED_LIMIT {
        return Err("대본 파일 크기 제한을 넘었어요.".into());
    }
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roundtrip_preserves_source_and_randomizes_ciphertext() {
        let source = "# 원문\nformat: 1\n\n";
        let first = encode(source).unwrap();
        assert!(is_encrypted(&first));
        assert_ne!(first, encode(source).unwrap());
        assert_eq!(decode(&first).unwrap(), source);
        assert_eq!(decode(source.as_bytes()).unwrap(), source);
    }

    #[test]
    fn authentication_rejects_changed_ciphertext_and_nonce() {
        let encrypted = encode("format: 1\n").unwrap();
        let payload = STANDARD.decode(&encrypted[HEADER.len()..]).unwrap();
        for offset in [0, 12, payload.len() - 1] {
            let mut tampered = payload.clone();
            tampered[offset] ^= 1;
            let stored = format!("{HEADER}{}", STANDARD.encode(tampered));
            assert!(decode(stored.as_bytes()).is_err());
        }
        assert!(decode(HEADER.as_bytes()).is_err());
    }

    #[test]
    fn legacy_envelope_remains_readable() {
        let source = "format: 1\n";
        let cipher = Aes256Gcm::new(KEY.into());
        let nonce = [7u8; 12];
        let encrypted = cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: source.as_bytes(),
                    aad: crate::legacy_names::talk_header(),
                },
            )
            .unwrap();
        let mut stored = crate::legacy_names::talk_header().to_vec();
        let mut payload = nonce.to_vec();
        payload.extend(encrypted);
        stored.extend(STANDARD.encode(payload).as_bytes());
        assert_eq!(decode(&stored).unwrap(), source);
    }

    #[test]
    fn encrypted_overhead_does_not_reduce_the_plaintext_limit() {
        let source = "x".repeat(SOURCE_LIMIT);
        let encrypted = encode(&source).unwrap();
        assert!(encrypted.len() > SOURCE_LIMIT);
        assert_eq!(decode(&encrypted).unwrap(), source);
        assert!(encode(&(source.clone() + "x")).is_err());
        assert!(decode((source + "x").as_bytes()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn named_pipe_is_rejected_before_a_blocking_open() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("pipe.talk");
        assert!(std::process::Command::new("mkfifo")
            .arg(&path)
            .status()
            .unwrap()
            .success());
        assert!(read_bytes(&path).is_err());
    }
}
