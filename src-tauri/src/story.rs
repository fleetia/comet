use crate::talk::{encryption, files::atomic_write};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, Instant},
};

type Result<T> = std::result::Result<T, String>;
const MARKER: &str = ".nadir-story-initialized";
static FILE_GATE: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Choice {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub id: String,
    pub display_started_at: Option<i64>,
    pub persona: String,
    pub title: String,
    pub prompt: String,
    pub choices: Vec<Choice>,
    #[serde(skip)]
    pub character_id: String,
    #[serde(skip)]
    pub user_id: String,
    #[serde(skip)]
    pub scene: Scene,
    #[serde(skip)]
    pub epoch: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Scene {
    pub id: String,
    pub chapter: u8,
    pub title: String,
    pub prompt: String,
    pub choices: Vec<Outcome>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Outcome {
    pub id: String,
    pub label: String,
    pub delta: i32,
    pub response: String,
}

pub struct Clock {
    pub last_tick: Instant,
    pub elapsed: Duration,
}

impl Default for Clock {
    fn default() -> Self {
        Self {
            last_tick: Instant::now(),
            elapsed: Duration::ZERO,
        }
    }
}

pub fn tick(clock: &mut Clock, at: Instant) -> bool {
    let interval = at.saturating_duration_since(clock.last_tick);
    clock.last_tick = at;
    // A delayed wake contributes no suspended time and never replays missed hours.
    if interval <= Duration::from_secs(2) {
        clock.elapsed = (clock.elapsed + interval).min(Duration::from_secs(3600));
    }
    clock.elapsed >= Duration::from_secs(3600)
}

fn directory(app_data: &Path) -> Result<PathBuf> {
    let root = fs::canonicalize(app_data).map_err(|error| error.to_string())?;
    let directory = root.join("story");
    let metadata = fs::symlink_metadata(&directory).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("이야기 폴더는 일반 폴더여야 해요.".into());
    }
    Ok(directory)
}

fn resolve(app_data: &Path) -> Result<PathBuf> {
    let path = directory(app_data)?.join("nadir.story.enc");
    let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("이야기 파일은 심볼릭 링크가 아닌 일반 파일이어야 해요.".into());
    }
    Ok(path)
}

pub fn initialize_files(app_data: &Path) -> Result<()> {
    let _gate = FILE_GATE
        .lock()
        .map_err(|_| "이야기 파일 잠금을 열 수 없어요.")?;
    let root = fs::canonicalize(app_data).map_err(|error| error.to_string())?;
    if fs::symlink_metadata(root.join(MARKER)).is_ok() {
        return Ok(());
    }
    let story_directory = root.join("story");
    if fs::symlink_metadata(&story_directory).is_err() {
        fs::create_dir(&story_directory).map_err(|error| error.to_string())?;
    }
    let path = directory(app_data)?.join("nadir.story.enc");
    if fs::symlink_metadata(&path).is_err() {
        atomic_write(&path, include_bytes!("../story/nadir.story.enc"))?;
    }
    atomic_write(&root.join(MARKER), b"1")
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, b'-' | b'_'))
}

fn bounded(value: &str, max: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= max
}

pub fn validate(source: &str) -> Result<Vec<Scene>> {
    if source.len() > encryption::SOURCE_LIMIT {
        return Err("이야기 파일은 1 MiB 이하여야 해요.".into());
    }
    let scenes: Vec<Scene> =
        serde_json::from_str(source).map_err(|error| format!("이야기 JSON: {error}"))?;
    if !(15..=256).contains(&scenes.len()) {
        return Err("이야기는 15~256개가 필요해요.".into());
    }
    let mut ids = HashSet::new();
    let mut chapters = [0; 3];
    for scene in &scenes {
        if !valid_id(&scene.id)
            || !ids.insert(&scene.id)
            || scene.chapter > 2
            || !bounded(&scene.title, 80)
            || !bounded(&scene.prompt, 500)
            || !(2..=4).contains(&scene.choices.len())
        {
            return Err(format!(
                "장면 {}의 ID·단계·제목·본문·선택지 수를 확인해 주세요.",
                scene.id
            ));
        }
        chapters[usize::from(scene.chapter)] += 1;
        let mut choices = HashSet::new();
        for choice in &scene.choices {
            if !valid_id(&choice.id)
                || !choices.insert(&choice.id)
                || !bounded(&choice.label, 160)
                || !bounded(&choice.response, 500)
                || !(-5..=5).contains(&choice.delta)
            {
                return Err(format!(
                    "장면 {}의 선택지 {}를 확인해 주세요.",
                    scene.id, choice.id
                ));
            }
        }
    }
    if chapters.iter().any(|count| *count < 5) {
        return Err("각 공개 단계에 장면이 5개 이상 필요해요.".into());
    }
    Ok(scenes)
}

pub fn load(app_data: &Path) -> Result<Vec<Scene>> {
    let data = encryption::read_bytes(&resolve(app_data)?)?;
    if !encryption::is_encrypted(&data) {
        return Err("암호화된 이야기 파일이 필요해요.".into());
    }
    validate(&encryption::decode(&data)?)
}

pub fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS story_answers(request_id TEXT PRIMARY KEY,character_id TEXT NOT NULL,scene_id TEXT NOT NULL,chapter INTEGER NOT NULL,choice_id TEXT NOT NULL); CREATE INDEX IF NOT EXISTS story_character ON story_answers(character_id);")
        .map_err(|e| e.to_string())?;
    let has_user: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM pragma_table_info('story_answers') WHERE name='user_id')",
            [],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !has_user {
        db.execute_batch("ALTER TABLE story_answers ADD COLUMN user_id TEXT NOT NULL DEFAULT 'legacy-user'; CREATE INDEX IF NOT EXISTS story_user ON story_answers(character_id,user_id)").map_err(|e|e.to_string())?;
    }
    Ok(())
}

pub fn catalog() -> Result<Vec<Scene>> {
    let source = encryption::decode(include_bytes!("../story/nadir.story.enc"))?;
    serde_json::from_str(&source).map_err(|e| e.to_string())
}

pub fn disclosure_level(db: &Connection, character_id: &str, score: i32) -> Result<u8> {
    initialize(db)?;
    let completed = |chapter: u8| -> Result<i32> {
        db.query_row("SELECT COUNT(DISTINCT scene_id) FROM story_answers WHERE character_id=?1 AND chapter=?2 AND user_id=?3", params![character_id,chapter,crate::store::active_user_id(db)?], |row| row.get(0)).map_err(|e| e.to_string())
    };
    if score < 40 || completed(0)? < 5 {
        return Ok(0);
    }
    if score < 70 || completed(1)? < 5 {
        return Ok(1);
    }
    Ok(2)
}

#[cfg(test)]
pub fn prepare(db: &Connection, persona: &str, epoch: u64, seed: u64) -> Result<Option<Request>> {
    prepare_from_catalog(db, persona, epoch, seed, &catalog()?)
}

pub fn prepare_from_catalog(
    db: &Connection,
    persona: &str,
    epoch: u64,
    seed: u64,
    catalog: &[Scene],
) -> Result<Option<Request>> {
    let character = crate::characters::active_character(db, persona)?;
    if character.definition.source_id != "nadir" {
        return Ok(None);
    }
    let score = crate::store::relationships(db)?
        .into_iter()
        .find(|r| r.persona == character.id)
        .map(|r| r.score)
        .unwrap_or(20);
    let chapter = disclosure_level(db, &character.id, score)?;
    let scenes: Vec<_> = catalog
        .iter()
        .filter(|s| s.chapter == chapter)
        .cloned()
        .collect();
    let mut unseen = Vec::new();
    for scene in &scenes {
        let seen: bool = db
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM story_answers WHERE character_id=?1 AND scene_id=?2 AND user_id=?3)",
                params![character.id, scene.id,crate::store::active_user_id(db)?],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if !seen {
            unseen.push(scene);
        }
    }
    let candidates: Vec<_> = if unseen.is_empty() {
        scenes.iter().collect()
    } else {
        unseen
    };
    if candidates.is_empty() {
        return Ok(None);
    }
    let scene = candidates[seed as usize % candidates.len()].clone();
    Ok(Some(Request {
        id: uuid::Uuid::new_v4().to_string(),
        display_started_at: None,
        persona: persona.into(),
        title: scene.title.clone(),
        prompt: scene.prompt.clone(),
        choices: scene
            .choices
            .iter()
            .map(|c| Choice {
                id: c.id.clone(),
                label: c.label.clone(),
            })
            .collect(),
        character_id: character.id,
        user_id: crate::store::active_user_id(db)?,
        scene,
        epoch,
    }))
}

pub fn answer(db: &Connection, request: &Request, choice_id: &str, epoch: u64) -> Result<String> {
    if epoch != request.epoch
        || crate::store::active_user_id(db)? != request.user_id
        || crate::characters::active_character(db, &request.persona)?.id != request.character_id
    {
        return Err("이미 지나간 이야기예요.".into());
    }
    let choice = request
        .scene
        .choices
        .iter()
        .find(|c| c.id == choice_id)
        .ok_or("선택지를 확인해 주세요.")?;
    let tx = db.unchecked_transaction().map_err(|e| e.to_string())?;
    let raw_score: i32 = tx
        .query_row(
            "SELECT 20+COALESCE(SUM(delta),0) FROM character_affinity WHERE character_id=?1 AND user_id=?2",
            params![request.character_id,request.user_id],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    if request.scene.chapter
        > disclosure_level(&tx, &request.character_id, raw_score.clamp(0, 100))?
    {
        return Err("이 이야기는 다음에 이어갈게요.".into());
    }
    let delta = (raw_score.clamp(0, 100) + choice.delta).clamp(0, 100) - raw_score;
    let changed = tx.execute("INSERT OR IGNORE INTO story_answers(request_id,character_id,scene_id,chapter,choice_id,user_id) VALUES(?1,?2,?3,?4,?5,?6)", params![request.id, request.character_id, request.scene.id, request.scene.chapter, choice_id,request.user_id]).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("이미 답한 이야기예요.".into());
    }
    tx.execute("INSERT INTO character_affinity(source,character_id,day,delta,fingerprint,user_id) VALUES(?1,?2,?3,?4,?5,?6)", params![format!("story:{}",request.id),request.character_id,chrono::Utc::now().format("%Y-%m-%d").to_string(),delta,request.scene.id,request.user_id]).map_err(|e| e.to_string())?;
    crate::store::insert_experience(&tx,&request.character_id,&request.user_id,&format!("story:{}",request.id),
        &format!("{}: {}",request.scene.title,choice.label),
        &serde_json::json!({"title":request.scene.title,"prompt":request.scene.prompt,"choice":choice.label,"response":choice.response}).to_string(),
        chrono::Utc::now().timestamp_millis(),Some(request.scene.chapter))?;
    crate::store::bump_revision(&tx)?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(choice.response.clone())
}

pub fn profile(
    db: &Connection,
    character: crate::characters::InstalledCharacter,
) -> Result<crate::characters::CharacterDefinition> {
    let mut definition = character.definition;
    if definition.source_id != "nadir" {
        return Ok(definition);
    }
    let score: i32 = db
        .query_row(
            "SELECT 20+COALESCE(SUM(delta),0) FROM character_affinity WHERE character_id=?1 AND user_id=?2",
            params![character.id,crate::store::active_user_id(db)?],
            |r| r.get(0),
        )
        .map_err(|e| e.to_string())?;
    let level = disclosure_level(db, &character.id, score.clamp(0, 100))?;
    let source = crate::talk::encryption::decode(include_bytes!("../story/nadir.profile.enc"))?;
    let profiles: Vec<String> = serde_json::from_str(&source).map_err(|e| e.to_string())?;
    for canon in profiles.iter().take(usize::from(level) + 1).skip(1) {
        definition.description.push_str("\n공개가 허용된 정본: ");
        definition.description.push_str(canon);
    }
    definition.personality.push_str("\n현재 프로필에 명시된 정본만 자기 정보로 말한다. 프로필에 없는 개인사·동기·과거·비밀을 만들거나 사용자 추측과 과거 대화에서 복원하지 않는다. 묻더라도 아직 이야기할 준비가 안 됐다고 짧게 답하고 영창이나 지금의 일상으로 돌아간다.");
    Ok(definition)
}

pub fn prompt_history(
    db: &Connection,
    persona: &str,
    messages: Vec<crate::types::Message>,
) -> Result<Vec<crate::types::Message>> {
    let target = crate::characters::active_character(db, persona)?;
    if !matches!(target.definition.source_id.as_str(), "nadir" | "star-tail") {
        return Ok(messages);
    }
    for character in crate::characters::active_members(db)? {
        if character.definition.source_id != "nadir" {
            continue;
        }
        let score: i32 = db
            .query_row(
                "SELECT 20+COALESCE(SUM(delta),0) FROM character_affinity WHERE character_id=?1 AND user_id=?2",
                params![character.id,crate::store::active_user_id(db)?],
                |r| r.get(0),
            )
            .map_err(|e| e.to_string())?;
        if disclosure_level(db, &character.id, score.clamp(0, 100))? < 2 {
            return Ok(messages
                .into_iter()
                .filter(|message| message.role != "assistant")
                .collect());
        }
    }
    Ok(messages)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database(path: &std::path::Path) -> (Connection, [String; 2]) {
        let db = crate::store::open(path).unwrap();
        let imported =
            crate::characters::import_pack(&db, &crate::characters::nadir_pack()).unwrap();
        let pair = [imported[0].id.clone(), imported[1].id.clone()];
        crate::characters::apply_pair(&db, pair.clone()).unwrap();
        initialize(&db).unwrap();
        (db, pair)
    }

    #[test]
    fn builtin_characters_do_not_receive_addon_story_or_profile_rules() {
        let db = crate::store::open(std::path::Path::new(":memory:")).unwrap();
        let messages = vec![crate::types::Message {
            id: "ordinary-history".into(),
            role: "assistant".into(),
            persona: Some("builtin-a".into()),
            content: "earlier conversation".into(),
            expression: None,
            created_at: 0,
            status: "complete".into(),
        }];
        for persona in ["a", "b"] {
            assert!(prepare(&db, persona, 7, 0).unwrap().is_none());
            let character = crate::characters::active_character(&db, persona).unwrap();
            let definition = character.definition.clone();
            assert_eq!(profile(&db, character).unwrap(), definition);
            assert_eq!(
                prompt_history(&db, persona, messages.clone())
                    .unwrap()
                    .len(),
                1
            );
        }
    }

    #[test]
    fn story_initialization_does_not_restore_a_deleted_user_file() {
        let directory = tempfile::tempdir().unwrap();
        initialize_files(directory.path()).unwrap();
        assert!(load(directory.path()).is_ok());

        let path = directory.path().join("story/nadir.story.enc");
        fs::remove_file(&path).unwrap();
        initialize_files(directory.path()).unwrap();

        assert!(!path.exists());
        assert!(load(directory.path()).is_err());
    }

    #[test]
    fn uptime_counts_running_ticks_without_sleep_or_restart_catchup() {
        let start = Instant::now();
        let mut clock = Clock {
            last_tick: start,
            elapsed: Duration::ZERO,
        };
        for second in 1..3600 {
            assert!(!tick(&mut clock, start + Duration::from_secs(second)));
        }
        assert!(tick(&mut clock, start + Duration::from_secs(3600)));
        clock.elapsed = Duration::ZERO;
        assert!(!tick(&mut clock, start + Duration::from_secs(10000)));
        assert_eq!(clock.elapsed, Duration::ZERO);
        assert!(!tick(&mut clock, start + Duration::from_secs(10001)));
        assert_eq!(clock.elapsed, Duration::from_secs(1));
        assert_eq!(Clock::default().elapsed, Duration::ZERO);
    }

    #[test]
    fn random_unseen_variants_progress_only_through_affinity_and_ordered_chapters() {
        let (db, [nadir, _]) = database(std::path::Path::new(":memory:"));
        assert_eq!(disclosure_level(&db, &nadir, 100).unwrap(), 0);
        for chapter in 0..3 {
            let mut seen = std::collections::HashSet::new();
            for seed in 0..5 {
                let request = prepare(&db, "a", 7, seed).unwrap().unwrap();
                assert_eq!(request.scene.chapter, chapter);
                assert!(seen.insert(request.scene.id.clone()));
                let wire = serde_json::to_string(&request).unwrap();
                assert!(!wire.contains("delta"));
                assert!(!wire.contains("response"));
                answer(&db, &request, "listen", 7).unwrap();
            }
            if chapter == 0 {
                assert_eq!(disclosure_level(&db, &nadir, 39).unwrap(), 0);
                assert_eq!(disclosure_level(&db, &nadir, 40).unwrap(), 1);
                assert_eq!(disclosure_level(&db, &nadir, 100).unwrap(), 1);
            }
        }
        assert_eq!(disclosure_level(&db, &nadir, 69).unwrap(), 1);
        assert_eq!(disclosure_level(&db, &nadir, 70).unwrap(), 2);
        assert_eq!(catalog().unwrap().len(), 15);
    }

    #[test]
    fn llm_profile_reveals_only_current_unlocked_canon() {
        let (db, [nadir, _]) = database(std::path::Path::new(":memory:"));
        let get = || profile(&db, crate::characters::active_character(&db, "a").unwrap()).unwrap();
        assert!(!get().description.contains("악마"));
        assert!(!get().description.contains("리치"));
        for seed in 0..5 {
            let request = prepare(&db, "a", 7, seed).unwrap().unwrap();
            answer(&db, &request, "listen", 7).unwrap();
        }
        assert!(get().description.contains("악마"));
        assert!(!get().description.contains("리치"));
        for seed in 0..5 {
            let request = prepare(&db, "a", 7, seed).unwrap().unwrap();
            answer(&db, &request, "listen", 7).unwrap();
        }
        assert!(get().description.contains("리치"));
        db.execute(
            "INSERT INTO character_affinity(source,character_id,day,delta,fingerprint) VALUES('drop',?1,'today',-40,'test')",
            [&nadir],
        )
        .unwrap();
        assert!(!get().description.contains("악마"));
        assert!(!get().description.contains("리치"));
    }

    #[test]
    fn private_assistant_history_is_filtered_without_erasing_user_or_custom_context() {
        let (db, _) = database(std::path::Path::new(":memory:"));
        let messages: Vec<_> = ["user", "assistant"]
            .into_iter()
            .map(|role| crate::types::Message {
                id: role.into(),
                role: role.into(),
                persona: Some("a".into()),
                content: "earlier text".into(),
                expression: None,
                created_at: 0,
                status: "complete".into(),
            })
            .collect();
        let filtered = prompt_history(&db, "a", messages.clone()).unwrap();
        assert_eq!(filtered.len(), 1);
        assert_eq!(filtered[0].role, "user");
        let mut definition = crate::characters::active_character(&db, "b")
            .unwrap()
            .definition;
        definition.source_id = "custom".into();
        let custom = crate::characters::create(&db, &definition).unwrap();
        crate::characters::assign(&db, "b", &custom.id).unwrap();
        assert_eq!(prompt_history(&db, "b", messages).unwrap().len(), 2);
    }

    #[test]
    fn duplicate_stale_and_failed_choices_never_grant_or_lose_affinity() {
        let (db, _) = database(std::path::Path::new(":memory:"));
        let request = prepare(&db, "a", 7, 0).unwrap().unwrap();
        assert!(answer(&db, &request, "listen", 8).is_err());
        assert!(answer(&db, &request, "invalid", 7).is_err());
        db.execute_batch("CREATE TRIGGER reject_story_affinity BEFORE INSERT ON character_affinity BEGIN SELECT RAISE(ABORT,'test'); END;").unwrap();
        assert!(answer(&db, &request, "listen", 7).is_err());
        assert_eq!(
            db.query_row("SELECT COUNT(*) FROM story_answers", [], |r| r
                .get::<_, i32>(0))
                .unwrap(),
            0
        );
        db.execute_batch("DROP TRIGGER reject_story_affinity")
            .unwrap();
        answer(&db, &request, "dismiss", 7).unwrap();
        assert!(answer(&db, &request, "listen", 7).is_err());
        assert_eq!(crate::store::relationships(&db).unwrap()[0].score, 17);
    }

    #[test]
    fn score_bounds_do_not_bank_rewards_and_a_closed_gate_rejects_an_old_choice() {
        let (db, [nadir, _]) = database(std::path::Path::new(":memory:"));
        for seed in 0..10 {
            let request = prepare(&db, "a", 7, seed).unwrap().unwrap();
            answer(&db, &request, "listen", 7).unwrap();
        }
        let secret = prepare(&db, "a", 7, 0).unwrap().unwrap();
        assert_eq!(secret.scene.chapter, 2);
        db.execute(
            "INSERT INTO character_affinity(source,character_id,day,delta,fingerprint) VALUES('drop',?1,'today',-1,'test')",
            [&nadir],
        )
        .unwrap();
        assert!(answer(&db, &secret, "listen", 7).is_err());
        db.execute(
            "INSERT INTO character_affinity(source,character_id,day,delta,fingerprint) VALUES('rise',?1,'today',31,'test')",
            [&nadir],
        )
        .unwrap();
        for _ in 0..3 {
            let request = prepare(&db, "a", 7, 0).unwrap().unwrap();
            answer(&db, &request, "listen", 7).unwrap();
        }
        let request = prepare(&db, "a", 7, 0).unwrap().unwrap();
        answer(&db, &request, "dismiss", 7).unwrap();
        assert_eq!(crate::store::relationships(&db).unwrap()[0].score, 97);
    }

    #[test]
    fn progress_and_reward_survive_reopen_and_follow_identity_after_swapping_slots() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("story.sqlite");
        let (db, [nadir, star_tail]) = database(&path);
        let request = prepare(&db, "a", 7, 0).unwrap().unwrap();
        answer(&db, &request, "listen", 7).unwrap();
        drop(db);
        let db = crate::store::open(&path).unwrap();
        initialize(&db).unwrap();
        assert!(answer(&db, &request, "listen", 7).is_err());
        crate::characters::apply_pair(&db, [star_tail, nadir]).unwrap();
        assert!(answer(&db, &request, "dismiss", 7).is_err());
        let next = prepare(&db, "b", 8, 0).unwrap().unwrap();
        assert_ne!(next.scene.id, request.scene.id);
        assert_eq!(next.character_id, request.character_id);
        assert_eq!(crate::store::relationships(&db).unwrap()[1].score, 25);
    }
    #[test]
    fn canonical_story_and_history_follow_nadir_beyond_the_first_two_slots() {
        let (db, [nadir, star_tail]) = database(std::path::Path::new(":memory:"));
        let mut definition = crate::characters::active_character(&db, "b")
            .unwrap()
            .definition;
        definition.source_id = "custom".into();
        let custom = crate::characters::create(&db, &definition).unwrap();
        crate::characters::apply_roster(&db, vec![custom.id, star_tail.clone(), nadir.clone()])
            .unwrap();
        for seed in 0..5 {
            let request = prepare(&db, "c", 7, seed).unwrap().unwrap();
            assert_eq!(request.character_id, nadir);
            answer(&db, &request, "listen", 7).unwrap();
        }
        assert_eq!(
            prepare(&db, &nadir, 7, 0).unwrap().unwrap().scene.chapter,
            1
        );
        let messages = vec![crate::types::Message {
            id: "private".into(),
            role: "assistant".into(),
            persona: Some(nadir.clone()),
            content: "earlier private story".into(),
            expression: None,
            created_at: 0,
            status: "complete".into(),
        }];
        assert!(prompt_history(&db, &star_tail, messages.clone())
            .unwrap()
            .is_empty());
        crate::characters::apply_roster(&db, vec![nadir.clone()]).unwrap();
        assert!(prompt_history(&db, &nadir, messages).unwrap().is_empty());
        assert_eq!(prepare(&db, "a", 7, 0).unwrap().unwrap().scene.chapter, 1);
    }
}

#[cfg(test)]
mod user_memory_tests {
    use super::*;

    #[test]
    fn new_user_restarts_story_and_cannot_recall_previous_users_private_chapters() {
        let db = crate::store::open(Path::new(":memory:")).unwrap();
        let imported =
            crate::characters::import_pack(&db, &crate::characters::nadir_pack()).unwrap();
        crate::characters::apply_pair(&db, [imported[0].id.clone(), imported[1].id.clone()])
            .unwrap();
        initialize(&db).unwrap();
        let at = chrono::Utc::now().timestamp_millis();
        crate::store::set_user_name(&db, "민수", at).unwrap();
        let user = crate::store::active_user_id(&db).unwrap();
        let character = crate::characters::active_character(&db, "a").unwrap().id;
        db.execute("INSERT INTO character_affinity(source,character_id,day,delta,fingerprint,user_id) VALUES('earned',?1,'today',60,'earned',?2)",params![character,user]).unwrap();
        for chapter in 0..2 {
            for index in 0..5 {
                let id = format!("past-{chapter}-{index}");
                db.execute("INSERT INTO story_answers(request_id,character_id,scene_id,chapter,choice_id,user_id) VALUES(?1,?2,?1,?3,'listen',?4)",params![id,character,chapter,user]).unwrap();
            }
        }
        let request = prepare(&db, "a", 7, 0).unwrap().unwrap();
        assert_eq!(request.scene.chapter, 2);
        let choice = request.scene.choices[0].id.clone();
        answer(&db, &request, &choice, 7).unwrap();
        let memories = crate::store::scoped_memory_page(&db, &character, 0, 50).unwrap();
        assert_eq!(memories.total, 1);
        assert_eq!(memories.items[0].kind, "experience");
        let stale = prepare(&db, "a", 8, 0).unwrap().unwrap();
        crate::store::set_user_name(&db, "지연", at + 1).unwrap();
        assert_eq!(disclosure_level(&db, &character, 20).unwrap(), 0);
        assert!(answer(&db, &stale, &stale.scene.choices[0].id, 8).is_err());
        assert_eq!(crate::store::relationships(&db).unwrap()[0].score, 20);
        assert!(crate::store::idle_memories(&db, at + 1).unwrap().is_empty());
        assert_eq!(
            crate::store::scoped_memory_page(&db, &character, 0, 50)
                .unwrap()
                .total,
            1
        );
        assert_eq!(prepare(&db, "a", 9, 0).unwrap().unwrap().scene.chapter, 0);
        crate::store::set_user_name(&db, "민수", at + 2).unwrap();
        assert_eq!(disclosure_level(&db, &character, 20).unwrap(), 0);
    }
}
