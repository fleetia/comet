//! Windows credentials have a 2560-byte limit; publish bounded chunks through one pointer.
use super::Result;
#[cfg(target_os = "windows")]
use super::Service;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const ROOT: &str = "accounts-v1";
const PENDING: &str = "accounts-v1-pending";
const FORMAT: &str = "comet-chatgpt-chunks-v1";
const CHUNK_BYTES: usize = 2048;
const MAX_BYTES: usize = 1024 * 1024;
const ERROR: &str = "ChatGPT 자격 증명 저장소를 읽거나 저장하지 못했어요. 기존 정보는 보존했어요.";

#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Manifest {
    format: String,
    generation: String,
    chunks: usize,
    bytes: usize,
    sha256: String,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Pending {
    previous: Option<Manifest>,
    next: Manifest,
}

trait Store {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>>;
    fn set(&self, key: &str, value: &[u8]) -> Result<()>;
    fn delete(&self, key: &str) -> Result<()>;
}

#[cfg(target_os = "windows")]
struct Keyring<'a>(&'a Service);
#[cfg(target_os = "windows")]
impl Store for Keyring<'_> {
    fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
        let entry = self.0.entry_for(key)?;
        let result = if matches!(key, ROOT | PENDING) {
            entry.get_password().map(String::into_bytes)
        } else {
            entry.get_secret()
        };
        match result {
            Ok(value) => Ok(Some(value)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(ERROR.into()),
        }
    }
    fn set(&self, key: &str, value: &[u8]) -> Result<()> {
        let entry = self.0.entry_for(key)?;
        if matches!(key, ROOT | PENDING) {
            let value = std::str::from_utf8(value).map_err(|_| ERROR)?;
            entry.set_password(value)
        } else {
            entry.set_secret(value)
        }
        .map_err(|_| ERROR.into())
    }
    fn delete(&self, key: &str) -> Result<()> {
        match self.0.entry_for(key)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(ERROR.into()),
        }
    }
}

impl Manifest {
    fn validate(&self) -> Result<()> {
        if self.format != FORMAT
            || self.generation.len() != 32
            || !self.generation.bytes().all(|b| b.is_ascii_hexdigit())
            || !(1..=MAX_BYTES).contains(&self.bytes)
            || self.chunks != self.bytes.div_ceil(CHUNK_BYTES)
            || self.sha256.len() != 64
            || !self.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err(ERROR.into());
        }
        Ok(())
    }
    fn key(&self, index: usize) -> String {
        format!("accounts-v1-{}-{index}", self.generation)
    }
}

fn manifest(raw: &[u8]) -> Result<Option<Manifest>> {
    if raw.len() > MAX_BYTES {
        return Err(ERROR.into());
    }
    let value: serde_json::Value = serde_json::from_slice(raw).map_err(|_| ERROR)?;
    if value.get("format").is_none() {
        return Ok(None);
    }
    let manifest: Manifest = serde_json::from_value(value).map_err(|_| ERROR)?;
    manifest.validate()?;
    Ok(Some(manifest))
}

fn recover(store: &impl Store, current: Option<&Manifest>) -> Result<()> {
    let Some(raw) = store.get(PENDING)? else {
        return Ok(());
    };
    if raw.len() > 1280 {
        return Err(ERROR.into());
    }
    let pending: Pending = serde_json::from_slice(&raw).map_err(|_| ERROR)?;
    pending.next.validate()?;
    if let Some(previous) = &pending.previous {
        previous.validate()?;
    }
    for snapshot in pending
        .previous
        .iter()
        .chain(std::iter::once(&pending.next))
    {
        if current.is_some_and(|current| current.generation == snapshot.generation) {
            continue;
        }
        for index in 0..snapshot.chunks {
            store.delete(&snapshot.key(index))?;
        }
    }
    store.delete(PENDING)
}

fn load_from(store: &impl Store) -> Result<Option<String>> {
    let raw = store.get(ROOT)?;
    let current = raw.as_deref().map(manifest).transpose()?.flatten();
    recover(store, current.as_ref())?;
    let Some(current) = current else {
        return raw
            .map(|raw| String::from_utf8(raw).map_err(|_| ERROR.into()))
            .transpose();
    };
    let mut bytes = Vec::with_capacity(current.bytes);
    for index in 0..current.chunks {
        let chunk = store.get(&current.key(index))?.ok_or(ERROR)?;
        let expected = CHUNK_BYTES.min(current.bytes - bytes.len());
        if chunk.len() != expected {
            return Err(ERROR.into());
        }
        bytes.extend_from_slice(&chunk);
    }
    if hex::encode(Sha256::digest(&bytes)) != current.sha256 {
        return Err(ERROR.into());
    }
    String::from_utf8(bytes).map(Some).map_err(|_| ERROR.into())
}

// False means the new pointer is committed, but cleanup must be retried from its journal.
fn save_to(store: &impl Store, raw: &str) -> Result<bool> {
    if raw.is_empty() || raw.len() > MAX_BYTES {
        return Err(ERROR.into());
    }
    let previous = store
        .get(ROOT)?
        .as_deref()
        .map(manifest)
        .transpose()?
        .flatten();
    recover(store, previous.as_ref())?;
    let next = Manifest {
        format: FORMAT.into(),
        generation: uuid::Uuid::new_v4().simple().to_string(),
        chunks: raw.len().div_ceil(CHUNK_BYTES),
        bytes: raw.len(),
        sha256: hex::encode(Sha256::digest(raw.as_bytes())),
    };
    let pending = Pending { previous, next };
    store.set(PENDING, &serde_json::to_vec(&pending).map_err(|_| ERROR)?)?;
    let result = (|| {
        for (index, chunk) in raw.as_bytes().chunks(CHUNK_BYTES).enumerate() {
            store.set(&pending.next.key(index), chunk)?;
        }
        store.set(ROOT, &serde_json::to_vec(&pending.next).map_err(|_| ERROR)?)
    })();
    if let Err(error) = result {
        let _ = recover(store, pending.previous.as_ref());
        return Err(error);
    }
    Ok(recover(store, Some(&pending.next)).is_ok())
}

#[cfg(target_os = "windows")]
pub(super) fn load(service: &Service) -> Result<Option<String>> {
    load_from(&Keyring(service))
}
#[cfg(target_os = "windows")]
pub(super) fn save(service: &Service, raw: &str) -> Result<bool> {
    save_to(&Keyring(service), raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::RefCell, collections::BTreeMap};

    #[derive(Default)]
    struct Memory {
        values: RefCell<BTreeMap<String, Vec<u8>>>,
        fail_set: RefCell<Option<String>>,
        fail_delete: RefCell<bool>,
    }
    impl Store for Memory {
        fn get(&self, key: &str) -> Result<Option<Vec<u8>>> {
            Ok(self.values.borrow().get(key).cloned())
        }
        fn set(&self, key: &str, value: &[u8]) -> Result<()> {
            if self
                .fail_set
                .borrow()
                .as_deref()
                .is_some_and(|suffix| key.ends_with(suffix))
            {
                return Err("injected write failure".into());
            }
            let size = if matches!(key, ROOT | PENDING) {
                std::str::from_utf8(value).unwrap().encode_utf16().count() * 2
            } else {
                value.len()
            };
            if size > 2560 {
                return Err("Windows credential limit".into());
            }
            self.values.borrow_mut().insert(key.into(), value.to_vec());
            Ok(())
        }
        fn delete(&self, key: &str) -> Result<()> {
            if *self.fail_delete.borrow() {
                return Err("injected delete failure".into());
            }
            self.values.borrow_mut().remove(key);
            Ok(())
        }
    }
    fn accounts() -> String {
        serde_json::json!({"host_id":"host", "accounts":[
            {"id":"first", "access_token":"a".repeat(5000), "id_token":"b".repeat(3000)},
            {"id":"second", "label":"한국어😀", "refresh_token":"c".repeat(4000)}
        ]})
        .to_string()
    }
    #[test]
    fn large_multi_account_tokens_round_trip_within_windows_limits() {
        let store = Memory::default();
        let raw = accounts();
        assert!(store.set(ROOT, raw.as_bytes()).is_err());
        assert!(save_to(&store, &raw).unwrap());
        assert_eq!(load_from(&store).unwrap().unwrap(), raw);
        assert!(!String::from_utf8(store.get(ROOT).unwrap().unwrap())
            .unwrap()
            .contains("access_token"));
        let signed_out = r#"{"host_id":"host","accounts":[]}"#;
        assert!(save_to(&store, signed_out).unwrap());
        assert_eq!(load_from(&store).unwrap().unwrap(), signed_out);
        assert_eq!(store.values.borrow().len(), 2);
        assert!(!store
            .values
            .borrow()
            .values()
            .any(|value| value.windows(16).any(|part| part == b"aaaaaaaaaaaaaaaa")));
    }
    #[test]
    fn partial_chunk_and_pointer_failures_preserve_previous_credentials() {
        for chunked in [false, true] {
            for failure in ["-1", ROOT] {
                let store = Memory::default();
                let original = r#"{"host_id":"legacy","accounts":[]}"#;
                if chunked {
                    save_to(&store, original).unwrap();
                } else {
                    store.set(ROOT, original.as_bytes()).unwrap();
                }
                let before = store.values.borrow().clone();
                assert_eq!(load_from(&store).unwrap().unwrap(), original);
                *store.fail_set.borrow_mut() = Some(failure.into());
                assert!(save_to(&store, &accounts()).is_err());
                assert_eq!(load_from(&store).unwrap().unwrap(), original);
                assert_eq!(*store.values.borrow(), before);
            }
        }
    }
    #[test]
    fn abandoned_partial_snapshot_is_removed_on_the_next_load() {
        let store = Memory::default();
        let original = r#"{"host_id":"host","accounts":[]}"#;
        save_to(&store, original).unwrap();
        let before = store.values.borrow().clone();
        *store.fail_set.borrow_mut() = Some("-1".into());
        *store.fail_delete.borrow_mut() = true;
        assert!(save_to(&store, &accounts()).is_err());
        assert!(store.get(PENDING).unwrap().is_some());
        *store.fail_delete.borrow_mut() = false;
        assert_eq!(load_from(&store).unwrap().unwrap(), original);
        assert_eq!(*store.values.borrow(), before);
    }
    #[test]
    fn interrupted_cleanup_retries_without_restoring_signed_out_tokens() {
        let store = Memory::default();
        save_to(&store, &accounts()).unwrap();
        *store.fail_delete.borrow_mut() = true;
        let signed_out = r#"{"host_id":"host","accounts":[]}"#;
        assert!(!save_to(&store, signed_out).unwrap());
        assert!(store.get(PENDING).unwrap().is_some());
        assert!(load_from(&store).is_err());
        *store.fail_delete.borrow_mut() = false;
        assert_eq!(load_from(&store).unwrap().unwrap(), signed_out);
        assert_eq!(store.values.borrow().len(), 2);
    }
    #[test]
    fn tampered_or_missing_chunks_fail_without_exposing_or_replacing_data() {
        let store = Memory::default();
        save_to(&store, &accounts()).unwrap();
        let head = store.get(ROOT).unwrap().unwrap();
        let current = manifest(&head).unwrap().unwrap();
        store.values.borrow_mut().get_mut(&current.key(0)).unwrap()[0] ^= 1;
        assert_eq!(load_from(&store).unwrap_err(), ERROR);
        assert_eq!(store.get(ROOT).unwrap().unwrap(), head);
        store.delete(&current.key(0)).unwrap();
        assert_eq!(load_from(&store).unwrap_err(), ERROR);
    }
}
