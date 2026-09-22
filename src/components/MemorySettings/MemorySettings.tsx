import { useEffect, useRef, useState, type JSX } from "react";
import { Button, FormField, TextArea } from "@fleetia/lagrange";
import type { Memory, MemoryPage } from "../../types";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import * as s from "../../lagrange.css";
import * as layout from "../SettingsPanel/settings.css";
import { MemorySearchSettings } from "./MemorySearchSettings";
import { memoryList } from "./memory.css";

export function MemorySettings({
  memoryCount,
  memoryRevision,
  onDirtyChange,
}: {
  memoryCount: number;
  memoryRevision: number;
  onDirtyChange?: (dirty: boolean) => void;
}): JSX.Element {
  const [page, setPage] = useState<MemoryPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    // An inserted memory can move the edited row onto a different offset page.
    // Keep this page stable until all its drafts have been saved or discarded.
    if (!isDesktop() || dirty) return;
    let active = true;
    setLoading(true);
    setError(null);
    void command<MemoryPage>("list_memories", { offset, limit: 50 })
      .then((result) => {
        if (!active) return;
        if (offset > 0 && result.items.length === 0) {
          setOffset(Math.max(0, offset - 50));
        } else {
          setPage(result);
        }
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [offset, memoryRevision, refresh, dirty]);
  return (
    <>
      <MemoryEditor memories={page?.items ?? []} disabled={loading} onDirtyChange={setDirty} />
      <div className={s.row} aria-label="기억 페이지">
        <Button
          variant="quiet"
          disabled={loading || dirty || offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          이전 기억
        </Button>
        <span className={s.quiet}>
          전체 {page?.total ?? memoryCount}개
          {page && page.items.length > 0
            ? ` · ${page.offset + 1}–${page.offset + page.items.length}`
            : ""}
        </span>
        <Button
          variant="quiet"
          disabled={loading || dirty || page?.nextOffset == null}
          onClick={() => {
            if (page?.nextOffset != null) setOffset(page.nextOffset);
          }}
        >
          다음 기억
        </Button>
      </div>
      {dirty && (
        <p className={s.quiet}>편집한 기억을 저장하거나 취소하면 다른 페이지를 볼 수 있어요.</p>
      )}
      {loading && <p role="status">기억을 불러오고 있어요.</p>}
      {error && (
        <div role="alert" className={s.error}>
          {error}
          <Button variant="quiet" onClick={() => setRefresh((value) => value + 1)}>
            다시 불러오기
          </Button>
        </div>
      )}
      <MemorySearchSettings />
    </>
  );
}

type Draft = { content: string; dirty: boolean };
export function MemoryEditor({
  memories,
  disabled = false,
  onDirtyChange,
}: {
  memories: Memory[];
  disabled?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}): JSX.Element {
  const [selected, setSelected] = useState(memories[0]?.id);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);
  const list = memories.filter((memory) => !removed.includes(memory.id));
  const current = list.find((memory) => memory.id === selected) ?? list[0];
  const value = current ? (drafts[current.id]?.content ?? current.content) : "";
  const dirty = Object.values(drafts).some((draft) => draft.dirty);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    setDrafts((previous) =>
      Object.fromEntries(
        memories.map((memory) => [
          memory.id,
          previous[memory.id]?.dirty
            ? previous[memory.id]
            : { content: memory.content, dirty: false },
        ]),
      ),
    );
  }, [memories]);
  async function update(remove: boolean): Promise<void> {
    if (!current || busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    setNotice(null);
    const id = current.id;
    try {
      await command(
        remove ? "delete_memory" : "edit_memory",
        remove ? { id } : { id, content: value.trim() },
      );
      setDrafts((previous) => {
        const next = { ...previous };
        if (remove) delete next[id];
        else next[id] = { content: value.trim(), dirty: false };
        return next;
      });
      if (remove) setRemoved((previous) => [...previous, id]);
      setConfirmDelete(false);
      setNotice(remove ? "기억을 지웠어요." : "기억을 저장했어요.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  return (
    <section aria-label="함께 기억하는 것">
      <p className={s.quiet}>
        이 페이지의 기억 {list.length}개 · 대화에서 남긴 기억을 선택해 고치거나 지울 수 있어요.
      </p>
      {current ? (
        <div className={layout.listEditor}>
          <aside className={memoryList} aria-label="기억 목록">
            {list.map((memory) => (
              <Button
                key={memory.id}
                variant="quiet"
                className={layout.listRow}
                aria-pressed={current.id === memory.id}
                disabled={pending || disabled}
                onClick={() => {
                  setSelected(memory.id);
                  setConfirmDelete(false);
                  setError(null);
                  setNotice(null);
                }}
              >
                {memory.content.slice(0, 48)}
                {drafts[memory.id]?.dirty ? " · 미저장" : ""}
              </Button>
            ))}
          </aside>
          <fieldset className={layout.editor} disabled={pending || disabled}>
            <FormField className={s.field} label="기억 내용">
              <TextArea
                rows={8}
                maxLength={500}
                value={value}
                onChange={(event) => {
                  const content = event.target.value;
                  setDrafts((previous) => ({
                    ...previous,
                    [current.id]: { content, dirty: content !== current.content },
                  }));
                  setNotice(null);
                }}
              />
            </FormField>
            <div className={s.row}>
              <Button
                variant="primary"
                disabled={!value.trim() || !drafts[current.id]?.dirty}
                onClick={() => void update(false)}
              >
                기억 저장
              </Button>
              <Button
                variant="quiet"
                disabled={!drafts[current.id]?.dirty}
                onClick={() =>
                  setDrafts((previous) => ({
                    ...previous,
                    [current.id]: { content: current.content, dirty: false },
                  }))
                }
              >
                변경 취소
              </Button>
              <Button variant="quiet" onClick={() => setConfirmDelete(true)}>
                이 기억 지우기
              </Button>
            </div>
            {confirmDelete && (
              <div>
                <p>이 기억을 지울까요? 삭제한 기억은 되돌릴 수 없어요.</p>
                <div className={s.row}>
                  <Button variant="secondary" onClick={() => void update(true)}>
                    기억 삭제 확인
                  </Button>
                  <Button variant="quiet" onClick={() => setConfirmDelete(false)}>
                    삭제 취소
                  </Button>
                </div>
              </div>
            )}
          </fieldset>
        </div>
      ) : (
        <p className={s.emptyHint}>아직 기억이 없어요. 이야기를 나누며 하나씩 쌓아 갈게요.</p>
      )}
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
    </section>
  );
}
