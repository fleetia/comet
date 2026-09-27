import { useEffect, useState, type JSX } from "react";
import { Button } from "@fleetia/lagrange";
import type {
  ConversationMessages,
  ConversationSession,
  ConversationView,
  Message,
  Snapshot,
} from "../../types";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { characterName } from "../characterIdentity";
import { CharacterHistory } from "../CharacterHistory/CharacterHistory";
import * as s from "../companion.css";
import * as ui from "../../lagrange.css";

export function ConversationMessageList({
  snapshot,
  messages,
  characterNames,
  userNames,
}: {
  snapshot: Snapshot;
  messages: Message[];
  characterNames?: Record<string, string>;
  userNames?: Record<string, string>;
}): JSX.Element {
  return (
    <>
      {messages.map((message) => (
        <p className={s.historyMessage} key={message.id}>
          <span className={s.historyName}>
            {message.role === "user"
              ? (userNames?.[message.id] ??
                snapshot.messageUserNames[message.id] ??
                snapshot.user?.name ??
                "나")
              : (characterNames?.[message.id] ??
                snapshot.messageIdentities.find((identity) => identity.messageId === message.id)
                  ?.name ??
                characterName(snapshot, message.persona ?? ""))}
          </span>
          {message.content}
        </p>
      ))}
    </>
  );
}

export function ConversationLog({
  snapshot,
  sessionId,
  page,
}: {
  snapshot: Snapshot;
  sessionId: string;
  page: ConversationMessages;
}): JSX.Element {
  const [older, setOlder] = useState<ConversationMessages | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messages = Array.from(
    new Map(
      [...(older?.messages ?? []), ...page.messages].map((message) => [message.id, message]),
    ).values(),
  );
  const before = older ? older.nextBefore : page.nextBefore;
  async function loadOlder(): Promise<void> {
    if (pending || before === null) return;
    setPending(true);
    setError(null);
    try {
      const result = await command<ConversationMessages>("get_conversation_messages", {
        sessionId,
        before,
      });
      setOlder((previous) => ({
        messages: [...result.messages, ...(previous?.messages ?? [])],
        nextBefore: result.nextBefore,
        characterNames: { ...previous?.characterNames, ...result.characterNames },
        userNames: { ...previous?.userNames, ...result.userNames },
      }));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPending(false);
    }
  }
  return (
    <div className={s.conversationLog}>
      {before !== null && (
        <Button size="compact" variant="quiet" disabled={pending} onClick={() => void loadOlder()}>
          {pending ? "불러오는 중" : "앞선 내용 더 보기"}
        </Button>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {messages.length === 0 ? (
        <p className={ui.quiet}>아직 나눈 이야기가 없어요.</p>
      ) : (
        <ConversationMessageList
          snapshot={snapshot}
          messages={messages}
          characterNames={{ ...older?.characterNames, ...page.characterNames }}
          userNames={{ ...older?.userNames, ...page.userNames }}
        />
      )}
    </div>
  );
}

export function ConversationHistory({
  snapshot,
  persona,
  sessions,
  loading,
  error,
  onResume,
  previewConversations,
}: {
  snapshot: Snapshot;
  persona: string;
  sessions: ConversationSession[];
  loading: boolean;
  error: string | null;
  onResume: (sessionId: string) => void;
  previewConversations?: ConversationView[];
}): JSX.Element {
  const [selected, setSelected] = useState<ConversationSession | null>(null);
  const [legacy, setLegacy] = useState(false);
  const [page, setPage] = useState<ConversationMessages | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!selected) return;
    let active = true;
    setPage(null);
    setPageError(null);
    const result = isDesktop()
      ? command<ConversationMessages>("get_conversation_messages", { sessionId: selected.id })
      : Promise.resolve(
          previewConversations?.find((conversation) => conversation.session.id === selected.id) ??
            (snapshot.conversation?.session.id === selected.id
              ? snapshot.conversation
              : { messages: [], nextBefore: null }),
        );
    void result
      .then((value) => {
        if (active) setPage(value);
      })
      .catch((cause: unknown) => {
        if (active) setPageError(errorText(cause));
      });
    return () => {
      active = false;
    };
  }, [selected, refresh]);

  if (legacy) {
    return (
      <>
        <Button size="compact" variant="quiet" onClick={() => setLegacy(false)}>
          대화 목록으로
        </Button>
        <CharacterHistory snapshot={snapshot} characterId={persona} />
      </>
    );
  }
  if (selected) {
    return (
      <>
        <div className={s.historyToolbar}>
          <Button size="compact" variant="quiet" onClick={() => setSelected(null)}>
            대화 목록으로
          </Button>
          <Button size="compact" onClick={() => onResume(selected.id)}>
            {selected.status === "ended" ? "이어서 말하기" : "이어하기"}
          </Button>
        </div>
        <p className={s.conversationTitle}>{selected.title || "새 대화"}</p>
        {selected.continuedFrom && (
          <p className={s.conversationMeta}>지난 이야기에서 이어진 대화</p>
        )}
        {page && (
          <ConversationLog
            key={selected.id}
            snapshot={snapshot}
            sessionId={selected.id}
            page={page}
          />
        )}
        {!page && !pageError && (
          <p className={s.conversationMeta} role="status">
            대화 기록을 불러오고 있어요.
          </p>
        )}
        {pageError && (
          <div className={s.notice}>
            <p className={s.error} role="alert">
              {pageError}
            </p>
            <Button variant="quiet" size="compact" onClick={() => setRefresh((value) => value + 1)}>
              다시 불러오기
            </Button>
          </div>
        )}
      </>
    );
  }
  const statusLabels = { active: "대화 중", paused: "접어 둠", ended: "마침" };
  return (
    <div className={s.history}>
      {loading && (
        <p className={ui.quiet} role="status">
          지난 대화를 불러오고 있어요.
        </p>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {!loading && !error && sessions.length === 0 && (
        <p className={ui.quiet}>아직 묶인 대화가 없어요.</p>
      )}
      {sessions.map((session) => (
        <button
          className={s.conversationItem}
          key={session.id}
          onClick={() => setSelected(session)}
        >
          <span>{session.title || "새 대화"}</span>
          <span className={s.conversationMeta}>
            {new Date(session.updatedAt).toLocaleDateString("ko-KR")} ·{" "}
            {statusLabels[session.status]}
          </span>
        </button>
      ))}
      <Button size="compact" variant="quiet" onClick={() => setLegacy(true)}>
        이전 기록
      </Button>
    </div>
  );
}
