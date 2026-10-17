import { useEffect, useRef, useState, type JSX } from "react";
import { Button, Checkbox, Surface } from "../../ui";
import { SettingsSummary, TextInput } from "@comet/ui";
import { MemoryIcon, PetIcon } from "@comet/icon";
import { spriteSource } from "../characterIdentity";
import * as figma from "../SettingsPanel/figmaSettings.css";
import type { MemoryPage, Snapshot } from "../../types";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import * as s from "../../common.css";
import * as styles from "./userSettings.css";

export function UserSettings({
  snapshot,
  onDirtyChange,
}: {
  snapshot: Snapshot;
  onDirtyChange?: (dirty: boolean) => void;
}): JSX.Element {
  const [name, setName] = useState(snapshot.user?.name ?? "");
  const [savedName, setSavedName] = useState(snapshot.user?.name ?? "");
  const [showLegacy, setShowLegacy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);
  const trimmed = name.trim();
  const dirty = trimmed !== savedName;
  const valid = Array.from(trimmed).length >= 1 && Array.from(trimmed).length <= 40;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    const next = snapshot.user?.name ?? "";
    setName((previous) => (previous.trim() === savedName ? next : previous));
    setSavedName(next);
  }, [snapshot.user?.id]);
  async function save(): Promise<void> {
    if (!valid || !dirty || busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await command("set_user_name", { name: trimmed });
      setSavedName(trimmed);
      setName(trimmed);
      setConfirm(false);
      setNotice("이름을 저장했어요.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const character = snapshot.characters.installed.find((item) =>
    snapshot.characters.active.includes(item.id),
  );
  const sprite = spriteSource(character, "기쁨");
  return (
    <div className={figma.split}>
      <aside className={figma.inspector}>
        <div className={styles.profileIdentity}>
          <span className={styles.largeAvatar}>{Array.from(savedName || "여행자")[0]}</span>
          <h1>{savedName || "여행자"}</h1>
          <p className={figma.caption}>친구들이 부르는 이름</p>
        </div>
        <div className={styles.preview}>
          <div className={figma.balloon}>
            <p className={figma.speaker}>{character?.definition.name}</p>
            <p className={figma.copy}>{savedName || "여행자"}, 오늘 하루 어땠어?</p>
          </div>
          {sprite ? (
            <img className={figma.previewSprite} src={sprite} alt={character?.definition.name} />
          ) : (
            <PetIcon size={104} />
          )}
        </div>
        <p className={figma.caption}>
          친구들은 이 이름으로 부르고, 이 이름으로 만난 기억과 친밀도를 쌓아요.
        </p>
      </aside>
      <div className={figma.right}>
        <section className={figma.section} aria-label="사용자 이름">
          <h2 className={figma.sectionTitle}>이름</h2>
          <form
            className={figma.group}
            onSubmit={(event) => {
              event.preventDefault();
              if (valid && dirty) {
                if (savedName) setConfirm(true);
                else void save();
              }
            }}
          >
            <fieldset disabled={pending} className={styles.nameForm}>
              <div className={styles.nameRow}>
                <TextInput
                  label="부를 이름"
                  className={styles.nameInput}
                  value={name}
                  autoComplete="off"
                  onChange={(event) => {
                    setName(event.target.value);
                    setNotice(null);
                    setError(null);
                  }}
                />
                <Button type="submit" variant="secondary" disabled={!valid || !dirty}>
                  {savedName ? "바꾸기…" : "이름 저장"}
                </Button>
              </div>
              {confirm && (
                <div className={styles.inlineConfirm} role="group" aria-label="이름 변경 확인">
                  <strong>‘{trimmed}’(으)로 새로 만날까요?</strong>
                  <p className={figma.caption}>
                    기억과 친밀도, 이야기 진행을 처음부터 시작해요. 지금까지의 기록은 ‘{savedName}
                    ’의 기억으로 남고, 친구들은 가끔 ‘{savedName}’를 예전에 알던 사람으로
                    이야기해요.
                  </p>
                  <div className={styles.confirmActions}>
                    <Button
                      variant="secondary"
                      disabled={pending}
                      onClick={() => setConfirm(false)}
                    >
                      취소
                    </Button>
                    <Button variant="primary" disabled={pending} onClick={() => void save()}>
                      {pending ? "저장 중…" : "바꾸기"}
                    </Button>
                  </div>
                </div>
              )}
            </fieldset>
          </form>
          <p className={figma.caption}>
            앞뒤 공백을 빼고 1~40자예요. 예전 이름으로 돌아가도 관계는 이어지지 않아요.
          </p>
          {error && (
            <p role="alert" className={s.error}>
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className={s.success}>
              {notice}
            </p>
          )}
          {dirty && !confirm && (
            <Button variant="quiet" size="compact" onClick={() => setName(savedName)}>
              변경 취소
            </Button>
          )}
        </section>
        {!!snapshot.legacyMemoryCount && (
          <section className={figma.section}>
            <h2 className={figma.sectionTitle}>이전 기록</h2>
            <SettingsSummary
              className={figma.summary}
              title="주인을 정하지 않은 기억"
              count={`${snapshot.legacyMemoryCount}개`}
              description="어떻게 간직할지 정하기 전에는 대화에서 떠올리지 않아요"
              leading={
                <span className={figma.icon}>
                  <MemoryIcon size={20} />
                </span>
              }
              onClick={() => setShowLegacy(true)}
            />
            {showLegacy && <LegacyMemories snapshot={snapshot} />}
          </section>
        )}
      </div>
    </div>
  );
}

function LegacyMemories({ snapshot }: { snapshot: Snapshot }): JSX.Element | null {
  const [page, setPage] = useState<MemoryPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [ids, setIds] = useState<string[]>([]);
  const [characterIds, setCharacterIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const busy = useRef(false);
  useEffect(() => {
    if (!snapshot.user || !snapshot.legacyMemoryCount || !isDesktop()) return;
    let active = true;
    setPending(true);
    void command<MemoryPage>("list_legacy_memories", { offset, limit: 50 })
      .then((next) => {
        if (!active) return;
        if (offset > 0 && next.items.length === 0) setOffset(Math.max(0, offset - 50));
        else setPage(next);
        setIds([]);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      })
      .finally(() => {
        if (active) setPending(false);
      });
    return () => {
      active = false;
    };
  }, [offset, snapshot.memoryRevision, snapshot.legacyMemoryCount, snapshot.user?.id, refresh]);
  async function assign(): Promise<void> {
    if (busy.current || !ids.length || !characterIds.length) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await command("assign_legacy_memories", { ids, characterIds });
      setIds([]);
      setRefresh((value) => value + 1);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  if (!snapshot.user || !snapshot.legacyMemoryCount) return null;
  return (
    <Surface className={styles.memoriesPanel} role="region" aria-label="기존 기억 정리">
      <div className={styles.memoriesBody}>
        <div className={styles.heading}>
          <h2 className={styles.title}>기존 기억 정리</h2>
          <span className={styles.caption}>미배분 {snapshot.legacyMemoryCount}개</span>
        </div>
        <p className={styles.caption}>
          기억과 간직할 캐릭터를 골라요. 지정하기 전에는 대화에서 떠올리지 않아요.
        </p>
        <fieldset disabled={pending} className={styles.form}>
          <div className={styles.memoryList}>
            {page?.items.map((memory) => (
              <div key={memory.id} className={styles.memoryRow}>
                <Checkbox
                  checked={ids.includes(memory.id)}
                  onChange={(event) =>
                    setIds((values) =>
                      event.target.checked
                        ? [...values, memory.id]
                        : values.filter((id) => id !== memory.id),
                    )
                  }
                >
                  {memory.content}
                </Checkbox>
                <p className={styles.caption}>
                  {memory.userName} · {new Date(memory.updatedAt).toLocaleDateString("ko-KR")}
                </p>
              </div>
            ))}
          </div>
          <div className={styles.pagination}>
            <Button
              className={styles.pageButton}
              aria-label="이전 기억"
              variant="quiet"
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              이전
            </Button>
            <Button
              className={styles.pageButton}
              aria-label="다음 기억"
              variant="quiet"
              disabled={page?.nextOffset == null}
              onClick={() => {
                if (page?.nextOffset != null) setOffset(page.nextOffset);
              }}
            >
              다음
            </Button>
            <span className={styles.caption}>
              {page?.items.length
                ? `${offset + 1}-${offset + page.items.length} / ${snapshot.legacyMemoryCount}`
                : `0 / ${snapshot.legacyMemoryCount}`}
            </span>
          </div>
          <div className={styles.recipients}>
            <span className={styles.recipientLabel}>간직할 캐릭터</span>
            {snapshot.characters.installed.map((character) => (
              <Checkbox
                key={character.id}
                className={styles.recipient}
                checked={characterIds.includes(character.id)}
                onChange={(event) =>
                  setCharacterIds((values) =>
                    event.target.checked
                      ? [...values, character.id]
                      : values.filter((id) => id !== character.id),
                  )
                }
              >
                {character.definition.name}
              </Checkbox>
            ))}
            <span className={styles.caption}>선택한 기억 {ids.length}개</span>
          </div>
        </fieldset>
        {pending && <p role="status">기억을 정리하고 있어요.</p>}
        {error && (
          <div role="alert" className={s.error}>
            {error}
            <Button variant="quiet" onClick={() => setRefresh((value) => value + 1)}>
              다시 불러오기
            </Button>
          </div>
        )}
      </div>
      <div className={styles.assignment}>
        <span className={styles.caption}>
          {ids.length}개 기억
          {characterIds.length
            ? ` → ${snapshot.characters.installed
                .filter((character) => characterIds.includes(character.id))
                .map((character) => character.definition.name)
                .join(" · ")}`
            : " · 간직할 캐릭터를 선택해요."}
        </span>
        <Button
          className={styles.assignButton}
          variant="primary"
          disabled={pending || !ids.length || !characterIds.length}
          onClick={() => void assign()}
        >
          선택한 기억 배분
        </Button>
      </div>
    </Surface>
  );
}
