import { Fragment, type JSX } from "react";
import { Icon } from "@comet/icon";
import { Button, ChoiceButton, ConstellationChoices } from "@comet/ui";
import type {
  ConversationMessages,
  ConversationMemoryReceipt,
  ConversationSession,
  ConversationTimelineEvent,
  Snapshot,
} from "../../types";
import { characterById, spriteSource } from "../characterIdentity";
import { ConversationMessageActions, type ConversationSaveRequest } from "./ConversationSave";
import { responseOrigin } from "./conversationStatus";
import { draftPreview } from "./ConversationHistory";
import type { useFollowUpChoice } from "./useFollowUpChoice";
import * as s from "./conversationHistoryWindow.css";

export function nameFor(snapshot: Snapshot, id: string): string {
  return characterById(snapshot, id)?.definition.name ?? id;
}
export function sessionName(snapshot: Snapshot, session: ConversationSession): string {
  return session.participants.length > 1
    ? "함께"
    : nameFor(snapshot, session.participants[0] ?? "");
}
export function timeLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
}
export function messageTimeLabel(timestamp: number): string {
  return timeLabel(timestamp).replace(/^오[전후]\s*/, "");
}
export function dayLabel(timestamp: number): string {
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return "오늘";
  today.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "어제";
  return date.toLocaleDateString("ko-KR", {
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    month: "long",
    day: "numeric",
  });
}
export function eventLabel(event: ConversationTimelineEvent): string {
  if (event.kind === "focus-paused") return "집중을 시작해서 대화를 멈췄어요";
  if (event.kind === "resumed") return "지난 대화에서 이야기를 이어가요";
  switch (event.source) {
    case "automatic":
      return "바탕화면에서 먼저 말을 걸었어요";
    case "desktop":
      return "바탕화면에서 대화를 시작했어요";
    case "reply":
      return "이 말에 답장하며 대화를 시작했어요";
    case "history":
      return "지난 대화에서 이야기를 이어가요";
    case "note":
      return "메모를 참고하며 대화를 시작했어요";
    case "music":
      return "음악 이야기를 시작했어요";
    default:
      return "대화 시작";
  }
}

export function Avatar({
  snapshot,
  participants,
  className,
}: {
  snapshot: Snapshot;
  participants: string[];
  className?: string;
}): JSX.Element {
  const character = characterById(snapshot, participants[0] ?? "");
  const image = spriteSource(character, "평온");
  return (
    <span className={[s.avatar, className].filter(Boolean).join(" ")} aria-hidden="true">
      {participants.length > 1 ? (
        <Icon name="together" size={17} />
      ) : image ? (
        <img src={image} alt="" className={s.avatarImage} />
      ) : (
        nameFor(snapshot, participants[0] ?? "").slice(0, 1)
      )}
    </span>
  );
}

export function HistorySessionList({
  snapshot,
  sessions,
  loading,
  listError,
  canRetry,
  onRetry,
  searching,
  selectedId,
  pending,
  onSelect,
}: {
  snapshot: Snapshot;
  sessions: ConversationSession[];
  loading: boolean;
  listError: string | null;
  canRetry: boolean;
  onRetry: () => void;
  searching: boolean;
  selectedId: string | undefined;
  pending: boolean;
  onSelect: (session: ConversationSession) => void;
}): JSX.Element {
  return (
    <div className={s.sessions}>
      {loading && (
        <p className={s.empty} role="status">
          지난 대화를 불러오고 있어요.
        </p>
      )}
      {listError && (
        <p className={s.error} role="alert">
          {listError}
        </p>
      )}
      {canRetry && (
        <Button variant="ghost" size="small" onClick={onRetry}>
          다시 불러오기
        </Button>
      )}
      {!loading && !listError && sessions.length === 0 && (
        <p className={s.empty}>{searching ? "찾는 대화가 없어요." : "아직 나눈 대화가 없어요."}</p>
      )}
      {sessions.map((session, index) => {
        const preview = draftPreview(session.draft);
        return (
          <Fragment key={session.id}>
            {(index === 0 ||
              dayLabel(sessions[index - 1].createdAt) !== dayLabel(session.createdAt)) && (
              <h2 className={s.day}>{dayLabel(session.createdAt)}</h2>
            )}
            <ChoiceButton
              kind="list"
              className={s.session}
              selected={session.id === selectedId}
              disabled={pending}
              onClick={() => onSelect(session)}
            >
              <Avatar
                snapshot={snapshot}
                participants={session.participants}
                className={s.listAvatar}
              />
              <span className={s.sessionCopy}>
                <span className={s.sessionHeading}>
                  <span className={s.sessionName}>{sessionName(snapshot, session)}</span>
                  <time
                    className={`${s.time} ${s.sessionTime}`}
                    dateTime={new Date(session.createdAt).toISOString()}
                  >
                    {timeLabel(session.createdAt)}
                  </time>
                </span>
                <span className={s.preview}>
                  {preview ? `초안 · ${preview}` : session.title || "새 대화"}
                </span>
              </span>
            </ChoiceButton>
          </Fragment>
        );
      })}
    </div>
  );
}

/** One message of the selected conversation with its follow-up choices and memory receipts. */
export function HistoryMessage({
  snapshot,
  page,
  message,
  sessionId,
  busy,
  input,
  followUps,
  followUpChoice,
  receipts,
  pending,
  onSave,
  onOpenMemory,
}: {
  snapshot: Snapshot;
  page: ConversationMessages | null;
  message: ConversationMessages["messages"][number];
  sessionId: string;
  busy: boolean;
  input: string;
  followUps: Snapshot["followUps"];
  followUpChoice: ReturnType<typeof useFollowUpChoice>;
  receipts: ConversationMemoryReceipt[] | undefined;
  pending: boolean;
  onSave: (kind: ConversationSaveRequest["kind"]) => void;
  onOpenMemory: (characterId: string) => void;
}): JSX.Element {
  const user = message.role === "user";
  const name = user
    ? (page?.userNames?.[message.id] ??
      snapshot.messageUserNames[message.id] ??
      snapshot.user?.name ??
      "나")
    : (page?.characterNames?.[message.id] ?? nameFor(snapshot, message.persona ?? ""));
  const time = (
    <time className={s.time} dateTime={new Date(message.createdAt).toISOString()}>
      {messageTimeLabel(message.createdAt)}
    </time>
  );
  const provenance = user
    ? name
    : `${name} · ${responseOrigin(page?.messageSources?.[message.id])}`;
  const provenanceId = `history-origin-${message.id}`;
  return (
    <div
      className={s.messageBlock}

      data-history-message={message.id}
    >
      <article
        className={`${s.message} ${user ? s.userMessage : ""}`}
        aria-label={`${name}의 메시지`}
      >
        {user ? time : <Avatar snapshot={snapshot} participants={[message.persona ?? ""]} />}
        <div className={`${s.messageContent} ${user ? s.userMessageContent : ""}`}>
          <p
            className={`${s.bubble} ${user ? s.userBubble : ""}`}
            title={provenance}
            aria-describedby={provenanceId}
          >
            {message.content}
          </p>
          <div className={`${s.messageTools} ${user ? s.userMessageTools : ""}`}>
            <span className={s.messageLabel} id={provenanceId}>
              {provenance}
            </span>
            <ConversationMessageActions message={message} onSave={onSave} />
          </div>
        </div>
        {!user && time}
      </article>
      {!user &&
        !busy &&
        !input &&
        followUps?.surface === "history-input" &&
        followUps.sessionId === sessionId &&
        followUps.messageId === message.id && (
          <div className={s.followUps}>
            <ConstellationChoices
              label="이어서 할 말"
              options={followUps.options.map((option) => ({
                ...option,
                disabled: followUpChoice.pending,
              }))}
              onChoose={(id) => void followUpChoice.choose(id)}
            />
            {followUpChoice.error && (
              <p className={s.error} role="alert">
                {followUpChoice.error}
              </p>
            )}
          </div>
        )}
      {(receipts?.length ?? 0) > 0 && (
        <div className={`${s.memoryReceipts} ${user ? s.userMemoryReceipts : ""}`}>
          {receipts?.map((receipt) => (
            <Button
              key={receipt.id}
              variant="ghost"
              leadingIcon={<Icon name="memory" size={15} />}
              className={s.memoryReceipt}
              disabled={pending}
              title={`${nameFor(snapshot, receipt.characterId)} · 최근 수정 ${dayLabel(receipt.updatedAt)} ${timeLabel(receipt.updatedAt)}`}
              onClick={() => onOpenMemory(receipt.characterId)}
            >
              기억했어요: {receipt.content}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
