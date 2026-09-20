import { useEffect, useRef, useState, type JSX } from "react";
import { Button, FormField, TextArea } from "@fleetia/lagrange";
import type { Memory } from "../../types";
import { command, errorText } from "../../hooks/useSnapshot";
import * as s from "../../lagrange.css";
import * as layout from "../SettingsPanel/settings.css";

type Draft = { content: string; dirty: boolean };
export function MemorySettings({
  memories,
  onDirtyChange,
}: {
  memories: Memory[];
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
        함께 기억하는 것 {list.length}개 · 대화에서 남긴 기억을 선택해 고치거나 지울 수 있어요.
      </p>
      {current ? (
        <div className={layout.listEditor}>
          <aside className={layout.list} aria-label="기억 목록">
            {list.map((memory) => (
              <Button
                key={memory.id}
                variant="quiet"
                className={layout.listRow}
                aria-pressed={current.id === memory.id}
                disabled={pending}
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
          <fieldset className={layout.editor} disabled={pending}>
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
