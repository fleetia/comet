import { useEffect, useRef, useState, type JSX } from "react";
import { Button, TextField } from "../../ui";
import { command, errorText } from "../../hooks/useSnapshot";
import type { ConversationNote, ConversationNoteContext, NoteReference } from "../../types";
import * as s from "../companion.css";
import * as n from "./conversationNotes.css";

export function ConversationContext({
  sessionId,
  persona,
  context,
  initiallyChoosing = false,
  disabled = false,
  onClose,
  onBusyChange,
}: {
  sessionId?: string;
  persona: string;
  context?: ConversationNoteContext | null;
  initiallyChoosing?: boolean;
  disabled?: boolean;
  onClose?: () => void;
  onBusyChange?: (busy: boolean) => void;
}): JSX.Element {
  const [choosing, setChoosing] = useState(initiallyChoosing);
  const [notes, setNotes] = useState<ConversationNote[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const active = useRef(true);
  useEffect(() => {
    onBusyChange?.(choosing || pending);
    return () => onBusyChange?.(false);
  }, [choosing, pending, onBusyChange]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  useEffect(() => {
    if (!choosing) return;
    let current = true;
    setLoading(true);
    setError(null);
    void command<ConversationNote[]>("get_conversation_notes")
      .then((result) => {
        if (current) setNotes(result ?? []);
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
  }, [choosing, refresh]);
  async function connect(noteRef: NoteReference | null): Promise<void> {
    if (pending || disabled) return;
    setPending(true);
    setError(null);
    try {
      await command("set_conversation_note_context", { sessionId, persona, noteRef });
      if (active.current) {
        setChoosing(false);
        onClose?.();
      }
    } catch (cause) {
      if (active.current) setError(errorText(cause));
    } finally {
      if (active.current) setPending(false);
    }
  }
  async function openOriginal(): Promise<void> {
    if (!context || pending) return;
    setPending(true);
    setError(null);
    try {
      await command("open_conversation_note", { noteRef: context.noteRef });
    } catch (cause) {
      if (active.current) setError(errorText(cause));
    } finally {
      if (active.current) setPending(false);
    }
  }
  const query = search.trim().toLocaleLowerCase();
  const filtered = notes.filter((note) =>
    `${note.noteRef.title} ${note.body}`.toLocaleLowerCase().includes(query),
  );
  return (
    <section className={n.section} aria-label="대화에서 참고할 메모">
      {context ? (
        <>
          <div className={n.actions}>
            <span>참고 중: {context.noteRef.title}</span>
            <Button
              size="compact"
              variant="quiet"
              disabled={pending || context.available === false}
              onClick={() => void openOriginal()}
            >
              원문 열기
            </Button>
            <Button
              size="compact"
              variant="quiet"
              disabled={pending || disabled}
              onClick={() => setChoosing(!choosing)}
            >
              변경
            </Button>
            <Button
              size="compact"
              variant="quiet"
              disabled={pending || disabled}
              onClick={() => void connect(null)}
            >
              연결 해제
            </Button>
          </div>
          {context.available === false && (
            <p className={s.conversationMeta}>
              원본 메모를 사용할 수 없어요. AI에게 묻기 전에 다른 메모를 고르거나 연결을 해제해
              주세요.
            </p>
          )}
          {context.checkpoint && (
            <details>
              <summary className={s.conversationSummary}>
                지난번에 남긴 내용 ·{" "}
                <time dateTime={new Date(context.checkpoint.savedAt).toISOString()}>
                  {new Date(context.checkpoint.savedAt).toLocaleString()}
                </time>
              </summary>
              <p className={n.text}>{context.checkpoint.text}</p>
            </details>
          )}
        </>
      ) : !choosing ? (
        <Button
          size="compact"
          variant="quiet"
          disabled={disabled}
          onClick={() => setChoosing(true)}
        >
          메모 연결
        </Button>
      ) : null}
      {choosing && (
        <div className={n.choices}>
          <p className={s.conversationMeta}>
            함께 볼 메모 하나를 골라 주세요. AI에게 물으면 연결한 원문을 선택한 AI에 보내요.
          </p>
          <TextField
            aria-label="참고할 메모 검색"
            placeholder="제목이나 내용 검색"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {loading && <p role="status">메모를 불러오는 중이에요.</p>}
          {!loading && !error && filtered.length === 0 && (
            <p className={s.conversationMeta}>
              {query
                ? "검색한 메모가 없어요."
                : "아직 연결할 메모가 없어요. 대화에서 ‘메모에 남기기’로 만들 수 있어요."}
            </p>
          )}
          {filtered.map((note) => (
            <Button
              key={`${note.noteRef.kind}:${note.noteRef.widgetId ?? ""}:${note.noteRef.id}`}
              className={n.choice}
              size="compact"
              variant="quiet"
              disabled={pending || disabled}
              onClick={() => void connect(note.noteRef)}
            >
              {note.noteRef.kind === "diary" ? "다이어리" : "바탕화면"} · {note.noteRef.title}
            </Button>
          ))}
          <div className={n.actions}>
            <Button
              size="compact"
              variant="quiet"
              disabled={loading || pending}
              onClick={() => setRefresh((value) => value + 1)}
            >
              새로고침
            </Button>
            <Button
              size="compact"
              variant="quiet"
              disabled={pending}
              onClick={() => {
                setChoosing(false);
                onClose?.();
              }}
            >
              닫기
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
