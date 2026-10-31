use super::{
    scope_key, transaction, Result, RunTicket, ScenarioDefinition, ScenarioPurpose, Scope, StoryInput,
    StoryStep,
};
use rusqlite::{params, Connection, OptionalExtension};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResumePoint {
    pub scenario_id: String,
    pub chapter_id: String,
    pub run_id: String,
    pub pack_baseline: String,
    pub updated_at: i64,
}

#[derive(Debug, Clone)]
pub struct ResolvedResume {
    pub definition: ScenarioDefinition,
    pub chapter_id: String,
    pub chapter_title: String,
}

pub(super) fn initialize(db: &Connection) -> Result<()> {
    db.execute_batch("CREATE TABLE IF NOT EXISTS pack_story_resume(scope TEXT NOT NULL,scenario_id TEXT NOT NULL,chapter_id TEXT NOT NULL,run_id TEXT NOT NULL,pack_baseline TEXT NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(scope,scenario_id));")
        .map_err(|error| error.to_string())
}

fn scenario(run: &RunTicket) -> Result<(&str, &ScenarioDefinition)> {
    let id = run
        .scenario_id
        .as_deref()
        .ok_or("이야기를 찾을 수 없어요.")?;
    let definition = run
        .definition
        .as_ref()
        .ok_or("이야기 정의를 찾을 수 없어요.")?;
    if definition.id != id || definition.chapters.is_none() {
        return Err("장을 이어 가는 이야기 정의를 확인해 주세요.".into());
    }
    Ok((id, definition))
}

pub fn record_accepted(db: &Connection, run: &RunTicket) -> Result<()> {
    let (id, definition) = scenario(run)?;
    if crate::store::current_user(db)?
        .as_ref()
        .map(|user| user.id.as_str())
        != Some(run.scope.user_id.as_str())
        || !super::current(db, run)?
    {
        return Err("이야기 실행이 바뀌었어요.".into());
    }
    let evidence = serde_json::to_string(&definition.purpose).map_err(|error| error.to_string())?;
    db.execute(
        "INSERT OR IGNORE INTO pack_story_outcomes VALUES(?1,'accepted',?2,?3,?4,?5)",
        params![
            run.run_id,
            scope_key(&run.scope)?,
            id,
            run.input_id,
            evidence
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn save_chapter(db: &Connection, run: &RunTicket, chapter_id: &str, at: i64) -> Result<()> {
    let (id, definition) = scenario(run)?;
    let chapter = definition
        .chapters
        .as_ref()
        .and_then(|chapters| chapters.iter().find(|chapter| chapter.id == chapter_id))
        .ok_or("이야기 실행이 바뀌었어요.")?;
    if crate::store::current_user(db)?
        .as_ref()
        .map(|user| user.id.as_str())
        != Some(run.scope.user_id.as_str())
        || !super::current(db, run)?
    {
        return Err("이야기 실행이 바뀌었어요.".into());
    }
    if chapter.next.as_deref() == Some("end")
        && chapter.steps.iter().any(|step| {
            matches!(
                step,
                StoryStep::Ask {
                    input: StoryInput::Name,
                    ..
                }
            )
        })
    {
        return Ok(());
    }
    db.execute(
        "INSERT INTO pack_story_resume(scope,scenario_id,chapter_id,run_id,pack_baseline,updated_at) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(scope,scenario_id) DO UPDATE SET chapter_id=excluded.chapter_id,run_id=excluded.run_id,pack_baseline=excluded.pack_baseline,updated_at=excluded.updated_at",
        params![scope_key(&run.scope)?, id, chapter_id, run.run_id, run.pack_baseline, at],
    ).map_err(|error| error.to_string())?;
    Ok(())
}

pub fn load_for_scope(db: &Connection, scope: &Scope) -> Result<Vec<ResumePoint>> {
    if crate::store::current_user(db)?
        .as_ref()
        .map(|user| user.id.as_str())
        != Some(scope.user_id.as_str())
    {
        return Ok(Vec::new());
    }
    let mut statement = db.prepare("SELECT scenario_id,chapter_id,run_id,pack_baseline,updated_at FROM pack_story_resume WHERE scope=?1 ORDER BY updated_at DESC,scenario_id")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([scope_key(scope)?], |row| {
            Ok(ResumePoint {
                scenario_id: row.get(0)?,
                chapter_id: row.get(1)?,
                run_id: row.get(2)?,
                pack_baseline: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<rusqlite::Result<_>>()
        .map_err(|error| error.to_string())
}

fn delete_point(db: &Connection, scope: &Scope, point: &ResumePoint) -> Result<()> {
    db.execute("DELETE FROM pack_story_resume WHERE scope=?1 AND scenario_id=?2 AND run_id=?3 AND chapter_id=?4 AND pack_baseline=?5 AND updated_at=?6",
        params![scope_key(scope)?, point.scenario_id, point.run_id, point.chapter_id, point.pack_baseline, point.updated_at])
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn decline(db: &Connection, scope: &Scope, point: &ResumePoint) -> Result<bool> {
    if crate::store::current_user(db)?
        .as_ref()
        .map(|user| user.id.as_str())
        != Some(scope.user_id.as_str())
    {
        return Ok(false);
    }
    transaction(db, |tx| {
        let removed = tx.execute("DELETE FROM pack_story_resume WHERE scope=?1 AND scenario_id=?2 AND run_id=?3 AND chapter_id=?4 AND pack_baseline=?5 AND updated_at=?6",
            params![scope_key(scope)?, point.scenario_id, point.run_id, point.chapter_id, point.pack_baseline, point.updated_at])
            .map_err(|error| error.to_string())?;
        if removed == 0 {
            return Ok(false);
        }
        tx.execute(
            "INSERT INTO pack_story_outcomes VALUES(?1,'declined',?2,?3,?4,'[]')",
            params![
                uuid::Uuid::new_v4().to_string(),
                scope_key(scope)?,
                point.scenario_id,
                uuid::Uuid::new_v4().to_string()
            ],
        )
        .map_err(|error| error.to_string())?;
        Ok(true)
    })
}

pub fn resolve(
    db: &Connection,
    scope: &Scope,
    point: &ResumePoint,
) -> Result<Option<ResolvedResume>> {
    if crate::store::current_user(db)?
        .as_ref()
        .map(|user| user.id.as_str())
        != Some(scope.user_id.as_str())
    {
        return Ok(None);
    }
    let pack_exists: bool = db
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM character_packs WHERE id=?1)",
            [&scope.pack_id],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if !pack_exists {
        delete_point(db, scope, point)?;
        return Ok(None);
    }
    let snapshot = crate::characters::get_pack_story_definition(db, &scope.pack_id)?;
    let evidence: Option<String> = db.query_row("SELECT evidence FROM pack_story_outcomes WHERE run_id=?1 AND kind='accepted' AND scope=?2 AND scenario_id=?3", params![point.run_id, scope_key(scope)?, point.scenario_id], |row| row.get(0)).optional().map_err(|error| error.to_string())?;
    let original_purpose = evidence
        .as_deref()
        .and_then(|value| serde_json::from_str::<ScenarioPurpose>(value).ok());
    let definition = snapshot
        .definition
        .scenarios
        .into_iter()
        .find(|definition| {
            definition.id == point.scenario_id
                && Some(definition.purpose) == original_purpose
                && definition.chapters.is_some()
                && snapshot.source_to_local.get(&definition.center_id) == Some(&scope.center_id)
        });
    let Some(definition) = definition else {
        delete_point(db, scope, point)?;
        return Ok(None);
    };
    let chapters = definition
        .chapters
        .as_ref()
        .ok_or("이야기 장을 찾을 수 없어요.")?;
    let chapter = chapters
        .iter()
        .find(|chapter| chapter.id == point.chapter_id)
        .or_else(|| chapters.first())
        .ok_or("이야기 장을 찾을 수 없어요.")?;
    let chapter_id = chapter.id.clone();
    let chapter_title = chapter.title.clone();
    Ok(Some(ResolvedResume {
        definition,
        chapter_id,
        chapter_title,
    }))
}

pub fn finish(db: &Connection, run: &RunTicket, kind: &str, now: i64) -> Result<()> {
    if !matches!(kind, "completed" | "declined") {
        return Err("이야기 결과를 확인해 주세요.".into());
    }
    let (id, _) = scenario(run)?;
    transaction(db, |tx| {
        if crate::store::current_user(tx)?
            .as_ref()
            .map(|user| user.id.as_str())
            != Some(run.scope.user_id.as_str())
            || !super::current(tx, run)?
        {
            return Err("이야기 실행이 바뀌었어요.".into());
        }
        let inserted = tx
            .execute(
                "INSERT OR IGNORE INTO pack_story_outcomes VALUES(?1,?2,?3,?4,?5,'[]')",
                params![run.run_id, kind, scope_key(&run.scope)?, id, run.input_id],
            )
            .map_err(|error| error.to_string())?;
        if inserted > 0 && kind == "completed" {
            super::apply_completion_effects(tx, run, now)?;
        }
        if inserted > 0 {
            tx.execute(
                "DELETE FROM pack_story_resume WHERE scope=?1 AND scenario_id=?2",
                params![scope_key(&run.scope)?, id],
            )
            .map_err(|error| error.to_string())?;
        }
        Ok(())
    })
}
