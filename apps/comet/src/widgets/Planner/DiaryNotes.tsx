import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import {
  Button,
  Dialog,
  FormField,
  IconButton,
  NoteCard,
  SearchInput,
  SegmentedControl,
  Textarea,
  TextInput,
} from "@comet/ui";
import { DiaryDesktopNoteDetail, desktopNotes, type DesktopNotesProps } from "./DiaryDesktopNotes";
import { DiaryNoteDetail } from "./DiaryNoteDetail";
import { text } from "../toolData";
import * as ns from "./diaryNotes.css";
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
  search?: string;
  requestedNote?: { id: string; version: number } | null;
};

function matchesNote(note: DiaryNote, query: string): boolean {
  return `${note.title} ${note.body}`.toLocaleLowerCase().includes(query);
}

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

export function DiaryNotes(
  props: NoteCollectionProps & { desktop?: DesktopNotesProps },
): ReactElement {
  const [search, setSearch] = useState("");
  const [view, setView] = useState("all");
  const [selection, setSelection] = useState<string | null>(null);
  const [composeRequest, setComposeRequest] = useState(0);
  const [creating, setCreating] = useState(
    () => readDraft("comet.diary.note-compose:pinned") !== null,
  );
  const [composerDirty, setComposerDirty] = useState(false);
  const [dirtyNotes, setDirtyNotes] = useState<Record<string, boolean>>({});
  const report = useRef(props.onDirtyChange);
  report.current = props.onDirtyChange;
  const dirty = composerDirty || Object.values(dirtyNotes).some(Boolean);
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
  useEffect(() => {
    if (!props.requestedNote) return;
    setSearch("");
    setView("all");
    setCreating(false);
    setSelection(`diary:${props.requestedNote.id}`);
  }, [props.requestedNote]);
  const query = search.trim().toLocaleLowerCase();
  const desktop = desktopNotes(props.desktop?.widgets ?? []);
  const visibleDiary =
    view === "desktop" ? [] : props.notes.filter((note) => matchesNote(note, query));
  const visibleDesktop = desktop.filter(
    ({ note }) =>
      (view !== "desktop" || note.isOpen) &&
      `${text(note.title)} ${text(note.body)}`.toLocaleLowerCase().includes(query),
  );
  const visibleKeys = [
    ...visibleDiary.map((note) => `diary:${note.id}`),
    ...visibleDesktop.map((item) => item.key),
  ];
  const active = selection && visibleKeys.includes(selection) ? selection : visibleKeys[0];
  const total = visibleKeys.length;
  function choose(key: string): void {
    setSelection(key);
    setCreating(false);
  }
  return (
    <section className={ns.page} aria-label="계속 쓸 메모">
      <div className={ns.toolbar}>
        <h1 className={ns.title}>메모</h1>
        <SegmentedControl
          label="메모 보기"
          appearance="contained"
          options={[
            { value: "all", label: "모든 메모" },
            { value: "desktop", label: "바탕화면에 꺼낸 것" },
          ]}
          value={view}
          onValueChange={setView}
        />
        <IconButton
          icon="plus"
          variant="primary"
          aria-label="새 메모 쓰기"
          disabled={props.busy}
          onClick={() => {
            setCreating(true);
            setComposeRequest((value) => value + 1);
          }}
        />
      </div>
      <div className={ns.columns}>
        <div className={ns.list}>
          <SearchInput
            aria-label="메모 검색"
            placeholder="제목이나 내용"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <div className={ns.cards} aria-label="메모 목록">
            {visibleDiary.map((note) => (
              <NoteCard
                key={note.id}
                className={ns.preview}
                layout="preview"
                title={note.title || "빈 메모"}
                description={
                  <span className={ns.previewBody}>{note.body || "아직 내용이 없어요."}</span>
                }
                kind="envelope"
                tag={note.envelopeId ? props.envelopeNames?.[note.envelopeId] : undefined}
                selected={!creating && active === `diary:${note.id}`}
                aria-label={`${note.title} 메모 열기`}
                onClick={() => choose(`diary:${note.id}`)}
              />
            ))}
            {visibleDesktop.map(({ key, note }) => (
              <NoteCard
                key={key}
                className={ns.preview}
                layout="preview"
                title={text(note.title) || "빈 메모"}
                description={
                  <span className={ns.previewBody}>{text(note.body) || "아직 내용이 없어요."}</span>
                }
                tag={note.isOpen ? "바탕화면에 있어요" : undefined}
                selected={!creating && active === key}
                aria-label={`${text(note.title) || text(note.body) || "빈 메모"} 메모 열기`}
                onClick={() => choose(key)}
              />
            ))}
          </div>
          <p className={ns.listFooter}>
            {total
              ? `메모 ${total}개 · 날짜 없이 이어 써요`
              : query
                ? "검색한 메모가 없어요."
                : "아직 메모가 없어요."}
          </p>
          {props.desktop && (
            <Button
              variant="link"
              size="small"
              disabled={props.desktop.busy}
              onClick={() => void props.desktop?.onCreate()}
            >
              + 새 바탕화면 메모
            </Button>
          )}
        </div>
        <div className={ns.detailHost}>
          <div className={ns.detailHost} hidden={!creating}>
            <DiaryNoteCollection
              {...props}
              notes={[]}
              onDirtyChange={setComposerDirty}
              createRequest={composeRequest}
              onCreatingChange={setCreating}
              composeOnly
            />
          </div>
          {props.notes.map((note) => (
            <div
              key={note.id}
              className={ns.detailHost}
              hidden={creating || active !== `diary:${note.id}`}
            >
              <DiaryNoteDetail
                id={`diary:${note.id}`}
                note={note}
                storageKey={`comet.diary.note-draft:sidebar:${note.id}`}
                busy={props.busy}
                onDirtyChange={reportNote}
                onSave={(draft, base) =>
                  props.diaryAction("note-update", {
                    id: note.id,
                    title: draft.title,
                    body: draft.body,
                    expectedTitle: base.title,
                    expectedBody: base.body,
                  })
                }
                onDelete={() => props.diaryAction("note-delete", { id: note.id })}
                header={(disabled) => (
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={disabled}
                    onClick={() =>
                      void props.diaryAction("note-update", { id: note.id, pinned: !note.pinned })
                    }
                  >
                    {note.pinned ? "넣어두기" : "곁에 꺼내두기"}
                  </Button>
                )}
                details={() =>
                  note.envelopeId &&
                  props.envelopeNames?.[note.envelopeId] &&
                  props.onOpenEnvelope ? (
                    <div className={ns.metadata}>
                      <div className={ns.metadataRow}>
                        <div className={ns.metadataCopy}>
                          <span className={ns.metadataLabel}>연결</span>
                          <span className={ns.caption}>준비 봉투에서도 함께 보는 메모예요.</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="small"
                          onClick={() => props.onOpenEnvelope?.(note.envelopeId!)}
                        >
                          {props.envelopeNames[note.envelopeId]}
                        </Button>
                      </div>
                    </div>
                  ) : null
                }
              />
            </div>
          ))}
          {props.desktop &&
            desktop.map((item) => (
              <div
                key={item.key}
                className={ns.detailHost}
                hidden={creating || active !== item.key}
              >
                <DiaryDesktopNoteDetail
                  {...props.desktop!}
                  item={item}
                  onDirtyChange={reportNote}
                />
              </div>
            ))}
          {!creating && !active && (
            <div className={ns.empty}>
              <p className={ns.caption}>메모를 골라 펼치거나 새 생각을 적어 보세요.</p>
            </div>
          )}
        </div>
      </div>
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
  search = "",
  requestedNote,
  createRequest = 0,
  onCreatingChange,
  composeOnly = false,
  hideCreateAction = false,
}: NoteCollectionProps & {
  createRequest?: number;
  onCreatingChange?: (creating: boolean) => void;
  composeOnly?: boolean;
  hideCreateAction?: boolean;
}): ReactElement {
  const draftKey = `comet.diary.note-compose:${envelopeId || "pinned"}`;
  const [restored] = useState(() => readDraft(draftKey));
  const [creating, setCreating] = useState(restored !== null);
  useEffect(() => {
    if (createRequest) setCreating(true);
  }, [createRequest]);
  useEffect(() => {
    onCreatingChange?.(creating);
  }, [creating, onCreatingChange]);
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
      {notes.length === 0 && !composeOnly && (
        <p className={s.caption}>
          {envelopeId ? "준비하면서 떠오른 생각을 담아두세요." : "아직 꺼내둔 메모가 없어요."}
        </p>
      )}
      {notes.map((note) => (
        <div key={note.id} hidden={!matchesNote(note, search)}>
          <DiaryNoteEditor
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
            openRequest={requestedNote?.id === note.id ? requestedNote.version : 0}
          />
        </div>
      ))}
      {creating ? (
        <form
          className={composeOnly ? ns.detail : s.note}
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
            <TextInput
              fill
              value={title}
              disabled={busy}
              maxLength={500}
              onChange={(event) => setTitle(event.target.value)}
            />
          </FormField>
          <FormField label="새 메모 내용">
            <Textarea
              layout="flexible"
              fill
              rows={3}
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
              variant="ghost"
              size="small"
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
            <Button type="submit" variant="primary" size="small" disabled={busy || !title.trim()}>
              메모 저장
            </Button>
          </div>
        </form>
      ) : !composeOnly && !hideCreateAction ? (
        <Button variant="ghost" size="small" disabled={busy} onClick={() => setCreating(true)}>
          + 메모 쓰기
        </Button>
      ) : null}
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
  initiallyEditing = false,
  openRequest = 0,
}: {
  note: DiaryNote;
  diaryAction: DiaryAction;
  busy: boolean;
  onDirtyChange: (id: string, dirty: boolean) => void;
  onOpenEnvelope?: (id: string) => void;
  envelopeName?: string;
  inEnvelope: boolean;
  initiallyEditing?: boolean;
  openRequest?: number;
}): ReactElement {
  const draftKey = `comet.diary.note-draft:${inEnvelope ? "envelope" : "sidebar"}:${note.id}`;
  const [draft, setDraft] = useState<NoteDraft | null>(
    () =>
      readDraft(draftKey) ??
      (initiallyEditing
        ? { title: note.title, body: note.body, baseTitle: note.title, baseBody: note.body }
        : null),
  );
  const [draftError, setDraftError] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const article = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!openRequest) return;
    setDraft(
      (current) =>
        current ?? {
          title: note.title,
          body: note.body,
          baseTitle: note.title,
          baseBody: note.body,
        },
    );
    article.current?.scrollIntoView?.({ block: "nearest" });
  }, [openRequest]);
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
      ref={article}
      className={s.note}
      data-location={inEnvelope ? "envelope" : "sidebar"}
      aria-label={`${note.title} 메모`}
      aria-description={inEnvelope && note.pinned ? "계속 쓸 메모와 함께 수정돼요" : undefined}
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
            <TextInput
              fill
              value={draft.title}
              maxLength={500}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </FormField>
          <FormField label="메모 내용">
            <Textarea
              layout="flexible"
              fill
              rows={3}
              className={s.textArea}
              value={draft.body}
              maxLength={20000}
              disabled={busy}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
            />
          </FormField>
          <div className={s.actions}>
            <Button
              variant="ghost"
              size="small"
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
              size="small"
              disabled={busy || !draft.title.trim()}
            >
              메모 저장
            </Button>
          </div>
          {conflict && (
            <Button variant="ghost" size="small" disabled={busy} onClick={edit}>
              최신 내용 다시 불러오기
            </Button>
          )}
        </form>
      ) : (
        <>
          <div className={s.row}>
            <h3 className={`${s.noteTitle} ${s.grow}`}>{note.title}</h3>
            {inEnvelope ? (
              <Button
                variant="link"
                className={s.envelopeNoteAction}
                aria-label={`${note.title} 메모 메뉴`}
                aria-expanded={menuOpen}
                disabled={busy}
                onClick={() => setMenuOpen(!menuOpen)}
              >
                메모 편집
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="small"
                aria-label={`${note.title} 메모 메뉴`}
                aria-expanded={menuOpen}
                disabled={busy}
                onClick={() => setMenuOpen(!menuOpen)}
              >
                ···
              </Button>
            )}
          </div>
          <p className={s.noteBody}>{note.body || "아직 내용이 없어요."}</p>
          {!inEnvelope && (
            <Button
              variant="ghost"
              size="small"
              disabled={busy}
              onClick={edit}
              aria-label={`${note.title} 메모 편집`}
            >
              메모 편집
            </Button>
          )}
          {note.envelopeId && onOpenEnvelope && (
            <Button
              variant="ghost"
              size="small"
              disabled={busy}
              onClick={() => {
                if (note.envelopeId) onOpenEnvelope(note.envelopeId);
              }}
            >
              ↗ {envelopeName || "준비 봉투 펼치기"}
            </Button>
          )}
          {menuOpen && (
            <div className={s.row}>
              <Button variant="ghost" size="small" disabled={busy} onClick={edit}>
                편집
              </Button>
              <Button
                variant="ghost"
                size="small"
                disabled={busy}
                onClick={async () => {
                  if (!(await diaryAction("note-update", { id: note.id, pinned: !note.pinned })))
                    setError("메모 위치를 바꾸지 못했어요. 다시 시도해 주세요.");
                }}
              >
                {note.pinned ? "넣어두기" : "곁에 꺼내두기"}
              </Button>
              <Button
                variant="ghost"
                size="small"
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
        variant="confirm"
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setDeleting(false)}>
              취소
            </Button>
            <Button
              variant="danger"
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
          </>
        }
      >
        <p>
          이 메모를 함께 보여주는 준비 봉투와 계속 쓸 메모에서도 삭제돼요. 잠시 치우려면 넣어두기를
          사용하세요.
        </p>
      </Dialog>
    </article>
  );
}
