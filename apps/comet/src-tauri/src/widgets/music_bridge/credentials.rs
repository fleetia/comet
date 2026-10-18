use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub(super) struct Credential {
    pub owner: String,
    pub secret: String,
}

fn gate() -> &'static std::sync::Mutex<()> {
    static GATE: std::sync::Mutex<()> = std::sync::Mutex::new(());
    &GATE
}

fn account(owner: &str, pairing_id: &str) -> Result<String, String> {
    uuid::Uuid::parse_str(owner).map_err(|_| "음악 위젯 식별자가 올바르지 않아요.")?;
    uuid::Uuid::parse_str(pairing_id).map_err(|_| "음악 연결 식별자가 올바르지 않아요.")?;
    Ok(format!("{owner}:{pairing_id}"))
}

#[cfg(not(test))]
fn entry(owner: &str, pairing_id: &str) -> Result<keyring::Entry, String> {
    keyring::Entry::new("space.starlight.comet.music", &account(owner, pairing_id)?)
        .map_err(|_| "OS 자격 증명 저장소를 열 수 없어요.".into())
}

#[cfg(not(test))]
pub(super) fn load(owner: &str, pairing_id: &str) -> Result<Option<Credential>, String> {
    let _gate = gate().lock().unwrap();
    let value = match entry(owner, pairing_id)?.get_password() {
        Ok(value) => value,
        Err(keyring::Error::NoEntry) => return Ok(None),
        Err(_) => {
            return Err(
                "저장된 음악 연결을 읽지 못했어요. OS 자격 증명 접근을 확인해 주세요.".into(),
            )
        }
    };
    let credential: Credential = serde_json::from_str(&value)
        .map_err(|_| "저장된 음악 연결을 읽지 못했어요. 다시 페어링해 주세요.")?;
    if credential.owner != owner || !super::is_hex(&credential.secret, 64) {
        return Err("저장된 음악 연결의 소유 정보가 일치하지 않아요.".into());
    }
    Ok(Some(credential))
}

#[cfg(not(test))]
pub(super) fn save(
    owner: &str,
    pairing_id: &str,
    secret: &str,
    active: impl Fn() -> bool,
) -> Result<(), String> {
    let _gate = gate().lock().unwrap();
    if !active() {
        return Err("이미 해제한 음악 연결이에요.".into());
    }
    let value = serde_json::to_string(&Credential {
        owner: owner.into(),
        secret: secret.into(),
    })
    .map_err(|_| "음악 연결을 저장하지 못했어요.")?;
    let entry = entry(owner, pairing_id)?;
    entry
        .set_password(&value)
        .map_err(|_| "OS 자격 증명 저장소에 음악 연결을 저장하지 못했어요.".to_string())?;
    if !active() {
        let _ = entry.delete_credential();
        return Err("이미 해제한 음악 연결이에요.".into());
    }
    Ok(())
}

#[cfg(not(test))]
pub(super) fn delete(owner: &str, pairing_id: &str) -> Result<(), String> {
    let _gate = gate().lock().unwrap();
    match entry(owner, pairing_id)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err("OS 자격 증명 저장소에서 음악 연결을 지우지 못했어요.".into()),
    }
}

// Loopback tests exercise persistence without touching the user's OS credentials.
#[cfg(test)]
fn memory() -> &'static std::sync::Mutex<std::collections::HashMap<String, Credential>> {
    static STORE: std::sync::OnceLock<
        std::sync::Mutex<std::collections::HashMap<String, Credential>>,
    > = std::sync::OnceLock::new();
    STORE.get_or_init(Default::default)
}

#[cfg(test)]
pub(super) fn load(owner: &str, pairing_id: &str) -> Result<Option<Credential>, String> {
    let _gate = gate().lock().unwrap();
    Ok(memory()
        .lock()
        .unwrap()
        .get(&account(owner, pairing_id)?)
        .cloned())
}

#[cfg(test)]
pub(super) fn save(
    owner: &str,
    pairing_id: &str,
    secret: &str,
    active: impl Fn() -> bool,
) -> Result<(), String> {
    let _gate = gate().lock().unwrap();
    if !active() {
        return Err("이미 해제한 음악 연결이에요.".into());
    }
    memory().lock().unwrap().insert(
        account(owner, pairing_id)?,
        Credential {
            owner: owner.into(),
            secret: secret.into(),
        },
    );
    Ok(())
}

#[cfg(test)]
pub(super) fn delete(owner: &str, pairing_id: &str) -> Result<(), String> {
    let _gate = gate().lock().unwrap();
    memory()
        .lock()
        .unwrap()
        .remove(&account(owner, pairing_id)?);
    Ok(())
}
