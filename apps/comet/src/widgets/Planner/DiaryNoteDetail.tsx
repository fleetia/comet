import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { Button, MultilineEditor, TitleInput, Dialog } from "@comet/ui";
import * as s from "./diaryNotes.css";

export type NoteContent = { title: string; body: string };
type NoteDraft = NoteContent & { baseTitle: string; baseBody: string };
type DetailProps = {
  id: string;
  note: NoteContent;
  storageKey: string;
  busy: boolean;
  maxLength?: number;
  compact?: boolean;
  bodyLabel?: string;
  description?: ReactNode;
  leading?: ReactNode;
  onEditTitle?: () => void;
  onSave: (draft: NoteContent, base: NoteContent) => Promise<boolean>;
  onDelete: (discardDraft?: string) => Promise<boolean | string>;
  onDirtyChange: (id: string, dirty: boolean) => void;
  header?: (disabled: boolean) => ReactNode;
  details?: (disabled: boolean, status?: ReactNode) => ReactNode;
};

function fromNote(note: NoteContent): NoteDraft {
  return { ...note, baseTitle: note.title, baseBody: note.body };
}
function sameContent(a: NoteContent, b: NoteContent): boolean {
  return a.title === b.title && a.body === b.body;
}
function isDirty(draft: NoteDraft): boolean {
  return draft.title !== draft.baseTitle || draft.body !== draft.baseBody;
}
function restore(key: string, note: NoteContent): NoteDraft {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (
      value &&
      typeof value === "object" &&
      "title" in value &&
      "body" in value &&
      "baseTitle" in value &&
      "baseBody" in value &&
      typeof value.title === "string" &&
      typeof value.body === "string" &&
      typeof value.baseTitle === "string" &&
      typeof value.baseBody === "string"
    ) {
      if (value.title === note.title && value.body === note.body) return fromNote(note);
      return {
        title: value.title,
        body: value.body,
        baseTitle: value.baseTitle,
        baseBody: value.baseBody,
      };
    }
  } catch {
    /* A damaged draft must not hide the saved note. */
  }
  return fromNote(note);
}

export function DiaryNoteDetail(props: DetailProps): ReactElement {
  const {
    id,
    note,
    storageKey,
    busy,
    maxLength = 20000,
    compact = false,
    bodyLabel = "메모 내용",
    description,
    leading,
    onEditTitle,
    onDirtyChange,
    header,
    details,
  } = props;
  const [draft, setDraft] = useState(() => restore(storageKey, note));
  const [saving, setSaving] = useState(false);
  const [composing, setComposing] = useState(false);
  const [error, setError] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [discardDraft, setDiscardDraft] = useState<string | null>(null);
  const [discardingConflict, setDiscardingConflict] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const current = useRef(draft);
  const latest = useRef(props);
  latest.current = props;
  const pending = useRef(false);
  const composition = useRef(false);
  const alive = useRef(true);
  const observed = useRef(note);
  const awaitingSource = useRef<NoteContent | null>(null);
  const dirty = isDirty(draft);
  const conflict =
    dirty &&
    !saving &&
    (note.title !== draft.baseTitle || note.body !== draft.baseBody) &&
    !(awaitingSource.current && sameContent(note, awaitingSource.current));

  const keep = useCallback(
    (next: NoteDraft): void => {
      current.current = next;
      if (alive.current) setDraft(next);
      try {
        if (isDirty(next)) localStorage.setItem(storageKey, JSON.stringify(next));
        else localStorage.removeItem(storageKey);
        if (alive.current) setStorageError(false);
      } catch {
        if (alive.current) setStorageError(true);
      }
    },
    [storageKey],
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    onDirtyChange(id, dirty || saving);
    return () => onDirtyChange(id, false);
  }, [id, dirty, saving, onDirtyChange]);
  useEffect(() => {
    if (pending.current) return;
    const previous = observed.current;
    if (previous.title === note.title && previous.body === note.body) return;
    observed.current = note;
    awaitingSource.current = null;
    if (!isDirty(current.current)) keep(fromNote(note));
  }, [note.title, note.body, saving, keep]);

  const flush = useCallback(async (): Promise<boolean> => {
    if (pending.current || composition.current || latest.current.busy) return false;
    const next = current.current;
    if (!isDirty(next)) return true;
    if (!next.title.trim() && next.title !== next.baseTitle) {
      setError("메모 제목을 적어 주세요. 입력한 내용은 남아 있어요.");
      return false;
    }
    const source = latest.current.note;
    if (
      (source.title !== next.baseTitle || source.body !== next.baseBody) &&
      !(awaitingSource.current && sameContent(source, awaitingSource.current))
    ) {
      setError("다른 곳에서 이 메모가 바뀌었어요. 최신 내용을 확인한 뒤 다시 편집해 주세요.");
      return false;
    }
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await latest.current.onSave(
        { title: next.title, body: next.body },
        { title: next.baseTitle, body: next.baseBody },
      );
      if (!saved) {
        if (alive.current) setError("메모를 저장하지 못했어요. 입력한 내용은 남아 있어요.");
        return false;
      }
      if (!alive.current) return true;
      if (sameContent(latest.current.note, source)) awaitingSource.current = source;
      keep({ ...current.current, baseTitle: next.title, baseBody: next.body });
      if (alive.current)
        setSavedAt(new Date().toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" }));
      return true;
    } catch {
      if (alive.current) setError("메모를 저장하지 못했어요. 입력한 내용은 남아 있어요.");
      return false;
    } finally {
      pending.current = false;
      if (alive.current) setSaving(false);
    }
  }, [keep]);

  useEffect(() => {
    if (!dirty || saving || busy || composing || deleting || error || conflict) return;
    const timer = setTimeout(() => void flush(), 500);
    return () => clearTimeout(timer);
  }, [draft, dirty, saving, busy, composing, deleting, error, conflict, flush]);

  function edit(patch: Partial<NoteContent>): void {
    keep({ ...current.current, ...patch });
    setError("");
  }
  const disabled = busy || saving;
  const status = (
    <span className={compact ? s.compactStatus : s.caption} role="status">
      {saving
        ? "저장 중…"
        : dirty
          ? "저장 대기 중"
          : savedAt
            ? `자동 저장됨 · ${savedAt}`
            : compact
              ? "원본 메모에 바로 저장돼요"
              : "저장됨 · 자동으로 저장해요"}
    </span>
  );
  const message = conflict ? "다른 곳에서 이 메모가 바뀌었어요. 입력한 내용은 남아 있어요." : error;
  const inputEvents = {
    onCompositionStart: (): void => {
      composition.current = true;
      setComposing(true);
    },
    onCompositionEnd: (): void => {
      composition.current = false;
      setComposing(false);
    },
    onBlur: (): void => {
      if (!composition.current && !error) void flush();
    },
  };
  return (
    <article
      className={compact ? s.compactDetail : s.detail}
      aria-label={`${note.title || "빈"} 메모`}
    >
      <div className={s.header}>
        {leading}
        <div className={compact ? s.compactTitleField : s.titleField}>
          {compact ? (
            <>
              {onEditTitle ? (
                <button
                  type="button"
                  className={s.compactTitleButton}
                  aria-label="제목 편집"
                  disabled={disabled || dirty}
                  onClick={onEditTitle}
                >
                  {note.title || "빈 메모"}
                </button>
              ) : (
                <strong className={s.compactTitle}>{note.title || "빈 메모"}</strong>
              )}
              {description}
            </>
          ) : (
            <TitleInput
              aria-label="메모 제목"
              placeholder="메모 제목"
              className={s.titleInput}
              value={draft.title}
              maxLength={500}
              readOnly={busy && !saving}
              onChange={(event) => edit({ title: event.target.value })}
              {...inputEvents}
            />
          )}
        </div>
        {header?.(disabled || dirty)}
      </div>
      <div className={compact ? s.compactEditorField : s.editorField}>
        <MultilineEditor
          aria-label={bodyLabel}
          placeholder="떠오른 생각을 적어 두세요."
          className={compact ? s.compactEditor : s.editor}
          value={draft.body}
          maxLength={maxLength}
          readOnly={busy && !saving}
          onChange={(event) => edit({ body: event.target.value })}
          {...inputEvents}
        />
      </div>
      {details?.(disabled || dirty, compact ? status : undefined)}
      {compact && !details && status}
      {storageError && (
        <p className={s.error} role="alert">
          임시 보관 공간에 초안을 남기지 못했어요. 저장이 끝날 때까지 창을 열어 두세요.
        </p>
      )}
      {message && !deleting && (
        <p className={s.error} role="alert">
          {message}
        </p>
      )}
      {conflict && (
        <div className={s.caption}>
          <strong>최신 내용</strong>
          <p style={{ whiteSpace: "pre-wrap" }}>{note.title}</p>
          <p style={{ whiteSpace: "pre-wrap" }}>{note.body}</p>
        </div>
      )}
      {(message || dirty) && (
        <div className={s.actions}>
          {!conflict && (
            <Button
              variant="ghost"
              size="small"
              disabled={disabled || composing}
              onClick={() => void flush()}
            >
              {error ? "다시 저장" : "메모 저장"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="small"
            disabled={disabled}
            onClick={() => {
              if (conflict) {
                setDiscardingConflict(true);
                return;
              }
              keep(fromNote(latest.current.note));
              setError("");
            }}
          >
            {conflict ? "내 글 버리고 최신 내용으로 바꾸기" : "변경 취소"}
          </Button>
        </div>
      )}
      <Dialog
        isOpen={discardingConflict}
        onOpenChange={setDiscardingConflict}
        title="내 글을 버릴까요?"
        closeLabel="취소"
        variant="confirm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setDiscardingConflict(false)}>
              취소
            </Button>
            <Button
              variant="danger"
              disabled={disabled}
              onClick={() => {
                keep(fromNote(latest.current.note));
                setError("");
                setDiscardingConflict(false);
              }}
            >
              내 글 버리고 최신 내용으로 바꾸기
            </Button>
          </>
        }
      >
        <p>작성 중인 내용이 사라지고 최신 내용으로 바뀌어요.</p>
      </Dialog>
      {!compact && (
        <div className={s.footer}>
          {status}
          <Button
            variant="link"
            size="small"
            className={s.error}
            disabled={disabled}
            onClick={() => setDeleting(true)}
          >
            메모 지우기…
          </Button>
        </div>
      )}
      {!compact && (
        <Dialog
          isOpen={deleting}
          onOpenChange={(open) => {
            if (!open && pending.current) return;
            setDeleting(open);
            if (!open) setDiscardDraft(null);
          }}
          title={discardDraft ? "낱장에 저장하지 않은 내용이 있어요" : "메모를 삭제할까요?"}
          closeLabel="취소"
          variant="confirm"
          footer={
            <>
              <Button
                variant="danger"
                disabled={disabled}
                onClick={async () => {
                  if (pending.current) return;
                  pending.current = true;
                  setSaving(true);
                  setError("");
                  try {
                    const result = await latest.current.onDelete(discardDraft ?? undefined);
                    if (typeof result === "string") {
                      setDiscardDraft(result);
                    } else if (result) {
                      keep(fromNote(latest.current.note));
                      if (alive.current) setDeleting(false);
                    } else {
                      setDiscardDraft(null);
                      setError("메모를 삭제하지 못했어요. 다시 확인해 주세요.");
                    }
                  } catch (cause) {
                    setDiscardDraft(null);
                    setError(String(cause).includes("바뀌었어요") ? "메모 초안이나 열린 창이 바뀌었어요. 다시 확인해 주세요." : "메모를 삭제하지 못했어요. 다시 시도해 주세요.");
                  } finally {
                    pending.current = false;
                    if (alive.current) setSaving(false);
                  }
                }}
              >
                {discardDraft ? "초안 폐기하고 삭제" : "메모 삭제"}
              </Button>
              <Button variant="ghost" disabled={disabled} onClick={() => { setDeleting(false); setDiscardDraft(null); }}>
                {discardDraft ? "초안 보존" : "취소"}
              </Button>
            </>
          }
        >
          <p>{discardDraft ? "보존하면 삭제를 취소하고 낱장과 초안을 그대로 둘게요. 폐기하면 초안과 메모를 삭제해요." : "메모 내용도 함께 삭제됩니다."}</p>
          {error && <p className={s.error} role="alert">{error}</p>}
        </Dialog>
      )}
    </article>
  );
}
