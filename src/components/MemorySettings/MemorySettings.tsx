import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import {
  ActionBar,
  Button,
  FormField,
  SelectableListRow,
  Surface,
  TextArea,
} from "@fleetia/lagrange";
import type { Memory, MemoryPage } from "../../types";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import * as s from "../../lagrange.css";
import { CharacterWorkPanel } from "../CharacterEditor/CharacterWorkPanel";
import * as layout from "./memory.css";

export function MemorySettings({
  characterId,
  characterName,
  onManage,
  memoryCount = 0,
  active = true,
  memoryRevision,
  onDirtyChange,
}: {
  characterId: string;
  characterName?: string;
  onManage?: () => void;
  memoryCount?: number;
  active?: boolean;
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
    if (!isDesktop() || dirty || !active) return;
    let live = true;
    setLoading(true);
    setError(null);
    void command<MemoryPage>("list_memories", { characterId, offset, limit: 50 })
      .then((result) => {
        if (!live) return;
        if (offset > 0 && result.items.length === 0) {
          setOffset(Math.max(0, offset - 50));
        } else {
          setPage(result);
        }
      })
      .catch((cause: unknown) => {
        if (live) setError(errorText(cause));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [characterId, offset, memoryRevision, refresh, dirty, active]);
  return (
    <div className={layout.workspace}>
      <MemoryEditor
        characterId={characterId}
        characterName={characterName}
        onManage={onManage}
        pagination={
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
        }
        memories={page?.items ?? []}
        disabled={loading}
        onDirtyChange={setDirty}
        onSaved={() => setRefresh((value) => value + 1)}
      />

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
    </div>
  );
}

type Draft = { content: string; dirty: boolean };
export function MemoryEditor({
  characterId,
  characterName,
  pagination,
  onManage,
  memories,
  onSaved,
  disabled = false,
  onDirtyChange,
}: {
  characterId: string;
  characterName?: string;
  pagination?: ReactNode;
  onManage?: () => void;
  memories: Memory[];
  onSaved?: () => void;
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
        remove ? { id, characterId } : { id, characterId, content: value.trim() },
      );
      setDrafts((previous) => {
        const next = { ...previous };
        if (remove) delete next[id];
        else next[id] = { content: value.trim(), dirty: false };
        return next;
      });
      if (remove) setRemoved((previous) => [...previous, id]);
      setConfirmDelete(false);
      onSaved?.();
      setNotice(remove ? "기억을 지웠어요." : "기억을 저장했어요.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const actions = current ? (
    <ActionBar status={drafts[current.id]?.dirty ? "변경 사항 있음" : "저장됨"}>
      <Button
        variant="quiet"
        disabled={pending || disabled || !drafts[current.id]?.dirty}
        onClick={() =>
          setDrafts((previous) => ({
            ...previous,
            [current.id]: { content: current.content, dirty: false },
          }))
        }
      >
        변경 취소
      </Button>
      <Button
        variant="primary"
        disabled={pending || disabled || !value.trim() || !drafts[current.id]?.dirty}
        onClick={() => void update(false)}
      >
        기억 저장
      </Button>
    </ActionBar>
  ) : undefined;
  return (
    <section aria-label="캐릭터의 기억" className={layout.workspace}>
      {current ? (
        <div className={layout.listEditor}>
          <CharacterWorkPanel footer={pagination} role="complementary" aria-label="기억 목록">
            <h3 className={layout.heading}>
              {characterName ? `${characterName}의 기억` : "캐릭터의 기억"}
            </h3>
            <p className={s.quiet}>이 페이지의 기억 {list.length}개</p>
            {list.map((memory) => (
              <SelectableListRow
                key={memory.id}
                className={layout.listRow}
                selected={current.id === memory.id}
                aria-label={`${memory.content.slice(0, 48)}${drafts[memory.id]?.dirty ? " · 미저장" : ""}`}
                disabled={pending || disabled}
                onClick={() => {
                  setSelected(memory.id);
                  setConfirmDelete(false);
                  setError(null);
                  setNotice(null);
                }}
              >
                <span>
                  {memory.content.slice(0, 48)}
                  {drafts[memory.id]?.dirty ? " · 미저장" : ""}
                </span>
                <span className={layout.metadata}>
                  {memory.userName} · {new Date(memory.updatedAt).toLocaleDateString("ko-KR")} ·{" "}
                  {memory.kind === "user_fact" ? "사용자 사실" : "대화 경험"}
                </span>
              </SelectableListRow>
            ))}
          </CharacterWorkPanel>
          <CharacterWorkPanel footer={actions}>
            <fieldset className={layout.editor} disabled={pending || disabled}>
              <div className={layout.editorHeading}>
                <h3 className={layout.heading}>선택한 기억</h3>
                <Button variant="quiet" onClick={() => setConfirmDelete(true)}>
                  이 기억 지우기
                </Button>
              </div>
              <p className={s.quiet}>
                {characterName ? `${characterName} · ` : ""}
                {current.userName} · {new Date(current.updatedAt).toLocaleDateString("ko-KR")}
              </p>
              <FormField className={s.field} label="기억 내용">
                <TextArea
                  className={layout.memoryText}
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
              <details open className={layout.evidence}>
                <summary>기억의 근거</summary>
                <Surface tone="accent">
                  <p className={s.quiet}>
                    {new Date(current.sourceCreatedAt).toLocaleDateString("ko-KR")}
                  </p>
                  <p className={layout.original}>{current.sourceText || "근거 원문이 없어요."}</p>
                </Surface>
              </details>
              <p className={s.quiet}>기억 내용만 수정해요. 대화 원문과 친밀도는 유지돼요.</p>
              {onManage && (
                <div className={layout.editorHeading}>
                  <span className={s.quiet}>모든 사용자의 기억을 지우려면</span>
                  <Button variant="quiet" onClick={onManage}>
                    캐릭터 관리로 이동
                  </Button>
                </div>
              )}
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
          </CharacterWorkPanel>
        </div>
      ) : !disabled ? (
        <CharacterWorkPanel>
          <p className={s.emptyHint}>아직 기억이 없어요. 이야기를 나누며 하나씩 쌓아 갈게요.</p>
        </CharacterWorkPanel>
      ) : null}
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
