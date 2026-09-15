use crate::{
    domain::allowed_expression,
    types::{SceneLine, WordbookEntry},
};
use rusqlite::{params, Connection};
use std::collections::HashSet;

type Result<T> = std::result::Result<T, String>;

pub(crate) fn initialize(conn: &Connection) -> Result<()> {
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute_batch("CREATE TABLE IF NOT EXISTS wordbook(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,data TEXT NOT NULL);").map_err(|e| e.to_string())?;
    let initialized: bool = tx
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM kv WHERE key='wordbook_seed_v1')",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if !initialized {
        let empty: bool = tx
            .query_row("SELECT NOT EXISTS(SELECT 1 FROM wordbook)", [], |row| {
                row.get(0)
            })
            .map_err(|e| e.to_string())?;
        if empty {
            for entry in samples() {
                save(&tx, &entry)?;
            }
        }
        tx.execute(
            "INSERT INTO kv(key,value) VALUES('wordbook_seed_v1','true')",
            [],
        )
        .map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

// Registration order is stable across edits and breaks equal-length keyword ties.
pub fn entries(conn: &Connection) -> Result<Vec<WordbookEntry>> {
    let mut statement = conn
        .prepare("SELECT data FROM wordbook ORDER BY seq ASC")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    rows.map(|row| {
        serde_json::from_str(&row.map_err(|e| e.to_string())?).map_err(|e| e.to_string())
    })
    .collect()
}

fn validate(entry: &WordbookEntry) -> Result<()> {
    uuid::Uuid::parse_str(&entry.id).map_err(|_| "단어장 ID가 올바르지 않습니다.")?;
    if entry.title.trim().is_empty() || entry.title.chars().count() > 80 {
        return Err("제목은 1~80자로 입력해 주세요.".into());
    }
    if !(1..=20).contains(&entry.keywords.len()) {
        return Err("키워드는 1~20개 등록해 주세요.".into());
    }
    let mut seen = HashSet::new();
    for keyword in &entry.keywords {
        if keyword.trim().is_empty() || keyword.chars().count() > 80 {
            return Err("키워드는 비어 있지 않은 1~80자로 입력해 주세요.".into());
        }
        if !seen.insert(keyword.to_lowercase()) {
            return Err("같은 키워드는 중복해서 등록할 수 없습니다.".into());
        }
    }
    if !(1..=8).contains(&entry.lines.len()) {
        return Err("대사는 1~8줄 등록해 주세요.".into());
    }
    if entry.lines.iter().any(|line| {
        !["a", "b"].contains(&line.persona.as_str())
            || !allowed_expression(&line.expression)
            || line.text.trim().is_empty()
            || line.text.chars().count() > 300
    }) {
        return Err(
            "대사의 캐릭터·표정 또는 길이가 올바르지 않습니다. 각 대사는 1~300자여야 합니다."
                .into(),
        );
    }
    Ok(())
}

pub fn save(conn: &Connection, entry: &WordbookEntry) -> Result<()> {
    validate(entry)?;
    let data = serde_json::to_string(entry).map_err(|e| e.to_string())?;
    conn.execute("INSERT INTO wordbook(id,data) VALUES(?1,?2) ON CONFLICT(id) DO UPDATE SET data=excluded.data", params![entry.id, data]).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    uuid::Uuid::parse_str(id).map_err(|_| "단어장 ID가 올바르지 않습니다.")?;
    conn.execute("DELETE FROM wordbook WHERE id=?", [id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn match_entry<'a>(entries: &'a [WordbookEntry], input: &str) -> Option<&'a WordbookEntry> {
    let input = input.to_lowercase();
    let mut best = None;
    let mut best_length = 0;
    for entry in entries.iter().filter(|entry| entry.enabled) {
        for keyword in &entry.keywords {
            let normalized = keyword.to_lowercase();
            let length = normalized.chars().count();
            if !normalized.trim().is_empty() && length > best_length && input.contains(&normalized)
            {
                best = Some(entry);
                best_length = length;
            }
        }
    }
    best
}

fn samples() -> Vec<WordbookEntry> {
    let line = |persona: &str, expression: &str, text: &str| SceneLine {
        persona: persona.into(),
        expression: expression.into(),
        text: text.into(),
    };
    vec![
        WordbookEntry {
            id: "8c6b2810-721c-4e02-b4c4-6ab19f428e01".into(),
            title: "가벼운 인사".into(),
            keywords: vec!["안녕".into()],
            enabled: true,
            use_for_idle: false,
            lines: vec![
                line("a", "기쁨", "안녕! 잠깐 이야기할까?"),
                line("b", "평온", "반가워. 편하게 말 걸어 줘."),
            ],
        },
        WordbookEntry {
            id: "8c6b2810-721c-4e02-b4c4-6ab19f428e02".into(),
            title: "잠깐 쉬기".into(),
            keywords: vec!["쉬자".into()],
            enabled: true,
            use_for_idle: false,
            lines: vec![
                line("a", "평온", "좋아, 잠깐 쉬자."),
                line("b", "평온", "말없이 있어도 괜찮아."),
                line("a", "기쁨", "그럼 우리도 잠깐 조용히 있을게."),
            ],
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(keyword: &str) -> WordbookEntry {
        WordbookEntry {
            id: uuid::Uuid::new_v4().to_string(),
            title: "예시".into(),
            keywords: vec![keyword.into()],
            lines: vec![SceneLine {
                persona: "a".into(),
                expression: "평온".into(),
                text: "  그대로\n말할게.  ".into(),
            }],
            enabled: true,
            use_for_idle: false,
        }
    }

    #[test]
    fn literal_matching_prefers_longest_then_registration_and_skips_disabled() {
        let first = entry("안녕");
        let second = entry("안녕하세요");
        let mut disabled = entry("안녕하세요 반가워");
        disabled.enabled = false;
        let rows = vec![
            first,
            second,
            disabled,
            entry("안녕하세요"),
            entry("HELLO"),
            entry(".*"),
            entry("ÄPFEL"),
        ];
        assert_eq!(
            match_entry(&rows, "안녕하세요 반가워").unwrap().id,
            rows[1].id
        );
        assert_eq!(match_entry(&rows, "Well, hello!").unwrap().id, rows[4].id);
        assert!(match_entry(&rows, "아무 말").is_none());
        assert_eq!(match_entry(&rows, ".*").unwrap().id, rows[5].id);
        assert_eq!(match_entry(&rows, "äpfel").unwrap().id, rows[6].id);
    }

    #[test]
    fn crud_preserves_order_exact_text_legacy_data_and_deleted_samples() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("state.sqlite");
        let legacy = Connection::open(&path).unwrap();
        legacy.execute_batch("CREATE TABLE kv(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO kv VALUES('legacy','kept');").unwrap();
        drop(legacy);
        let conn = crate::store::open(&path).unwrap();
        let defaults = entries(&conn).unwrap();
        assert_eq!(defaults.len(), 2);
        assert!(defaults
            .iter()
            .all(|entry| entry.enabled && !entry.use_for_idle));
        for entry in defaults {
            delete(&conn, &entry.id).unwrap();
        }
        let mut first = entry("동일");
        let second = entry("동일");
        save(&conn, &first).unwrap();
        save(&conn, &second).unwrap();
        first.title = "수정".into();
        save(&conn, &first).unwrap();
        drop(conn);
        let conn = crate::store::open(&path).unwrap();
        let rows = entries(&conn).unwrap();
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].id, first.id);
        assert_eq!(rows[0].lines[0].text, "  그대로\n말할게.  ");
        assert_eq!(match_entry(&rows, "동일").unwrap().id, first.id);
        assert_eq!(
            conn.query_row("SELECT value FROM kv WHERE key='legacy'", [], |row| row
                .get::<_, String>(
                0
            ))
            .unwrap(),
            "kept"
        );
        for entry in rows {
            delete(&conn, &entry.id).unwrap();
        }
        drop(conn);
        assert!(entries(&crate::store::open(&path).unwrap())
            .unwrap()
            .is_empty());
    }

    #[test]
    fn invalid_entries_are_rejected_without_mutating_stored_text() {
        let conn = crate::store::open(Path::new(":memory:")).unwrap();
        let valid = entry("인사");
        let mut invalid = valid.clone();
        invalid.id = "not-a-uuid".into();
        assert!(save(&conn, &invalid).is_err());
        for title in [" ".into(), "가".repeat(81)] {
            invalid = valid.clone();
            invalid.title = title;
            assert!(save(&conn, &invalid).is_err());
        }
        for keywords in [
            vec![],
            vec![" ".into()],
            vec!["가".repeat(81)],
            vec!["hello".into(), "HELLO".into()],
            vec!["a".into(); 21],
        ] {
            invalid = valid.clone();
            invalid.keywords = keywords;
            assert!(save(&conn, &invalid).is_err());
        }
        for text in ["\n ".into(), "가".repeat(301)] {
            invalid = valid.clone();
            invalid.lines[0].text = text;
            assert!(save(&conn, &invalid).is_err());
        }
        invalid = valid.clone();
        invalid.lines[0].persona = "c".into();
        assert!(save(&conn, &invalid).is_err());
        invalid = valid.clone();
        invalid.lines[0].expression = "unknown".into();
        assert!(save(&conn, &invalid).is_err());
        invalid = valid.clone();
        invalid.lines = vec![];
        assert!(save(&conn, &invalid).is_err());
        invalid = valid.clone();
        invalid.lines = vec![valid.lines[0].clone(); 9];
        assert!(save(&conn, &invalid).is_err());
        save(&conn, &valid).unwrap();
        assert_eq!(
            entries(&conn).unwrap().last().unwrap().lines[0].text,
            valid.lines[0].text
        );
    }

    use std::path::Path;
}
