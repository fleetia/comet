import { useEffect, useRef, useState, type JSX } from "react";
import { Button, Checkbox, Dialog, FormField, Surface, TextField } from "@fleetia/lagrange";
import type { MemoryPage, Snapshot } from "../../types";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import * as s from "../../lagrange.css";
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
  return (
    <div className={styles.workspace}>
      <Surface className={styles.namePanel} role="region" aria-label="사용자 이름">
        <div className={styles.nameBody}>
          <div className={styles.heading}>
            <h2 className={styles.title}>{savedName ? "이름" : "어떻게 불러드릴까요?"}</h2>
          </div>
          <Surface tone="accent" padding="inline" className={styles.identity}>
            <span className={styles.caption}>현재 이름</span>
            <strong className={styles.identityName} title={savedName}>
              {savedName || "이름 등록 전"}
            </strong>
          </Surface>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (valid && dirty) {
                if (savedName) setConfirm(true);
                else void save();
              }
            }}
          >
            <fieldset disabled={pending} className={styles.form}>
              <FormField className={styles.nameField} label="캐릭터가 부를 이름">
                <TextField
                  value={name}
                  autoComplete="off"
                  onChange={(event) => {
                    setName(event.target.value);
                    setNotice(null);
                    setError(null);
                  }}
                />
              </FormField>
              <p className={styles.caption}>앞뒤 공백을 제외한 1~40자</p>
              <div className={styles.actions}>
                <Button
                  className={styles.nameAction}
                  type="submit"
                  variant="primary"
                  disabled={!valid || !dirty}
                >
                  {pending ? "저장 중…" : savedName ? "이름 변경" : "이름 저장"}
                </Button>
                {savedName && (
                  <Button
                    className={styles.nameAction}
                    type="button"
                    disabled={!dirty}
                    variant="quiet"
                    onClick={() => setName(savedName)}
                  >
                    변경 취소
                  </Button>
                )}
                <span className={styles.caption}>
                  {dirty ? "현재 이름과 달라요." : "현재 이름과 같아요."}
                </span>
              </div>
            </fieldset>
          </form>
          <p className={styles.caption}>
            {savedName
              ? "이름을 바꾸면 기억·친밀도·스토리 진행을 새로 쌓아요. 이전 기록은 보존되며, 예전 이름으로 돌아가도 관계가 이어지지 않아요."
              : "이름을 저장하면 캐릭터와 대화를 나누고 함께한 일을 기억할 수 있어요."}
          </p>
          {error && !confirm && (
            <p role="alert" className={s.error}>
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className={s.success}>
              {notice}
            </p>
          )}
        </div>
      </Surface>
      <LegacyMemories snapshot={snapshot} />
      <Dialog
        isOpen={confirm}
        onOpenChange={(open) => {
          if (!pending) setConfirm(open);
        }}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
        title="이 이름으로 새로 만날까요?"
        size="small"
        footer={
          <div className={s.row}>
            <Button variant="secondary" disabled={pending} onClick={() => setConfirm(false)}>
              취소
            </Button>
            <Button variant="primary" disabled={pending} onClick={() => void save()}>
              이름 변경 확인
            </Button>
          </div>
        }
      >
        <p>
          {trimmed}(으)로 새로 만나요. 기억과 친밀도, 스토리 진행은 처음부터 시작해요. 지금까지의
          기록은 보존하고, 그 사람과의 기억은 서서히 잊어요.
        </p>
        {error && (
          <p role="alert" className={s.error}>
            {error}
          </p>
        )}
      </Dialog>
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
