import { useEffect, useRef, useState, type JSX } from "react";
import { Button, FormField, Select, Textarea, TextInput } from "@comet/ui";
import { command, errorText } from "../../hooks/useSnapshot";
import {
  CHARACTER_SLOTS,
  type ConversationNote,
  type Message,
  type NoteReference,
  type Snapshot,
  type WordbookEntry,
} from "../../types";
import { activeCharacter, characterName } from "../characterIdentity";
import * as s from "../companion.css";
import * as n from "./conversationNotes.css";

export type ConversationSaveRequest = {
  sessionId: string;
  message: Message;
  kind: "note" | "wordbook";
};

export function ConversationMessageActions({
  message,
  onSave,
}: {
  message: Message;
  onSave: (kind: ConversationSaveRequest["kind"]) => void;
}): JSX.Element | null {
  if (
    !message.content.trim() ||
    (message.role !== "user" && message.role !== "assistant") ||
    (message.role === "assistant" && message.status !== "complete")
  )
    return null;
  return (
    <details aria-label="이 문장 남기기">
      <summary className={s.conversationSummary}>남기기</summary>
      <div className={n.actions}>
        <Button variant="ghost" size="small" onClick={() => onSave("note")}>
          메모에 남기기
        </Button>
        <Button variant="ghost" size="small" onClick={() => onSave("wordbook")}>
          대사로 등록
        </Button>
      </div>
    </details>
  );
}

type SaveDraft = {
  text: string;
  title: string;
  keywords: string;
  speaker: string;
  noteId: string;
};

function restoredDraft(key: string, fallback: SaveDraft): SaveDraft {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (!value || typeof value !== "object") return fallback;
    const candidate = value as Partial<SaveDraft>;
    return typeof candidate.text === "string" &&
      typeof candidate.title === "string" &&
      typeof candidate.keywords === "string" &&
      typeof candidate.speaker === "string" &&
      typeof candidate.noteId === "string"
      ? (candidate as SaveDraft)
      : fallback;
  } catch {
    return fallback;
  }
}

export function ConversationSave({
  snapshot,
  request,
  onClose,
}: {
  snapshot: Snapshot;
  request: ConversationSaveRequest;
  onClose: () => void;
}): JSX.Element {
  const { message, sessionId, kind } = request;
  const draftKey = `comet.conversation-save:${snapshot.user?.id ?? ""}:${sessionId}:${message.id}:${kind}`;
  const sourceCharacter = activeCharacter(snapshot, message.persona ?? "");
  const sourceSlot = sourceCharacter ? snapshot.characters.active.indexOf(sourceCharacter.id) : 0;
  const [draft, setDraft] = useState(() =>
    restoredDraft(draftKey, {
      text: message.content,
      title: "",
      keywords: "",
      speaker: CHARACTER_SLOTS[Math.max(0, sourceSlot)],
      noteId: "",
    }),
  );
  const [notes, setNotes] = useState<ConversationNote[]>([]);
  const [loading, setLoading] = useState(kind === "note");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draftError, setDraftError] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedNote, setSavedNote] = useState<NoteReference | null>(null);
  const [refresh, setRefresh] = useState(0);
  const alive = useRef(true);
  const form = useRef<HTMLFormElement>(null);
  const operation = useRef<{ key: string; id: string } | null>(null);
  const selectedNote = notes.find((note) => note.noteRef.id === draft.noteId);
  const keywords = [
    ...new Set(
      draft.keywords
        .split(/[,，\n]+/u)
        .map((keyword) => keyword.trim())
        .filter(Boolean),
    ),
  ];
  const availableSpeaker =
    snapshot.characters.active[
      CHARACTER_SLOTS.indexOf(draft.speaker as (typeof CHARACTER_SLOTS)[number])
    ];
  const valid =
    Boolean(draft.text.trim()) &&
    (kind === "note"
      ? [...draft.text].length <= 20000 &&
        (draft.noteId
          ? selectedNote !== undefined &&
            [...selectedNote.body].length + [...draft.text].length + (selectedNote.body ? 2 : 0) <=
              20000
          : Boolean(draft.title.trim()) && [...draft.title].length <= 500)
      : Boolean(draft.title.trim()) &&
        [...draft.title].length <= 80 &&
        [...draft.text].length <= 300 &&
        keywords.length > 0 &&
        keywords.length <= 20 &&
        keywords.every((keyword) => [...keyword].length <= 80) &&
        Boolean(availableSpeaker));
  useEffect(() => {
    alive.current = true;
    form.current?.querySelector<HTMLElement>("input, select, textarea")?.focus();
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    if (saved) return;
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
      setDraftError(false);
    } catch {
      setDraftError(true);
    }
  }, [draftKey, draft, saved]);
  useEffect(() => {
    if (kind !== "note") return;
    let current = true;
    setLoading(true);
    setError(null);
    void command<ConversationNote[]>("get_conversation_notes")
      .then((result) => {
        if (current) setNotes((result ?? []).filter((note) => note.noteRef.kind === "diary"));
      })
      .catch((cause: unknown) => {
        if (current) setError(errorText(cause));
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [kind, refresh]);
  function requestId(input: unknown): string {
    const key = JSON.stringify(input);
    if (operation.current?.key === key) return operation.current.id;
    operation.current = { key, id: crypto.randomUUID() };
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(`${draftKey}:request`) ?? "null");
      if (
        stored &&
        typeof stored === "object" &&
        "key" in stored &&
        stored.key === key &&
        "id" in stored &&
        typeof stored.id === "string"
      ) {
        operation.current = { key, id: stored.id };
      }
    } catch {
      setDraftError(true);
    }
    try {
      localStorage.setItem(`${draftKey}:request`, JSON.stringify(operation.current));
    } catch {
      setDraftError(true);
    }
    return operation.current.id;
  }
  async function save(): Promise<void> {
    if (pending || !valid) return;
    setPending(true);
    setError(null);
    try {
      if (kind === "note") {
        const input = {
          sessionId,
          messageId: message.id,
          text: draft.text,
          noteId: draft.noteId || undefined,
          title: draft.noteId ? undefined : draft.title.trim(),
        };
        const noteRef = await command<NoteReference>("save_conversation_note", {
          ...input,
          expectedBody: selectedNote?.body,
          requestId: requestId(input),
        });
        if (alive.current && noteRef) setSavedNote(noteRef);
      } else {
        const entry: WordbookEntry = {
          id: requestId({ kind }),
          title: draft.title.trim(),
          keywords,
          lines: [
            {
              persona: draft.speaker,
              expression: ["평온", "기쁨", "호기심", "생각중", "걱정", "장난"].includes(
                message.expression ?? "",
              )
                ? message.expression!
                : "평온",
              text: draft.text,
            },
          ],
          enabled: true,
          useForIdle: false,
        };
        await command("save_wordbook_entry", { entry });
      }
      try {
        if (localStorage.getItem(draftKey) === JSON.stringify(draft))
          localStorage.removeItem(draftKey);
        if (localStorage.getItem(`${draftKey}:request`) === JSON.stringify(operation.current))
          localStorage.removeItem(`${draftKey}:request`);
      } catch {
        /* The committed original is authoritative. */
      }
      if (alive.current) setSaved(true);
    } catch (cause) {
      if (alive.current) setError(errorText(cause));
    } finally {
      if (alive.current) setPending(false);
    }
  }
  if (saved)
    return (
      <div className={n.form}>
        <p role="status">
          {kind === "note" ? "메모에 저장했어요." : "개인 단어장에 저장했어요."}
        </p>
        {error && (
          <p className={s.error} role="alert">
            {error}
          </p>
        )}
        <div className={n.actions}>
          <Button variant="ghost" onClick={onClose}>
            대화로 돌아가기
          </Button>
          {savedNote && (
            <Button
              onClick={() => {
                setError(null);
                void command("open_conversation_note", { noteRef: savedNote }).catch(
                  (cause: unknown) => {
                    if (alive.current) setError(errorText(cause));
                  },
                );
              }}
            >
              메모 열기
            </Button>
          )}
        </div>
      </div>
    );
  return (
    <form
      ref={form}
      className={n.form}
      aria-label={kind === "note" ? "대화를 메모에 남기기" : "대화를 대사로 등록"}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <strong>{kind === "note" ? "메모에 남기기" : "대사로 등록"}</strong>
      <p className={s.conversationMeta}>
        아래 내용을 확인하고 저장해 주세요. 대화 원문은 그대로 남아요.
      </p>
      {kind === "note" && (
        <>
          <FormField label="저장할 메모">
            <Select
              fill
              value={draft.noteId}
              disabled={pending || loading}
              onChange={(event) => setDraft({ ...draft, noteId: event.target.value })}
            >
              <option value="">새 메모 만들기</option>
              {notes.map((note) => (
                <option key={note.noteRef.id} value={note.noteRef.id}>
                  {note.noteRef.title}
                </option>
              ))}
              {draft.noteId && !selectedNote && (
                <option value={draft.noteId}>고른 메모 · 사용할 수 없음</option>
              )}
            </Select>
          </FormField>
          {loading && <p role="status">메모를 불러오는 중이에요.</p>}
          {selectedNote && (
            <details>
              <summary className={s.conversationSummary}>
                기존 내용 뒤에 추가해요 · 원문 확인
              </summary>
              <p className={n.text}>{selectedNote.body}</p>
            </details>
          )}
          <Button
            size="small"
            variant="ghost"
            disabled={pending || loading}
            onClick={() => setRefresh((value) => value + 1)}
          >
            메모 다시 불러오기
          </Button>
        </>
      )}
      {(kind === "wordbook" || !draft.noteId) && (
        <FormField label={kind === "note" ? "메모 제목" : "대사 제목"} required>
          <TextInput
            fill
            value={draft.title}
            disabled={pending}
            maxLength={kind === "note" ? 500 : 80}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
        </FormField>
      )}
      {kind === "wordbook" && (
        <>
          <FormField label="키워드" required>
            <TextInput
              fill
              value={draft.keywords}
              disabled={pending}
              placeholder="쉼표로 구분"
              onChange={(event) => setDraft({ ...draft, keywords: event.target.value })}
            />
          </FormField>
          <FormField label="재생할 친구" required>
            <Select
              fill
              value={draft.speaker}
              disabled={pending}
              onChange={(event) => setDraft({ ...draft, speaker: event.target.value })}
            >
              {snapshot.characters.active.map((id, index) => (
                <option key={id} value={CHARACTER_SLOTS[index]}>
                  {characterName(snapshot, id)}
                </option>
              ))}
            </Select>
          </FormField>
          <p className={s.conversationMeta}>등록한 키워드로 재생해요. 자동 잡담에는 넣지 않아요.</p>
        </>
      )}
      {kind === "note" && (
        <p className={s.conversationMeta}>
          {[...draft.text].length}/20,000자
          {selectedNote
            ? ` · 추가 후 ${[...selectedNote.body].length + [...draft.text].length + (selectedNote.body ? 2 : 0)}자`
            : ""}
        </p>
      )}
      <FormField label="저장할 내용" required>
        <Textarea
          layout="flexible"
          fill
          rows={3}
          className={n.bodyInput}
          value={draft.text}
          disabled={pending}
          onChange={(event) => setDraft({ ...draft, text: event.target.value })}
        />
      </FormField>
      {kind === "wordbook" && (
        <p className={s.conversationMeta}>
          {[...draft.text].length}/300자 · 공백과 줄바꿈도 그대로 저장해요.
        </p>
      )}
      {draftError && (
        <p className={s.error} role="alert">
          초안을 임시 보관하지 못했어요. 창을 닫기 전에 저장해 주세요.
        </p>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error} 입력한 내용은 남아 있어요.
        </p>
      )}
      <div className={n.actions}>
        <Button variant="ghost" disabled={pending} onClick={onClose}>
          대화로 돌아가기
        </Button>
        <Button type="submit" disabled={pending || !valid}>
          {pending ? "저장 중" : kind === "note" ? "메모 저장" : "대사 저장"}
        </Button>
      </div>
    </form>
  );
}
