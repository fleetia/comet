pub(crate) mod briefing;
pub(crate) mod driver;
pub(crate) mod policy;
pub(crate) mod scheduler;
pub(crate) mod store;

#[cfg(test)]
pub(crate) fn save_private_test_report(db: &rusqlite::Connection) -> &'static str {
    let body = "private_routine_report_body_56319";
    let user = crate::store::active_user_id(db).unwrap();
    store::save_report(
        db,
        &store::Report {
            id: "private-report".into(),
            user_id: user,
            routine_id: "private-routine".into(),
            routine_name: "비공개 루틴".into(),
            scheduled_date: chrono::Local::now().date_naive(),
            body: body.into(),
            bubble: body.into(),
            delivery: "reported".into(),
            reason: None,
            is_read: false,
            created_at: chrono::Utc::now().timestamp_millis(),
        },
    )
    .unwrap();
    body
}
