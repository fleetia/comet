use super::*;

fn earlier_pack(mut pack: CharacterPack, clip_count: usize) -> CharacterPack {
    let mut assets = std::collections::BTreeSet::new();
    for definition in &mut pack.characters {
        if let Some(animation) = &mut definition.animation {
            animation.clips.truncate(clip_count);
            let clips: std::collections::BTreeSet<_> = animation
                .clips
                .iter()
                .map(|clip| clip.id.as_str())
                .collect();
            for clip in &animation.clips {
                assets.extend(clip.frames.iter().map(|frame| frame.asset_id.clone()));
            }
            definition.gesture_motions.retain(|gesture| {
                [
                    &gesture.start,
                    &gesture.hold,
                    &gesture.moving_hold,
                    &gesture.end,
                ]
                .into_iter()
                .flatten()
                .all(|motion| match motion {
                    MotionOverride::Clip { clip_id, .. } => clips.contains(clip_id.as_str()),
                    _ => true,
                })
            });
            if clip_count == 13 {
                animation.bindings.sleep = None;
                animation.bindings.focus = None;
                animation.bindings.rest = None;
                animation.bindings.music_playing = None;
            }
        }
    }
    pack.animation_assets
        .retain(|asset| assets.contains(&asset.asset_id));
    pack
}

fn without_motions(mut pack: CharacterPack) -> CharacterPack {
    pack.format_version = 6;
    pack.animation_assets.clear();
    for definition in &mut pack.characters {
        definition.animation = None;
        definition.body_regions.clear();
        definition.gesture_motions.clear();
    }
    pack
}

pub(super) fn migrate(conn: &Connection) -> Result<()> {
    let replacement = byulkkori_pack();
    for (version, baseline) in [
        (2, without_motions(replacement.clone())),
        (3, earlier_pack(replacement.clone(), 13)),
        (4, earlier_pack(replacement.clone(), 22)),
    ] {
        migrate_version(conn, version, &baseline, &replacement)?;
    }
    Ok(())
}

fn migrate_version(
    conn: &Connection,
    version: i64,
    baseline: &CharacterPack,
    replacement: &CharacterPack,
) -> Result<()> {
    let migrated: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM character_seed WHERE version=?1)",
            [version],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;
    if migrated {
        return Ok(());
    }
    let source = &baseline.characters[0];
    let prepared = prepare_pack(replacement.clone())?;
    let expected_record = CharacterPack {
        sprites: Vec::new(),
        animation_assets: Vec::new(),
        archive: None,
        ..baseline.clone()
    };
    for installed in collection(conn)?.installed {
        if installed.definition != *source {
            continue;
        }
        let Some(pack_id) = installed.pack_id.as_deref() else {
            continue;
        };
        let (record, members) = pack_record(conn, pack_id)?;
        if serde_json::to_value(&record).map_err(|error| error.to_string())?
            != serde_json::to_value(&expected_record).map_err(|error| error.to_string())?
            || members != [installed.id.clone()]
        {
            continue;
        }
        let images = sprites::all(conn, &installed.id)?;
        if images.len() != baseline.sprites.len()
            || baseline.sprites.iter().any(|expected| {
                images.get(&expected.expression).is_none_or(|actual| {
                    actual.mime != expected.mime
                        || decode_sprite(expected).map_or(true, |bytes| actual.data != bytes)
                })
            })
        {
            continue;
        }
        let old_assets = prepare_pack(baseline.clone())?.animation_assets;
        let expected_assets = old_assets
            .get(&source.source_id)
            .map(Vec::as_slice)
            .unwrap_or_default();
        let current_assets = animation::all(conn, &installed.id)?;
        if current_assets.len() != expected_assets.len()
            || expected_assets.iter().any(|expected| {
                current_assets
                    .iter()
                    .find(|asset| asset.asset_id == expected.asset_id)
                    .is_none_or(|actual| {
                        actual.info != expected.info || actual.bytes != expected.bytes
                    })
            })
        {
            continue;
        }
        let definition = &replacement.characters[0];
        let assets = prepared
            .animation_assets
            .get(&definition.source_id)
            .map(Vec::as_slice)
            .unwrap_or_default();
        save_with_assets(conn, &installed.id, definition, assets)?;
        let record = CharacterPack {
            sprites: Vec::new(),
            animation_assets: Vec::new(),
            archive: None,
            ..replacement.clone()
        };
        conn.execute(
            "UPDATE character_packs SET data=?1 WHERE id=?2",
            params![
                serde_json::to_string(&record).map_err(|error| error.to_string())?,
                pack_id
            ],
        )
        .map_err(|error| error.to_string())?;
    }
    conn.execute("INSERT INTO character_seed(version) VALUES(?1)", [version])
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn official_motion_assets_have_twenty_eight_animated_clips_with_transparent_background() {
        let pack = byulkkori_pack();
        let prepared = prepare_pack(pack.clone()).unwrap();
        let definition = &pack.characters[0];
        let animation = definition.animation.as_ref().unwrap();
        assert_eq!(animation.clips.len(), 28);
        assert!(animation.clips.len() <= 32);
        let assets = &prepared.animation_assets[&definition.source_id];
        assert_eq!(assets.len(), 3);
        for asset in assets {
            let mut decoder = png::Decoder::new(std::io::Cursor::new(&asset.bytes));
            decoder
                .set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
            let mut reader = decoder.read_info().unwrap();
            let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
            let info = reader.next_frame(&mut pixels).unwrap();
            assert_eq!(info.color_type, png::ColorType::Rgba);
            assert_eq!(pixels[3], 0);
            assert!(pixels.chunks_exact(4).any(|pixel| pixel[3] == 255));
            for clip in animation
                .clips
                .iter()
                .filter(|clip| clip.frames[0].asset_id == asset.asset_id)
            {
                let frames: std::collections::BTreeSet<Vec<u8>> = clip
                    .frames
                    .iter()
                    .map(|frame| {
                        let mut pixels_in_frame = Vec::new();
                        for y in frame.y..frame.y + frame.height {
                            let start = ((y * info.width + frame.x) * 4) as usize;
                            let end = start + (frame.width * 4) as usize;
                            pixels_in_frame.extend_from_slice(&pixels[start..end]);
                        }
                        pixels_in_frame
                    })
                    .collect();
                assert!(frames.len() > 1, "{} needs actual changing pixels", clip.id);
            }
        }
    }

    fn legacy_database() -> (Connection, InstalledCharacter) {
        let conn = Connection::open_in_memory().unwrap();
        initialize_for_tests(&conn).unwrap();
        conn.execute("DELETE FROM character_seed WHERE version>=2", [])
            .unwrap();
        let pack = without_motions(byulkkori_pack());
        let installed = import_pack(&conn, &pack).unwrap().remove(0);
        apply_roster(&conn, vec![installed.id.clone()]).unwrap();
        (conn, installed)
    }

    #[test]
    fn untouched_official_content_gets_motions_once_with_same_local_identity() {
        let (conn, original) = legacy_database();
        initialize(&conn).unwrap();
        let updated = get(&conn, &original.id).unwrap();
        assert_eq!(
            active_ids(&conn).unwrap().as_slice(),
            std::slice::from_ref(&original.id)
        );
        assert_eq!(updated.pack_id, original.pack_id);
        assert_eq!(updated.sprites, original.sprites);
        assert_eq!(
            updated.definition.animation.as_ref().unwrap().clips.len(),
            28
        );
        assert_eq!(updated.animation_assets.len(), 3);
        let mut edited = updated.definition.clone();
        edited.animation = None;
        edited.gesture_motions.clear();
        save(&conn, &original.id, &edited).unwrap();
        initialize(&conn).unwrap();
        assert_eq!(get(&conn, &original.id).unwrap().definition, edited);
    }

    #[test]
    fn untouched_thirteen_and_twenty_two_clip_packs_upgrade_without_changing_identity_or_old_assets(
    ) {
        for count in [13, 22] {
            let conn = Connection::open_in_memory().unwrap();
            initialize_for_tests(&conn).unwrap();
            conn.execute("DELETE FROM character_seed WHERE version>=3", [])
                .unwrap();
            let old_pack = earlier_pack(byulkkori_pack(), count);
            let original = import_pack(&conn, &old_pack).unwrap().remove(0);
            let old_assets = animation::all(&conn, &original.id).unwrap();
            initialize(&conn).unwrap();
            let updated = get(&conn, &original.id).unwrap();
            assert_eq!(updated.pack_id, original.pack_id);
            assert_eq!(updated.sprites, original.sprites);
            assert_eq!(
                updated.definition.animation.as_ref().unwrap().clips.len(),
                28
            );
            for old in old_assets {
                let actual = animation::get(&conn, &original.id, &old.asset_id)
                    .unwrap()
                    .unwrap();
                assert_eq!(actual.bytes, old.bytes);
                assert_eq!(actual.info, old.info);
            }
        }
    }

    #[test]
    fn motion_upgrade_skips_edited_definitions_missing_assets_and_removed_content() {
        for change in 0..4 {
            let conn = Connection::open_in_memory().unwrap();
            initialize_for_tests(&conn).unwrap();
            conn.execute("DELETE FROM character_seed WHERE version>=3", [])
                .unwrap();
            let old_pack = earlier_pack(byulkkori_pack(), 13);
            let original = import_pack(&conn, &old_pack).unwrap().remove(0);
            match change {
                0 => {
                    let mut edited = original.definition.clone();
                    edited.gesture_motions[0].expression = Some("걱정".into());
                    save(&conn, &original.id, &edited).unwrap();
                }
                1 => {
                    conn.execute(
                        "DELETE FROM character_animation_assets WHERE character_id=?1",
                        [&original.id],
                    )
                    .unwrap();
                }
                2 => {
                    conn.execute(
                        "UPDATE character_animation_assets SET data=x'00' WHERE character_id=?1",
                        [&original.id],
                    )
                    .unwrap();
                }
                _ => {
                    remove(&conn, &original.id).unwrap();
                }
            }
            let before = serde_json::to_value(collection(&conn).unwrap()).unwrap();
            initialize(&conn).unwrap();
            assert_eq!(
                serde_json::to_value(collection(&conn).unwrap()).unwrap(),
                before
            );
        }
    }

    #[test]
    fn edited_or_deleted_official_content_is_never_replaced_or_restored() {
        for change in 0..4 {
            let (conn, original) = legacy_database();
            match change {
                0 => {
                    let mut definition = original.definition.clone();
                    definition.name = "내 별꼬리".into();
                    save(&conn, &original.id, &definition).unwrap();
                }
                1 => set_sprite(&conn, &original.id, "평온", b"<svg/>").unwrap(),
                2 => remove_sprite(&conn, &original.id, "평온").unwrap(),
                _ => {
                    apply_roster(&conn, vec!["builtin-a".into()]).unwrap();
                    remove(&conn, &original.id).unwrap();
                }
            }
            let before = serde_json::to_value(collection(&conn).unwrap()).unwrap();
            initialize(&conn).unwrap();
            assert_eq!(
                serde_json::to_value(collection(&conn).unwrap()).unwrap(),
                before
            );
        }
    }
}
