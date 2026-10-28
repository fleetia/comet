import { tokens } from "@comet/token";
import { Button, Dialog, FormField, SearchInput, Select, Textarea, TextInput } from "@comet/ui";
import { Icon } from "@comet/icon";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { command, errorText } from "../../hooks/useSnapshot";
import { record, rows, text, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import { useDiary } from "../Planner/useDiary";
import type { DiaryNote } from "../Planner/diaryTypes";
import { DiaryNoteDetail } from "../Planner/DiaryNoteDetail";
import { FocusPanel } from "./FocusPanel";
import * as s from "./FocusTimer.css";

type SourceNote = {
  ref: DataRecord;
  title: string;
  originalTitle: string;
  body: string;
  available: boolean;
  widget?: WidgetView;
};
type NoteDraft = { id: string; title: string; body: string; baseTitle: string; baseBody: string };

function draftKey(id: string): string {
  return `comet.focus.note-draft:${id || "new"}`;
}
function readDraft(id: string, note?: DiaryNote): NoteDraft {
  const fallback = {
    id,
    title: note?.title || "",
    body: note?.body || "",
    baseTitle: note?.title || "",
    baseBody: note?.body || "",
  };
  try {
    const value: unknown = JSON.parse(localStorage.getItem(draftKey(id)) || "null");
    if (
      !value ||
      typeof value !== "object" ||
      !("title" in value) ||
      typeof value.title !== "string" ||
      !("body" in value) ||
      typeof value.body !== "string" ||
      !("baseTitle" in value) ||
      typeof value.baseTitle !== "string" ||
      !("baseBody" in value) ||
      typeof value.baseBody !== "string"
    )
      return fallback;
    return {
      id,
      title: value.title,
      body: value.body,
      baseTitle: value.baseTitle,
      baseBody: value.baseBody,
    };
  } catch {
    return fallback;
  }
}
function noteKey(ref: DataRecord | null): string {
  if (!ref || !text(ref.id)) return "";
  return JSON.stringify([text(ref.kind), text(ref.widgetId), text(ref.id)]);
}

export function FocusTimerNotes({
  widgets,
  noteRef,
  memo,
  memoBase,
  memoConflict = false,
  onReloadMemo,
  canConnect,
  requested,
  onRequestedHandled,
  onRequestedNoteClose,
  onConnect,
  onMemoChange,
  onSaveMemo,
  onRecords,
  act,
  sessionTitle,
  sessionLabel = "지금 집중",
  sessionTime,
  onClose,
  hideTabs = false,
  active = true,
}: {
  widgets: WidgetView[];
  noteRef: DataRecord | null;
  memo: string;
  memoBase?: string;
  memoConflict?: boolean;
  onReloadMemo?: () => void;
  canConnect: boolean;
  requested: DataRecord | null;
  onRequestedHandled: () => void;
  onRequestedNoteClose?: () => void;
  onConnect: (ref: DataRecord | null) => Promise<boolean>;
  onMemoChange: (value: string) => void;
  onSaveMemo: () => Promise<boolean>;
  onRecords?: () => void;
  act?: ToolAction;
  sessionTitle?: string;
  sessionLabel?: string;
  sessionTime?: string;
  onClose?: () => void;
  hideTabs?: boolean;
  active?: boolean;
}): ReactElement {
  const diary = useDiary();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const currentDraft = useRef(draft);
  currentDraft.current = draft;
  const savingDraft = useRef(false);
  const requestedEditor = useRef(false);
  const [error, setError] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [inlineDirty, setInlineDirty] = useState(false);
  const [memoSaved, setMemoSaved] = useState(memoBase ?? memo);
  const [memoSaving, setMemoSaving] = useState(false);
  const [memoError, setMemoError] = useState("");
  const [composing, setComposing] = useState(false);
  const composition = useRef(false);
  const pendingMemo = useRef(false);
  const alive = useRef(true);
  const latest = useRef({ memo, memoConflict, onSaveMemo, active, onRequestedNoteClose });
  latest.current = { memo, memoConflict, onSaveMemo, active, onRequestedNoteClose };
  const memoDirty = memo !== (memoBase ?? memoSaved);
  const reportInline = useCallback(
    (_id: string, value: boolean): void => setInlineDirty(value),
    [],
  );
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const saveMemo = useCallback(async (): Promise<void> => {
    if (
      pendingMemo.current ||
      composition.current ||
      latest.current.memoConflict ||
      !latest.current.active
    )
      return;
    pendingMemo.current = true;
    setMemoSaving(true);
    setMemoError("");
    const value = latest.current.memo;
    try {
      const saved = await latest.current.onSaveMemo();
      if (!alive.current) return;
      if (saved) setMemoSaved(value);
      else setMemoError("집중 메모를 저장하지 못했어요. 입력한 초안은 남아 있어요.");
    } catch {
      if (alive.current) setMemoError("집중 메모를 저장하지 못했어요. 입력한 초안은 남아 있어요.");
    } finally {
      pendingMemo.current = false;
      if (alive.current) setMemoSaving(false);
    }
  }, []);
  useEffect(() => {
    if (!active || !memoDirty || memoSaving || composing || memoError || memoConflict) return;
    const timer = setTimeout(() => void saveMemo(), 500);
    return () => clearTimeout(timer);
  }, [active, memo, memoDirty, memoSaving, composing, memoError, memoConflict, saveMemo]);
  const sources: SourceNote[] = [
    ...(diary.state?.notes ?? []).map((note) => ({
      ref: { kind: "diary", id: note.id, title: note.title },
      title: note.title || "제목 없는 메모",
      originalTitle: note.title,
      body: note.body,
      available: true,
    })),
    ...widgets
      .filter((widget) => widget.kind === "memo")
      .flatMap((widget) =>
        rows(record(widget.data).notes).map((note) => ({
          ref: {
            kind: "memo",
            widgetId: widget.id,
            id: text(note.id),
            title: text(note.title) || "바탕화면 메모",
          },
          title:
            text(note.title) || text(note.body).split(/\r?\n/)[0].slice(0, 80) || "바탕화면 메모",
          originalTitle: text(note.title),
          body: text(note.body),
          available: widget.installed && widget.enabled,
          widget,
        })),
      ),
  ];
  const source = sources.find((note) => noteKey(note.ref) === noteKey(noteRef));
  const query = search.trim().toLocaleLowerCase();
  const filtered = sources.filter((note) =>
    `${note.title} ${note.body}`.toLocaleLowerCase().includes(query),
  );
  const current = diary.state?.notes.find((note) => note.id === draft?.id);
  const conflict = Boolean(
    draft?.id && (!current || current.title !== draft.baseTitle || current.body !== draft.baseBody),
  );
  useEffect(() => {
    if (!draft) return;
    try {
      localStorage.setItem(draftKey(draft.id), JSON.stringify(draft));
    } catch {
      setError("초안을 임시 보관하지 못했어요. 창을 닫기 전에 메모를 저장해 주세요.");
    }
  }, [draft]);
  function closeEditor(): void {
    const requested = requestedEditor.current;
    requestedEditor.current = false;
    setDraft(null);
    if (requested) {
      latest.current.onRequestedNoteClose?.();
    }
  }
  async function openNote(ref: DataRecord, fromRequest = false): Promise<void> {
    setError("");
    requestedEditor.current = false;
    if (ref.kind === "diary") {
      const note = diary.state?.notes.find((value) => value.id === ref.id);
      if (!note) {
        setError("연결한 노트를 찾을 수 없어요. 원본이 삭제되었는지 확인해 주세요.");
        return;
      }
      requestedEditor.current = fromRequest;
      setDraft(readDraft(note.id, note));
      return;
    }
    try {
      await command("open_memo_note", { id: text(ref.widgetId), noteId: text(ref.id) });
    } catch (cause: unknown) {
      setError(errorText(cause));
    }
  }
  useEffect(() => {
    if (!requested || (requested.kind === "diary" && !diary.state)) return;
    void openNote(requested, true);
    onRequestedHandled();
  }, [requested, diary.state]);
  async function saveNote(): Promise<void> {
    if (!draft || !draft.title.trim() || conflict || savingDraft.current) return;
    savingDraft.current = true;
    const input: DataRecord = { title: draft.title, body: draft.body };
    try {
      const result = draft.id
        ? await diary.mutate("note-update", {
            ...input,
            id: draft.id,
            expectedTitle: draft.baseTitle,
            expectedBody: draft.baseBody,
          })
        : await diary.mutate("note-create", { ...input, pinned: true });
      if (!result) return;
      try {
        if (localStorage.getItem(draftKey(draft.id)) === JSON.stringify(draft))
          localStorage.removeItem(draftKey(draft.id));
      } catch {
        /* The saved source remains authoritative. */
      }
      if (alive.current && currentDraft.current === draft) closeEditor();
    } catch (cause: unknown) {
      if (alive.current) setError(errorText(cause));
    } finally {
      savingDraft.current = false;
    }
  }
  return (
    <FocusPanel
      hideTabs={hideTabs}
      label="집중 노트"
      tab="notes"
      onClose={onClose}
      onTabChange={(tab) => {
        if (tab === "records") onRecords?.();
      }}
    >
      {(sessionTitle || sessionTime) && (
        <div className={s.currentFocus}>
          <span className={s.currentFocusDot} />
          <span className={s.grow}>
            {sessionLabel} · <strong>{sessionTitle || "나만의 집중 시간"}</strong>
          </span>
          {sessionTime && <span className={s.currentFocusTime}>{sessionTime}</span>}
        </div>
      )}
      <section className={s.memoSection}>
        <h2 className={s.noteHeading}>이번 집중 메모</h2>
        <Textarea
          aria-label="이번 집중 메모"
          className={s.focusMemoInput}
          placeholder="떠오른 생각이나 다음에 할 일을 적어두세요."
          maxLength={20000}
          value={memo}
          readOnly={!active}
          onChange={(event) => {
            onMemoChange(event.target.value);
            setMemoError("");
          }}
          onCompositionStart={() => {
            composition.current = true;
            setComposing(true);
          }}
          onCompositionEnd={() => {
            composition.current = false;
            setComposing(false);
          }}
          onBlur={() => {
            if (memoDirty && !memoError) void saveMemo();
          }}
        />
        <div className={s.memoSection}>
          <div className={s.heading}>
            <span className={s.quiet} role="status">
              이번 집중 기록과 함께 보관해요 ·{" "}
              {memoSaving ? "저장 중…" : memoDirty ? "저장 대기 중" : "자동 저장됨"}
            </span>
            {memoError && (
              <Button
                variant="ghost"
                size="small"
                disabled={memoConflict || memoSaving || composing}
                onClick={() => void saveMemo()}
              >
                다시 저장
              </Button>
            )}
          </div>
          {memoError && (
            <p className={s.error} role="alert">
              {memoError}
            </p>
          )}
          {memoConflict && (
            <div className={s.pane}>
              <p role="alert" className={s.error}>
                다른 화면에서 집중 메모가 바뀌었어요. 입력한 초안은 남아 있어요.
              </p>
              <Button variant="ghost" onClick={onReloadMemo}>
                최신 집중 메모 불러오기
              </Button>
            </div>
          )}
        </div>
      </section>
      <div className={s.noteSection}>
        <h2 className={s.noteHeading}>연결한 메모</h2>
        {noteRef && source ? (
          <DiaryNoteDetail
            key={noteKey(noteRef)}
            id={noteKey(noteRef)}
            compact
            bodyLabel="연결한 메모 내용"
            note={{ title: source.originalTitle, body: source.body }}
            leading={
              <span className={s.noteIcon}>
                <Icon name="memo" size={16} />
              </span>
            }
            description={
              <span className={s.quiet}>
                {noteRef.kind === "diary" ? "다이어리 · 메모" : "바탕화면 메모"}
              </span>
            }
            storageKey={`comet.focus.inline-note-draft:${noteKey(noteRef)}`}
            busy={
              !active ||
              diary.busy ||
              Boolean(draft) ||
              !source.available ||
              Boolean(source.widget && !act)
            }
            maxLength={source.widget ? 50000 : 20000}
            onDirtyChange={reportInline}
            onSave={async (value, base) =>
              source.widget
                ? Boolean(
                    await act?.(
                      "update",
                      {
                        id: text(source.ref.id),
                        body: value.body,
                        expectedTitle: base.title,
                        expectedBody: base.body,
                      },
                      source.widget,
                    ),
                  )
                : Boolean(
                    await diary.mutate("note-update", {
                      id: text(source.ref.id),
                      title: value.title,
                      body: value.body,
                      expectedTitle: base.title,
                      expectedBody: base.body,
                    }),
                  )
            }
            onDelete={async () => false}
            onEditTitle={noteRef.kind === "diary" ? () => void openNote(noteRef) : undefined}
            details={(disabled, status) => (
              <div className={s.row}>
                <Button
                  variant="ghost"
                  size="small"
                  disabled={disabled || !source.available}
                  onClick={() =>
                    void command("open_conversation_note", { noteRef }).catch((cause: unknown) =>
                      setError(errorText(cause)),
                    )
                  }
                >
                  <Icon name="memo" size={14} />
                  {noteRef.kind === "diary" ? "다이어리에서 열기" : "바탕화면에서 열기"}
                </Button>
                <Button
                  variant="ghost"
                  size="small"
                  disabled={!canConnect || inlineDirty || diary.busy || Boolean(draft)}
                  onClick={() => void onConnect(null)}
                >
                  연결 풀기
                </Button>
                {status}
              </div>
            )}
          />
        ) : (
          <div className={s.pane}>
            <p className={s.quiet}>
              {noteRef
                ? "원본을 찾을 수 없어요. 집중 기록의 연결 정보는 남아 있어요."
                : "원래 쓰던 메모를 이번 집중에 연결할 수 있어요."}
            </p>
            {noteRef && (
              <Button
                variant="ghost"
                size="small"
                disabled={!canConnect || inlineDirty || diary.busy}
                onClick={() => void onConnect(null)}
              >
                연결 풀기
              </Button>
            )}
          </div>
        )}
      </div>
      <div className={s.noteActions}>
        <Button
          className={s.noteActionButton}
          variant="ghost"
          size="small"
          disabled={diary.busy}
          onClick={() => {
            setError("");
            setDraft(readDraft(""));
          }}
        >
          <Icon name="plus" size={14} />새 메모 쓰기
        </Button>
        <Button
          className={s.noteActionButton}
          variant="ghost"
          size="small"
          disabled={!canConnect || inlineDirty}
          title={!canConnect ? "노트 연결은 다음 집중을 준비할 때 바꿀 수 있어요." : undefined}
          onClick={() => setPickerOpen(true)}
        >
          <Icon name="link" size={14} />
          다른 메모 연결하기
        </Button>
      </div>
      {pickerOpen &&
        createPortal(
          <Dialog
            isOpen={active}
            title="다른 메모 연결하기"
            size="small"
            onOpenChange={setPickerOpen}
          >
            <div className={s.pane}>
              <SearchInput
                aria-label="연결할 노트 검색"
                placeholder="제목이나 내용 검색"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <FormField label="연결할 노트">
                <Select
                  fill
                  disabled={!canConnect || inlineDirty}
                  value={noteKey(noteRef)}
                  onChange={async (event) => {
                    const next = sources.find((note) => noteKey(note.ref) === event.target.value);
                    if (await onConnect(next?.ref || null)) setPickerOpen(false);
                  }}
                >
                  <option value="">연결하지 않음</option>
                  {filtered.map((note) => (
                    <option
                      key={noteKey(note.ref)}
                      value={noteKey(note.ref)}
                      disabled={!note.available}
                    >
                      {note.ref.kind === "diary" ? "다이어리" : "바탕화면"} · {note.title}
                    </option>
                  ))}
                  {noteRef && !filtered.some((note) => noteKey(note.ref) === noteKey(noteRef)) && (
                    <option value={noteKey(noteRef)}>{text(noteRef.title) || "연결한 노트"}</option>
                  )}
                </Select>
              </FormField>
              <Button variant="ghost" onClick={() => setPickerOpen(false)}>
                닫기
              </Button>
            </div>
          </Dialog>,
          document.body,
        )}
      {(error || diary.error) && (
        <p role="alert" className={s.error}>
          {error || diary.error}
        </p>
      )}
      {draft &&
        createPortal(
          <Dialog
            style={{
              fontFamily: `${tokens["typography/sans/body/fontFamily"]}, sans-serif`,
              fontSize: tokens["typography/sans/body/fontSize"],
              lineHeight: "1.462",
            }}
            isOpen={active}
            title={draft?.id ? "원본 노트" : "새 다이어리 메모"}
            closeLabel="노트 닫기"
            onOpenChange={(open) => {
              if (!open && !diary.busy) closeEditor();
            }}
          >
            {draft && (
              <form
                className={s.pane}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && event.nativeEvent.isComposing)
                    event.preventDefault();
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveNote();
                }}
              >
                <FormField label="노트 제목" required>
                  <TextInput
                    fill
                    disabled={diary.busy}
                    value={draft.title}
                    maxLength={500}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  />
                </FormField>
                <FormField label="노트 내용">
                  <Textarea
                    layout="flexible"
                    fill
                    rows={3}
                    disabled={diary.busy}
                    className={s.textArea}
                    value={draft.body}
                    maxLength={20000}
                    onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                  />
                </FormField>
                <p className={s.quiet}>
                  다이어리의 원본 메모를 편집해요. 저장하지 않은 초안은 임시 보관해요.
                </p>
                {conflict && (
                  <p role="alert" className={s.error}>
                    원본 노트가 다른 화면에서 바뀌었어요. 입력한 초안은 보관했어요.
                  </p>
                )}
                {diary.error && (
                  <p role="alert" className={s.error}>
                    {diary.error}
                  </p>
                )}
                <div className={s.row}>
                  <Button
                    variant="primary"
                    type="submit"
                    disabled={diary.busy || conflict || !draft.title.trim()}
                  >
                    원본에 저장
                  </Button>
                  <Button variant="ghost" disabled={diary.busy} onClick={closeEditor}>
                    닫기
                  </Button>
                  {conflict && current && (
                    <Button
                      variant="ghost"
                      disabled={diary.busy}
                      onClick={() =>
                        setDraft({
                          id: current.id,
                          title: current.title,
                          body: current.body,
                          baseTitle: current.title,
                          baseBody: current.body,
                        })
                      }
                    >
                      최신 내용 불러오기
                    </Button>
                  )}
                </div>
              </form>
            )}
          </Dialog>,
          document.body,
        )}
    </FocusPanel>
  );
}
