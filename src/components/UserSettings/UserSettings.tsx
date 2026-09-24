import { useEffect, useRef, useState, type JSX } from "react";
import { Button, Checkbox, Dialog, FormField, TextField } from "@fleetia/lagrange";
import type { MemoryPage, Snapshot } from "../../types";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import * as s from "../../lagrange.css";

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
    <>
      <section aria-label="사용자 이름">
        <h2 className={s.sectionTitle}>{savedName ? "이름" : "어떻게 불러드릴까요?"}</h2>
        <p className={s.quiet}>
          {savedName
            ? "이름을 바꾸면 캐릭터와 새로 만나 기억과 친밀도를 처음부터 쌓아요. 예전에 썼던 이름으로 돌아가도 관계가 이어지지 않아요."
            : "캐릭터가 부를 이름을 알려 주세요. 이름을 저장하면 대화를 나누고 함께한 일을 기억할 수 있어요."}
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (valid && dirty) {
              if (savedName) setConfirm(true);
              else void save();
            }
          }}
        >
          <fieldset disabled={pending} style={{ border: 0, margin: 0, padding: 0 }}>
            <FormField className={s.field} label="유저명" description="앞뒤 공백을 제외한 1~40자">
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
            <div className={s.row}>
              <Button type="submit" variant="primary" disabled={!valid || !dirty}>
                {pending ? "저장 중…" : savedName ? "이름 변경" : "이름 저장"}
              </Button>
              {dirty && savedName && (
                <Button type="button" variant="quiet" onClick={() => setName(savedName)}>
                  변경 취소
                </Button>
              )}
            </div>
          </fieldset>
        </form>
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
      </section>
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
    </>
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
    <section className={s.section} aria-label="기존 기억 정리">
      <h2 className={s.sectionTitle}>기존 기억 정리</h2>
      <p className={s.quiet}>
        누구의 기억인지 확인할 수 없는 기억 {snapshot.legacyMemoryCount}개가 있어요. 기억과 간직할
        캐릭터를 선택해 주세요. 지정하기 전에는 대화에서 떠올리지 않아요.
      </p>
      <fieldset disabled={pending} style={{ border: 0, padding: 0 }}>
        {page?.items.map((memory) => (
          <div key={memory.id}>
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
            <p className={s.quiet}>
              {memory.userName} · {new Date(memory.updatedAt).toLocaleDateString("ko-KR")}
            </p>
          </div>
        ))}
        <div className={s.row}>
          <Button
            variant="quiet"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 50))}
          >
            이전 기억
          </Button>
          <Button
            variant="quiet"
            disabled={page?.nextOffset == null}
            onClick={() => {
              if (page?.nextOffset != null) setOffset(page.nextOffset);
            }}
          >
            다음 기억
          </Button>
        </div>
        <p>이 기억을 간직할 캐릭터</p>
        {snapshot.characters.installed.map((character) => (
          <Checkbox
            key={character.id}
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
        <Button
          variant="primary"
          disabled={!ids.length || !characterIds.length}
          onClick={() => void assign()}
        >
          선택한 기억 배분
        </Button>
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
    </section>
  );
}
