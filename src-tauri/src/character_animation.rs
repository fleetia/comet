#[path = "character_animation/import.rs"]
mod import;
pub use import::read_files;

use base64::Engine;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    io::{Cursor, Read},
    path::Path,
};

type Result<T> = std::result::Result<T, String>;
pub const MAX_ASSET_BYTES: usize = 2 * 1024 * 1024;
pub const MAX_DECODED_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_ASSETS: usize = 32 * 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Frame {
    pub asset_id: String,
    pub x: u32,
    pub y: u32,
    pub width: u32,
    pub height: u32,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Clip {
    pub id: String,
    pub name: String,
    pub fps: u32,
    pub frames: Vec<Frame>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding {
    pub clip_id: String,
    pub repeat: bool,
    pub interval_ms: u32,
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Bindings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub idle: Option<Binding>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub speaking: Option<Binding>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub click: Option<Binding>,
}
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Animation {
    pub clips: Vec<Clip>,
    #[serde(default)]
    pub bindings: Bindings,
    // A missing key inherits the base binding; a present null explicitly disables it.
    #[serde(default)]
    pub overrides: BTreeMap<String, BTreeMap<String, Option<Binding>>>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AssetInfo {
    pub mime: String,
    pub width: u32,
    pub height: u32,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AnimationAsset {
    pub asset_id: String,
    pub mime: String,
    pub width: u32,
    pub height: u32,
    pub data: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PackAnimationAsset {
    pub source_id: String,
    pub asset_id: String,
    pub mime: String,
    pub width: u32,
    pub height: u32,
    pub data: String,
}
impl PackAnimationAsset {
    pub fn asset(&self) -> AnimationAsset {
        AnimationAsset {
            asset_id: self.asset_id.clone(),
            mime: self.mime.clone(),
            width: self.width,
            height: self.height,
            data: self.data.clone(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct PreparedAsset {
    pub asset_id: String,
    pub info: AssetInfo,
    pub bytes: Vec<u8>,
}
impl PreparedAsset {
    pub fn payload(&self) -> AnimationAsset {
        AnimationAsset {
            asset_id: self.asset_id.clone(),
            mime: self.info.mime.clone(),
            width: self.info.width,
            height: self.info.height,
            data: base64::engine::general_purpose::STANDARD.encode(&self.bytes),
        }
    }
}

fn valid_id(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}
fn valid_text(value: &str, limit: usize) -> bool {
    !value.trim().is_empty()
        && value.trim() == value
        && value.chars().count() <= limit
        && !value.chars().any(char::is_control)
}

pub fn validate_animation(
    animation: &Animation,
    expressions: &BTreeMap<String, String>,
) -> Result<()> {
    if animation.clips.len() > 32 {
        return Err("애니메이션은 캐릭터마다 32개까지 등록할 수 있어요.".into());
    }
    let mut clips = BTreeSet::new();
    for clip in &animation.clips {
        if !valid_text(&clip.id, 64)
            || !valid_text(&clip.name, 80)
            || !clips.insert(clip.id.as_str())
            || !(1..=30).contains(&clip.fps)
            || !(1..=64).contains(&clip.frames.len())
        {
            return Err("애니메이션 이름·ID·속도(1~30)·프레임 수(1~64)를 확인해 주세요.".into());
        }
        let size = (clip.frames[0].width, clip.frames[0].height);
        for frame in &clip.frames {
            if !valid_id(&frame.asset_id)
                || frame.width == 0
                || frame.height == 0
                || frame.width > 4096
                || frame.height > 4096
                || frame.x.checked_add(frame.width).is_none()
                || frame.y.checked_add(frame.height).is_none()
                || (frame.width, frame.height) != size
            {
                return Err(
                    "한 애니메이션의 프레임은 같은 크기의 올바른 이미지 영역이어야 해요.".into(),
                );
            }
        }
    }
    let validate_binding = |binding: &Binding| -> Result<()> {
        if !clips.contains(binding.clip_id.as_str()) || binding.interval_ms > 60_000 {
            return Err("상황에 연결한 애니메이션과 반복 간격(0~60000ms)을 확인해 주세요.".into());
        }
        Ok(())
    };
    for binding in [
        &animation.bindings.idle,
        &animation.bindings.speaking,
        &animation.bindings.click,
    ]
    .into_iter()
    .flatten()
    {
        validate_binding(binding)?;
    }
    if animation
        .bindings
        .click
        .as_ref()
        .is_some_and(|binding| binding.repeat || binding.interval_ms != 0)
    {
        return Err("클릭 애니메이션은 반복 간격 없이 한 번만 재생할 수 있어요.".into());
    }
    for (expression, bindings) in &animation.overrides {
        if !expressions.contains_key(expression)
            || bindings
                .keys()
                .any(|key| !["idle", "speaking"].contains(&key.as_str()))
        {
            return Err(
                "표정별 애니메이션은 등록된 표정의 평상시·말하는 동안만 설정할 수 있어요.".into(),
            );
        }
        for binding in bindings.values().flatten() {
            validate_binding(binding)?;
        }
    }
    Ok(())
}

pub fn referenced_assets(animation: Option<&Animation>) -> BTreeSet<&str> {
    animation
        .into_iter()
        .flat_map(|animation| &animation.clips)
        .flat_map(|clip| &clip.frames)
        .map(|frame| frame.asset_id.as_str())
        .collect()
}

pub fn validate_references(
    animation: Option<&Animation>,
    assets: &BTreeMap<String, AssetInfo>,
) -> Result<()> {
    let mut total = 0_u64;
    for id in referenced_assets(animation) {
        let info = assets
            .get(id)
            .ok_or("애니메이션 프레임의 이미지가 없어요. 이미지를 다시 선택해 주세요.")?;
        validate_info(id, info)?;
        total = total
            .checked_add(u64::from(info.width) * u64::from(info.height) * 4)
            .ok_or("애니메이션 이미지가 너무 커요.")?;
    }
    if total > MAX_DECODED_BYTES {
        return Err("캐릭터의 애니메이션 이미지는 펼쳤을 때 합계 64 MiB 이하여야 해요.".into());
    }
    for frame in animation
        .into_iter()
        .flat_map(|animation| &animation.clips)
        .flat_map(|clip| &clip.frames)
    {
        let info = assets
            .get(&frame.asset_id)
            .ok_or("애니메이션 이미지가 없어요.")?;
        if frame.width == 0
            || frame.height == 0
            || frame
                .x
                .checked_add(frame.width)
                .is_none_or(|right| right > info.width)
            || frame
                .y
                .checked_add(frame.height)
                .is_none_or(|bottom| bottom > info.height)
        {
            return Err("애니메이션 프레임이 이미지 영역을 벗어났어요.".into());
        }
    }
    Ok(())
}

fn validate_info(id: &str, info: &AssetInfo) -> Result<()> {
    if !valid_id(id)
        || info.mime != "image/png"
        || !(1..=4096).contains(&info.width)
        || !(1..=4096).contains(&info.height)
    {
        return Err("애니메이션 이미지는 가로·세로 4096px 이하의 PNG여야 해요.".into());
    }
    Ok(())
}

pub fn prepare_png(bytes: Vec<u8>) -> Result<PreparedAsset> {
    if bytes.is_empty() || bytes.len() > MAX_ASSET_BYTES || !bytes.starts_with(b"\x89PNG\r\n\x1a\n")
    {
        return Err("애니메이션에는 2 MiB 이하의 PNG 이미지만 사용할 수 있어요.".into());
    }
    let mut decoder = png::Decoder::new(Cursor::new(&bytes));
    decoder.set_limits(png::Limits {
        bytes: MAX_DECODED_BYTES as usize,
    });
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|_| "PNG 이미지를 읽지 못했어요.")?;
    let info = AssetInfo {
        mime: "image/png".into(),
        width: reader.info().width,
        height: reader.info().height,
    };
    let asset_id = hex::encode(Sha256::digest(&bytes));
    validate_info(&asset_id, &info)?;
    if reader.info().animation_control.is_some() {
        return Err("저장할 프레임 자산은 정지 PNG여야 해요. APNG는 이미지 가져오기에서 프레임으로 펼쳐 주세요.".into());
    }
    let size = reader
        .output_buffer_size()
        .filter(|size| *size <= MAX_DECODED_BYTES as usize)
        .ok_or("PNG 이미지가 너무 커요.")?;
    let mut decoded = vec![0; size];
    reader
        .next_frame(&mut decoded)
        .map_err(|_| "PNG 이미지의 픽셀을 읽지 못했어요.")?;
    reader.finish().map_err(|_| "PNG 이미지가 손상됐어요.")?;
    Ok(PreparedAsset {
        asset_id,
        info,
        bytes,
    })
}

pub fn prepare_assets(assets: Vec<AnimationAsset>) -> Result<Vec<PreparedAsset>> {
    if assets.len() > MAX_ASSETS {
        return Err("애니메이션 이미지가 너무 많아요.".into());
    }
    let mut prepared = Vec::with_capacity(assets.len());
    let mut seen = BTreeSet::new();
    let mut decoded_bytes = 0_u64;
    let mut encoded_bytes = 0_usize;
    for asset in assets {
        if !seen.insert(asset.asset_id.clone()) || asset.data.len() > MAX_ASSET_BYTES * 4 / 3 + 4 {
            return Err("중복되거나 너무 큰 애니메이션 이미지가 있어요.".into());
        }
        encoded_bytes = encoded_bytes
            .checked_add(asset.data.len())
            .ok_or("애니메이션 이미지가 너무 커요.")?;
        if encoded_bytes > crate::characters::MAX_PACK_BYTES {
            return Err("애니메이션 이미지 데이터는 합계 32 MiB 이하여야 해요.".into());
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&asset.data)
            .map_err(|_| "애니메이션 이미지 데이터를 읽지 못했어요.")?;
        let value = prepare_png(bytes)?;
        if value.asset_id != asset.asset_id
            || value.info.mime != asset.mime
            || value.info.width != asset.width
            || value.info.height != asset.height
        {
            return Err("애니메이션 이미지 정보와 실제 파일이 다릅니다.".into());
        }
        decoded_bytes += u64::from(value.info.width) * u64::from(value.info.height) * 4;
        if decoded_bytes > MAX_DECODED_BYTES {
            return Err("캐릭터의 애니메이션 이미지는 펼쳤을 때 합계 64 MiB 이하여야 해요.".into());
        }
        prepared.push(value);
    }
    Ok(prepared)
}

fn read_file_bytes(path: &Path) -> Result<Vec<u8>> {
    let file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_ASSET_BYTES as u64 {
        return Err("2 MiB 이하의 PNG·APNG 파일을 선택해 주세요.".into());
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_ASSET_BYTES as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok(bytes)
}

pub fn initialize(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS character_animation_assets(character_id TEXT NOT NULL,asset_id TEXT NOT NULL,mime TEXT NOT NULL,width INTEGER NOT NULL,height INTEGER NOT NULL,data BLOB NOT NULL,PRIMARY KEY(character_id,asset_id));")
        .map_err(|error| error.to_string())
}
pub fn list(conn: &Connection, id: &str) -> Result<BTreeMap<String, AssetInfo>> {
    let mut statement = conn.prepare("SELECT asset_id,mime,width,height FROM character_animation_assets WHERE character_id=?")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([id], |row| {
            Ok((
                row.get(0)?,
                AssetInfo {
                    mime: row.get(1)?,
                    width: row.get(2)?,
                    height: row.get(3)?,
                },
            ))
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<std::result::Result<_, _>>()
        .map_err(|error| error.to_string())
}
pub fn get(conn: &Connection, id: &str, asset_id: &str) -> Result<Option<PreparedAsset>> {
    conn.query_row("SELECT mime,width,height,data FROM character_animation_assets WHERE character_id=?1 AND asset_id=?2", params![id, asset_id], |row| {
        Ok(PreparedAsset { asset_id: asset_id.into(), info: AssetInfo { mime: row.get(0)?, width: row.get(1)?, height: row.get(2)? }, bytes: row.get(3)? })
    }).optional().map_err(|error| error.to_string())
}
pub fn all(conn: &Connection, id: &str) -> Result<Vec<PreparedAsset>> {
    list(conn, id)?
        .keys()
        .map(|asset_id| {
            get(conn, id, asset_id)?.ok_or_else(|| "애니메이션 이미지가 없어요.".into())
        })
        .collect()
}
pub fn put(conn: &Connection, id: &str, asset: &PreparedAsset) -> Result<()> {
    conn.execute("INSERT INTO character_animation_assets(character_id,asset_id,mime,width,height,data) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(character_id,asset_id) DO NOTHING",
        params![id, asset.asset_id, asset.info.mime, asset.info.width, asset.info.height, asset.bytes])
        .map_err(|error| error.to_string())?;
    Ok(())
}
pub fn retain(conn: &Connection, id: &str, animation: Option<&Animation>) -> Result<()> {
    let keep = referenced_assets(animation);
    for asset_id in list(conn, id)?.keys() {
        if !keep.contains(asset_id.as_str()) {
            conn.execute(
                "DELETE FROM character_animation_assets WHERE character_id=?1 AND asset_id=?2",
                params![id, asset_id],
            )
            .map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
pub(crate) fn png_fixture(width: u32, height: u32, value: u8, animated: bool) -> Vec<u8> {
    let mut bytes = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut bytes, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        if animated {
            encoder.set_animated(1, 0).unwrap();
        }
        let mut writer = encoder.write_header().unwrap();
        writer
            .write_image_data(&vec![value; width as usize * height as usize * 4])
            .unwrap();
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> (PreparedAsset, Animation) {
        let asset = prepare_png(png_fixture(4, 2, 255, false)).unwrap();
        let animation = Animation {
            clips: vec![Clip {
                id: "blink".into(),
                name: "눈 깜박임".into(),
                fps: 8,
                frames: vec![
                    Frame {
                        asset_id: asset.asset_id.clone(),
                        x: 0,
                        y: 0,
                        width: 2,
                        height: 2,
                    },
                    Frame {
                        asset_id: asset.asset_id.clone(),
                        x: 2,
                        y: 0,
                        width: 2,
                        height: 2,
                    },
                ],
            }],
            bindings: Bindings {
                idle: Some(Binding {
                    clip_id: "blink".into(),
                    repeat: true,
                    interval_ms: 1000,
                }),
                ..Default::default()
            },
            ..Default::default()
        };
        (asset, animation)
    }

    #[test]
    fn stored_png_assets_fully_decode_and_reject_raw_animation_truncated_or_oversized_images() {
        let bytes = png_fixture(4, 2, 255, false);
        let value = prepare_png(bytes.clone()).unwrap();
        assert_eq!((value.info.width, value.info.height), (4, 2));
        assert_eq!(value.bytes, bytes);
        assert!(prepare_png(b"\x89PNG\r\n\x1a\n-body".to_vec()).is_err());
        assert!(prepare_png(bytes[..bytes.len() - 8].to_vec()).is_err());
        let mut corrupt = bytes;
        let position = corrupt
            .windows(4)
            .position(|chunk| chunk == b"IDAT")
            .unwrap()
            + 4;
        corrupt[position] ^= 0xff;
        assert!(prepare_png(corrupt).is_err());
        assert!(prepare_png(png_fixture(2, 2, 255, true)).is_err());
        assert!(prepare_png(png_fixture(4097, 1, 255, false)).is_err());
        assert!(prepare_png(vec![0; MAX_ASSET_BYTES + 1]).is_err());
    }

    #[test]
    fn asset_payload_cannot_lie_about_hash_dimensions_mime_or_encoding() {
        let (asset, _) = sample();
        let payload = asset.payload();
        assert_eq!(
            prepare_assets(vec![payload.clone()]).unwrap()[0].bytes,
            asset.bytes
        );
        for change in ["id", "width", "mime", "data"] {
            let mut invalid = payload.clone();
            match change {
                "id" => invalid.asset_id = "0".repeat(64),
                "width" => invalid.width += 1,
                "mime" => invalid.mime = "image/gif".into(),
                _ => invalid.data = "!".into(),
            }
            assert!(prepare_assets(vec![invalid]).is_err(), "{change}");
        }
        assert!(prepare_assets(vec![payload.clone(), payload]).is_err());
    }

    #[test]
    fn selected_files_keep_order_and_identical_frames_without_writing_installed_assets() {
        let directory = tempfile::tempdir().unwrap();
        let first = directory.path().join("02.png");
        let middle = directory.path().join("01.png");
        let last = directory.path().join("03.png");
        let first_bytes = png_fixture(2, 2, 255, false);
        let middle_bytes = png_fixture(2, 2, 0, false);
        std::fs::write(&first, &first_bytes).unwrap();
        std::fs::write(&middle, &middle_bytes).unwrap();
        std::fs::write(&last, &first_bytes).unwrap();
        let selected = read_files(&[first.clone(), middle, last]).unwrap();
        assert_eq!(selected.len(), 3);
        assert_eq!(selected[0], selected[2]);
        assert_ne!(selected[0].asset_id, selected[1].asset_id);
        assert_eq!(
            selected[0].data,
            base64::engine::general_purpose::STANDARD.encode(first_bytes)
        );
        assert_eq!(
            selected[1].data,
            base64::engine::general_purpose::STANDARD.encode(middle_bytes)
        );
        assert!(read_files(&vec![first; 65]).is_err());
        assert!(read_files(&[]).unwrap().is_empty());
    }

    #[test]
    fn clips_validate_references_bounds_equal_sizes_and_binding_policy() {
        let (asset, animation) = sample();
        let expressions = BTreeMap::from([("평온".into(), "평온".into())]);
        let assets = BTreeMap::from([(asset.asset_id, asset.info)]);
        validate_animation(&animation, &expressions).unwrap();
        validate_references(Some(&animation), &assets).unwrap();
        for fps in [0, 31] {
            let mut invalid = animation.clone();
            invalid.clips[0].fps = fps;
            assert!(validate_animation(&invalid, &expressions).is_err());
        }
        let mut invalid = animation.clone();
        invalid.clips[0].frames[1].width = 1;
        assert!(validate_animation(&invalid, &expressions).is_err());
        let mut invalid = animation.clone();
        invalid.clips[0].frames[1].x = 3;
        assert!(validate_references(Some(&invalid), &assets).is_err());
        invalid.clips[0].frames[1].x = u32::MAX;
        assert!(validate_animation(&invalid, &expressions).is_err());
        let mut invalid = animation.clone();
        invalid.clips.push(invalid.clips[0].clone());
        assert!(validate_animation(&invalid, &expressions).is_err());
        let mut invalid = animation.clone();
        invalid.bindings.click = invalid.bindings.idle.clone();
        assert!(validate_animation(&invalid, &expressions).is_err());
        invalid.bindings.click = Some(Binding {
            clip_id: "missing".into(),
            repeat: false,
            interval_ms: 0,
        });
        assert!(validate_animation(&invalid, &expressions).is_err());
        let mut invalid = animation.clone();
        invalid
            .overrides
            .insert("평온".into(), BTreeMap::from([("click".into(), None)]));
        assert!(validate_animation(&invalid, &expressions).is_err());
        assert!(validate_references(Some(&animation), &BTreeMap::new()).is_err());
    }

    #[test]
    fn repeated_frames_count_unique_asset_memory_and_null_overrides_survive_roundtrip() {
        let (asset, mut animation) = sample();
        animation.clips[0].frames = vec![animation.clips[0].frames[0].clone(); 64];
        animation
            .overrides
            .insert("평온".into(), BTreeMap::from([("speaking".into(), None)]));
        let assets = BTreeMap::from([(
            asset.asset_id.clone(),
            AssetInfo {
                mime: "image/png".into(),
                width: 4096,
                height: 4096,
            },
        )]);
        validate_references(Some(&animation), &assets).unwrap();
        let value = serde_json::to_value(&animation).unwrap();
        assert!(value["overrides"]["평온"]["speaking"].is_null());
        assert!(value["overrides"]["평온"].get("idle").is_none());
        assert_eq!(
            serde_json::from_value::<Animation>(value).unwrap(),
            animation
        );
        let mut inherited = animation.clone();
        inherited.overrides.clear();
        assert_eq!(
            serde_json::to_value(inherited).unwrap()["overrides"],
            serde_json::json!({})
        );
        let mut too_many = animation.clone();
        let extra_frame = too_many.clips[0].frames[0].clone();
        too_many.clips[0].frames.push(extra_frame);
        assert!(
            validate_animation(&too_many, &BTreeMap::from([("평온".into(), "평온".into())]))
                .is_err()
        );
        let second_id = "0".repeat(64);
        let mut over_budget = animation;
        over_budget.clips[0].frames[1].asset_id = second_id.clone();
        let mut assets = assets;
        assets.insert(
            second_id,
            AssetInfo {
                mime: "image/png".into(),
                width: 1,
                height: 1,
            },
        );
        assert!(validate_references(Some(&over_budget), &assets).is_err());
    }
}
