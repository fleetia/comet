import { Button, Dialog, FormField, Select, TextArea, TextField } from "@fleetia/lagrange";
import { semanticVars as vars } from "@fleetia/lagrange/theme";
import { useEffect, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { theme } from "../../desktop.css";
import { command, errorText } from "../../hooks/useSnapshot";
import { record, rows, text, type DataRecord } from "../toolData";
import type { WidgetView } from "../types";
import { useDiary } from "../Planner/useDiary";
import type { DiaryNote } from "../Planner/diaryTypes";
import * as s from "./FocusTimer.css";

type SourceNote = { ref: DataRecord; title: string; body: string; available: boolean };
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
  memoConflict = false,
  onReloadMemo,
  canConnect,
  requested,
  onRequestedHandled,
  onConnect,
  onMemoChange,
  onSaveMemo,
}: {
  widgets: WidgetView[];
  noteRef: DataRecord | null;
  memo: string;
  memoConflict?: boolean;
  onReloadMemo?: () => void;
  canConnect: boolean;
  requested: DataRecord | null;
  onRequestedHandled: () => void;
  onConnect: (ref: DataRecord | null) => Promise<boolean>;
  onMemoChange: (value: string) => void;
  onSaveMemo: () => Promise<boolean>;
}): ReactElement {
  const diary = useDiary();
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState<NoteDraft | null>(null);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const sources: SourceNote[] = [
    ...(diary.state?.notes ?? []).map((note) => ({
      ref: { kind: "diary", id: note.id, title: note.title },
      title: note.title || "제목 없는 메모",
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
          body: text(note.body),
          available: widget.installed && widget.enabled,
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
  async function openNote(ref: DataRecord): Promise<void> {
    setError("");
    if (ref.kind === "diary") {
      const note = diary.state?.notes.find((value) => value.id === ref.id);
      if (!note) {
        setError("연결한 노트를 찾을 수 없어요. 원본이 삭제되었는지 확인해 주세요.");
        return;
      }
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
    void openNote(requested);
    onRequestedHandled();
  }, [requested, diary.state]);
  async function saveNote(): Promise<void> {
    if (!draft || !draft.title.trim() || conflict) return;
    const input: DataRecord = { title: draft.title, body: draft.body };
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
      localStorage.removeItem(draftKey(draft.id));
    } catch {
      /* The saved source remains authoritative. */
    }
    setDraft(null);
  }
  return (
    <section className={s.pane} aria-label="집중 노트">
      <div className={s.memoSection}>
        <FormField label="이번 집중 메모">
          <TextArea
            className={s.textArea}
            placeholder="떠오른 생각이나 다음에 할 일을 적어두세요."
            maxLength={20000}
            value={memo}
            onChange={(event) => {
              onMemoChange(event.target.value);
              setSaved(false);
            }}
          />
        </FormField>
        <div className={s.heading}>
          <span className={s.quiet}>
            {saved ? "집중 기록에 저장됨" : "이번 집중 기록과 함께 보관해요."}
          </span>
          <Button
            variant="secondary"
            size="compact"
            disabled={memoConflict}
            onClick={async () => {
              if (await onSaveMemo()) setSaved(true);
            }}
          >
            메모 저장
          </Button>
        </div>
        {memoConflict && (
          <div className={s.pane}>
            <p role="alert" className={s.error}>
              다른 화면에서 집중 메모가 바뀌었어요. 입력한 초안은 남아 있어요.
            </p>
            <Button variant="quiet" onClick={onReloadMemo}>
              최신 집중 메모 불러오기
            </Button>
          </div>
        )}
      </div>
      <div className={s.noteSection}>
        <h2 className={s.headingText}>연결한 노트</h2>
        {noteRef ? (
          <article className={s.pane}>
            <span className={s.quiet}>
              {noteRef.kind === "diary" ? "다이어리 · 계속 쓸 메모" : "바탕화면 메모"}
            </span>
            <strong>{source?.title || text(noteRef.title) || "연결한 노트"}</strong>
            <p className={s.prose}>
              {source
                ? source.body || "아직 내용이 없어요."
                : "원본을 찾을 수 없어요. 집중 기록의 연결 정보는 남아 있어요."}
            </p>
            <div className={s.row}>
              <Button
                variant="secondary"
                disabled={!source?.available}
                onClick={() => void openNote(noteRef)}
              >
                원본 노트 열기
              </Button>
              <Button variant="quiet" disabled={!canConnect} onClick={() => void onConnect(null)}>
                연결 해제
              </Button>
            </div>
          </article>
        ) : (
          <p className={s.quiet}>원래 쓰던 노트를 이번 집중에 연결할 수 있어요.</p>
        )}
        <TextField
          aria-label="연결할 노트 검색"
          placeholder="제목이나 내용 검색"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <FormField label="연결할 노트">
          <Select
            disabled={!canConnect}
            value={noteKey(noteRef)}
            onChange={(event) => {
              const next = sources.find((note) => noteKey(note.ref) === event.target.value);
              void onConnect(next?.ref || null);
            }}
          >
            <option value="">연결하지 않음</option>
            {filtered.map((note) => (
              <option key={noteKey(note.ref)} value={noteKey(note.ref)} disabled={!note.available}>
                {note.ref.kind === "diary" ? "다이어리" : "바탕화면"} · {note.title}
              </option>
            ))}
            {noteRef && !filtered.some((note) => noteKey(note.ref) === noteKey(noteRef)) && (
              <option value={noteKey(noteRef)}>{text(noteRef.title) || "연결한 노트"}</option>
            )}
          </Select>
        </FormField>
        {!canConnect && (
          <p className={s.quiet}>노트 연결은 다음 집중을 준비할 때 바꿀 수 있어요.</p>
        )}
        <Button
          variant="quiet"
          disabled={diary.busy}
          onClick={() => {
            setError("");
            setDraft(readDraft(""));
          }}
        >
          다이어리에 새 메모 쓰기
        </Button>
      </div>
      {(error || diary.error) && (
        <p role="alert" className={s.error}>
          {error || diary.error}
        </p>
      )}
      {draft &&
        createPortal(
          <Dialog
            className={theme}
            style={{
              fontFamily: vars.typography.family.ui,
              fontSize: vars.typography.size.body,
              lineHeight: vars.typography.lineHeight.body,
            }}
            isOpen
            title={draft?.id ? "원본 노트" : "새 다이어리 메모"}
            closeLabel="노트 닫기"
            onOpenChange={(open) => {
              if (!open && !diary.busy) setDraft(null);
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
                  <TextField
                    disabled={diary.busy}
                    value={draft.title}
                    maxLength={500}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                  />
                </FormField>
                <FormField label="노트 내용">
                  <TextArea
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
                  <Button variant="quiet" disabled={diary.busy} onClick={() => setDraft(null)}>
                    닫기
                  </Button>
                  {conflict && current && (
                    <Button
                      variant="quiet"
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
    </section>
  );
}
