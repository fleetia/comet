import { Button, Dialog, FormField, TextArea, TextField } from "@fleetia/lagrange";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import type { DiaryAction, DiaryNote } from "./diaryTypes";
import * as s from "./diaryEnvelope.css";

type NoteCollectionProps = {
  notes: DiaryNote[];
  diaryAction: DiaryAction;
  busy: boolean;
  envelopeId?: string;
  onDirtyChange?: (dirty: boolean) => void;
  onOpenEnvelope?: (id: string) => void;
  envelopeNames?: Record<string, string>;
};

type NoteDraft = { title: string; body: string; baseTitle: string; baseBody: string };

function readDraft(key: string): NoteDraft | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (value === null || typeof value !== "object") return null;
    const draft = value as Partial<NoteDraft>;
    return typeof draft.title === "string" &&
      typeof draft.body === "string" &&
      typeof draft.baseTitle === "string" &&
      typeof draft.baseBody === "string"
      ? (draft as NoteDraft)
      : null;
  } catch {
    return null;
  }
}

function keepDraft(key: string, draft: NoteDraft | null): boolean {
  try {
    if (draft) localStorage.setItem(key, JSON.stringify(draft));
    else localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function DiaryNotes(props: NoteCollectionProps): ReactElement {
  const [showStored, setShowStored] = useState(false);
  const stored = props.notes.filter((note) => !note.pinned);
  return (
    <section className={s.notes} aria-label="계속 쓸 메모">
      <h2 className={s.subheading}>계속 쓸 메모</h2>
      <p className={s.caption}>날짜가 바뀌어도 곁에 두는 메모</p>
      <DiaryNoteCollection {...props} notes={props.notes.filter((note) => note.pinned)} />
      {stored.length > 0 && (
        <div className={s.notes}>
          <Button
            variant="quiet"
            size="compact"
            aria-expanded={showStored}
            onClick={() => setShowStored(!showStored)}
          >
            넣어둔 메모 {stored.length}개
          </Button>
          {showStored &&
            stored.map((note) => (
              <div key={note.id} className={s.row}>
                <span className={s.grow}>{note.title}</span>
                <Button
                  variant="quiet"
                  size="compact"
                  disabled={props.busy}
                  onClick={() =>
                    void props.diaryAction("note-update", { id: note.id, pinned: true })
                  }
                >
                  꺼내기
                </Button>
              </div>
            ))}
        </div>
      )}
    </section>
  );
}

export function DiaryNoteCollection({
  notes,
  diaryAction,
  busy,
  envelopeId,
  onDirtyChange,
  onOpenEnvelope,
  envelopeNames,
}: NoteCollectionProps): ReactElement {
  const draftKey = `comet.diary.note-compose:${envelopeId || "pinned"}`;
  const [restored] = useState(() => readDraft(draftKey));
  const [creating, setCreating] = useState(restored !== null);
  const [title, setTitle] = useState(restored?.title ?? "");
  const [body, setBody] = useState(restored?.body ?? "");
  const [error, setError] = useState("");
  const [draftError, setDraftError] = useState(false);
  const [dirtyNotes, setDirtyNotes] = useState<Record<string, boolean>>({});
  const report = useRef(onDirtyChange);
  report.current = onDirtyChange;
  const dirty = Boolean(title || body || Object.values(dirtyNotes).some(Boolean));
  useEffect(() => {
    setDraftError(
      !keepDraft(draftKey, title || body ? { title, body, baseTitle: "", baseBody: "" } : null),
    );
  }, [draftKey, title, body]);
  useEffect(() => {
    report.current?.(dirty);
  }, [dirty]);
  useEffect(
    () => () => {
      report.current?.(false);
    },
    [],
  );
  const reportNote = useCallback((id: string, value: boolean): void => {
    setDirtyNotes((current) => (current[id] === value ? current : { ...current, [id]: value }));
  }, []);
  return (
    <div className={s.notes}>
      {draftError && (
        <p className={s.error} role="alert">
          임시 보관 공간에 초안을 남기지 못했어요. 창을 닫기 전에 메모를 저장해 주세요.
        </p>
      )}
      {notes.length === 0 && (
        <p className={s.caption}>
          {envelopeId ? "준비하면서 떠오른 생각을 담아두세요." : "아직 꺼내둔 메모가 없어요."}
        </p>
      )}
      {notes.map((note) => (
        <DiaryNoteEditor
          key={note.id}
          note={note}
          diaryAction={diaryAction}
          busy={busy}
          onDirtyChange={reportNote}
          onOpenEnvelope={
            note.envelopeId && envelopeNames && !envelopeNames[note.envelopeId]
              ? undefined
              : onOpenEnvelope
          }
          envelopeName={note.envelopeId ? envelopeNames?.[note.envelopeId] : undefined}
          inEnvelope={Boolean(envelopeId)}
        />
      ))}
      {creating ? (
        <form
          className={s.note}
          onSubmit={async (event) => {
            event.preventDefault();
            if (!title.trim() || busy) return;
            setError("");
            if (
              await diaryAction("note-create", {
                title: title.trim(),
                body,
                pinned: !envelopeId,
                ...(envelopeId ? { envelopeId } : {}),
              })
            ) {
              setTitle("");
              setBody("");
              setCreating(false);
            } else setError("메모를 저장하지 못했어요. 입력한 내용은 남아 있어요.");
          }}
        >
          <FormField label="새 메모 제목" required>
            <TextField
              value={title}
              disabled={busy}
              maxLength={500}
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormField>
          <FormField label="새 메모 내용">
            <TextArea
              className={s.textArea}
              value={body}
              disabled={busy}
              maxLength={20000}
              onChange={(event) => setBody(event.target.value)}
            />
          </FormField>
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
          <div className={s.actions}>
            <Button
              variant="quiet"
              size="compact"
              disabled={busy}
              onClick={() => {
                setTitle("");
                setBody("");
                setCreating(false);
                setError("");
              }}
            >
              취소
            </Button>
            <Button type="submit" variant="primary" size="compact" disabled={busy || !title.trim()}>
              메모 저장
            </Button>
          </div>
        </form>
      ) : (
        <Button variant="quiet" size="compact" disabled={busy} onClick={() => setCreating(true)}>
          + 메모 쓰기
        </Button>
      )}
    </div>
  );
}

function DiaryNoteEditor({
  note,
  diaryAction,
  busy,
  onDirtyChange,
  onOpenEnvelope,
  envelopeName,
  inEnvelope,
}: {
  note: DiaryNote;
  diaryAction: DiaryAction;
  busy: boolean;
  onDirtyChange: (id: string, dirty: boolean) => void;
  onOpenEnvelope?: (id: string) => void;
  envelopeName?: string;
  inEnvelope: boolean;
}): ReactElement {
  const draftKey = `comet.diary.note-draft:${inEnvelope ? "envelope" : "sidebar"}:${note.id}`;
  const [draft, setDraft] = useState<NoteDraft | null>(() => readDraft(draftKey));
  const [draftError, setDraftError] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const dirty =
    draft !== null && (draft.title !== draft.baseTitle || draft.body !== draft.baseBody);
  useEffect(() => {
    setDraftError(!keepDraft(draftKey, dirty ? draft : null));
  }, [draftKey, draft, dirty]);
  useEffect(() => {
    onDirtyChange(note.id, dirty);
    return () => onDirtyChange(note.id, false);
  }, [dirty, note.id, onDirtyChange]);
  const conflict =
    draft !== null && (note.title !== draft.baseTitle || note.body !== draft.baseBody);
  function edit(): void {
    setDraft({ title: note.title, body: note.body, baseTitle: note.title, baseBody: note.body });
    setError("");
  }
  return (
    <article
      className={s.note}
      data-location={inEnvelope ? "envelope" : "sidebar"}
      aria-label={`${note.title} 메모`}
    >
      {draftError && (
        <p className={s.error} role="alert">
          임시 보관 공간에 초안을 남기지 못했어요. 창을 닫기 전에 메모를 저장해 주세요.
        </p>
      )}
      {draft ? (
        <form
          className={s.form}
          onSubmit={async (event) => {
            event.preventDefault();
            if (busy || !draft.title.trim()) return;
            if (conflict) {
              setError(
                "다른 곳에서 이 메모가 바뀌었어요. 최신 내용을 확인한 뒤 다시 편집해 주세요.",
              );
              return;
            }
            setError("");
            if (
              await diaryAction("note-update", {
                id: note.id,
                title: draft.title.trim(),
                body: draft.body,
                expectedTitle: draft.baseTitle,
                expectedBody: draft.baseBody,
              })
            )
              setDraft(null);
            else setError("메모를 저장하지 못했어요. 입력한 내용은 남아 있어요.");
          }}
        >
          <FormField label="메모 제목" required>
            <TextField
              value={draft.title}
              maxLength={500}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </FormField>
          <FormField label="메모 내용">
            <TextArea
              className={s.textArea}
              value={draft.body}
              maxLength={20000}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            />
          </FormField>
          <div className={s.actions}>
            <Button
              variant="quiet"
              size="compact"
              disabled={busy}
              onClick={() => {
                setDraft(null);
                setError("");
              }}
            >
              취소
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="compact"
              disabled={busy || !draft.title.trim()}
            >
              메모 저장
            </Button>
          </div>
          {conflict && (
            <Button variant="secondary" size="compact" disabled={busy} onClick={edit}>
              최신 내용 다시 불러오기
            </Button>
          )}
        </form>
      ) : (
        <>
          <div className={s.row}>
            <h3 className={`${s.noteTitle} ${s.grow}`}>{note.title}</h3>
            <Button
              variant="quiet"
              size="compact"
              aria-label={`${note.title} 메모 메뉴`}
              aria-expanded={menuOpen}
              disabled={busy}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              ···
            </Button>
          </div>
          <p className={s.noteBody}>{note.body || "아직 내용이 없어요."}</p>
          {note.envelopeId && onOpenEnvelope && (
            <Button
              variant="quiet"
              size="compact"
              disabled={busy}
              onClick={() => {
                if (note.envelopeId) onOpenEnvelope(note.envelopeId);
              }}
            >
              ↗ {envelopeName || "준비 봉투 펼치기"}
            </Button>
          )}
          {inEnvelope && note.pinned && <p className={s.caption}>↖ 계속 쓸 메모와 함께 수정돼요</p>}
          {menuOpen && (
            <div className={s.row}>
              <Button variant="quiet" size="compact" disabled={busy} onClick={edit}>
                편집
              </Button>
              <Button
                variant="quiet"
                size="compact"
                disabled={busy}
                onClick={async () => {
                  if (!(await diaryAction("note-update", { id: note.id, pinned: !note.pinned })))
                    setError("메모 위치를 바꾸지 못했어요. 다시 시도해 주세요.");
                }}
              >
                {note.pinned ? "넣어두기" : "곁에 꺼내두기"}
              </Button>
              <Button
                variant="quiet"
                size="compact"
                disabled={busy}
                onClick={() => setDeleting(true)}
              >
                삭제
              </Button>
            </div>
          )}
        </>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <Dialog
        isOpen={deleting}
        onOpenChange={setDeleting}
        title="메모를 삭제할까요?"
        closeLabel="취소"
        size="small"
      >
        <p>
          이 메모를 함께 보여주는 준비 봉투와 계속 쓸 메모에서도 삭제돼요. 잠시 치우려면 넣어두기를
          사용하세요.
        </p>
        <div className={s.actions}>
          <Button variant="secondary" disabled={busy} onClick={() => setDeleting(false)}>
            취소
          </Button>
          <Button
            variant="critical"
            disabled={busy}
            onClick={async () => {
              if (await diaryAction("note-delete", { id: note.id })) {
                keepDraft(`comet.diary.note-draft:sidebar:${note.id}`, null);
                keepDraft(`comet.diary.note-draft:envelope:${note.id}`, null);
                setDeleting(false);
              } else setError("메모를 삭제하지 못했어요.");
            }}
          >
            메모 삭제
          </Button>
        </div>
      </Dialog>
    </article>
  );
}
