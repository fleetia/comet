import { useEffect, useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { Button, IconButton, Select, TextArea } from "@fleetia/lagrange";
import type {
  ConversationSession,
  ConversationView,
  Dispatch,
  Persona,
  Snapshot,
} from "../../types";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { useBalloonSizing } from "../../hooks/useBalloonSizing";
import { useTypewriter } from "../../hooks/useTypewriter";
import * as s from "../companion.css";
import * as ui from "../../lagrange.css";
import { NameRegistration } from "./NameRegistration";
import { ConversationHistory, ConversationLog } from "./ConversationHistory";
import { StoryChoices } from "../StoryChoices/StoryChoices";
import { activeCharacter, BALLOON_SPRITE, characterName, spriteUrl } from "../characterIdentity";
import { skinStyle, useImageSlice } from "../../hooks/useImageSlice";
import { balloonTextStyle } from "../balloonTypography";
import { aiAvailability, responseOrigin } from "./conversationStatus";

type Props = {
  snapshot: Snapshot;
  preview?: boolean;
  dispatch?: Dispatch;
  previewConversations?: ConversationView[];
};

function WaitingDots(): JSX.Element {
  return (
    <>
      <span className={s.waitingLabel}>답변 준비 중</span>
      <span className={s.waitingDots} aria-hidden="true">
        <span className={s.waitingDot}>.</span>
        <span className={s.waitingDot}>.</span>
        <span className={s.waitingDot}>.</span>
      </span>
    </>
  );
}

export function shouldSubmit(
  event: Pick<KeyboardEvent<HTMLTextAreaElement>, "key" | "shiftKey" | "nativeEvent">,
  composing: boolean,
): boolean {
  return (
    event.key === "Enter" &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing &&
    event.nativeEvent.keyCode !== 229 &&
    !composing
  );
}
export function Balloon({
  snapshot,
  preview = false,
  dispatch = command,
  previewConversations,
}: Props): JSX.Element {
  const speaker: Persona =
    snapshot.panel?.persona ??
    snapshot.story?.persona ??
    snapshot.playback?.persona ??
    snapshot.runtime.persona ??
    snapshot.characters.active[0] ??
    "a";
  const persona = activeCharacter(snapshot, speaker)?.id ?? speaker;
  const mode = snapshot.panel?.mode;
  const conversation = snapshot.conversation;
  const sessionId = conversation?.session.id;
  const viewIdentity = `${snapshot.user?.id ?? ""}:${mode === "input" && sessionId ? `conversation:${sessionId}` : snapshot.panel ? `${mode}:${snapshot.panel.persona}` : (snapshot.playback?.id ?? "")}`;
  const currentView = useRef({ identity: viewIdentity, mode, sessionId });
  currentView.current = { identity: viewIdentity, mode, sessionId };
  const name = characterName(snapshot, persona);
  const character = activeCharacter(snapshot, persona);
  const textStyle = balloonTextStyle(character?.definition.balloonStyle);
  const skin = spriteUrl(character, BALLOON_SPRITE);
  const { slice, ready: imageReady } = useImageSlice(skin);
  const skinned = skin && slice ? skinStyle(skin, slice) : undefined;
  const transparent = !preview;
  useLayoutEffect(() => {
    if (!transparent) return;
    document.documentElement.classList.add(s.transparentDocument);
    return () => document.documentElement.classList.remove(s.transparentDocument);
  }, [transparent]);
  const draft = useRef({
    sessionId,
    value: conversation?.session.draft ?? "",
    saved: conversation?.session.draft ?? "",
  });
  const saveQueue = useRef(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [input, setInput] = useState(draft.current.value);
  const [target, setTarget] = useState<Persona | "all">(persona);
  const [pending, setPending] = useState(false);
  const [navigating, setNavigating] = useState(false);
  const navigatingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [failureRevision, setFailureRevision] = useState(0);
  const [failedSubmission, setFailedSubmission] = useState<{
    id: string;
    content: string;
  } | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const lastActivity = useRef(Date.now());
  const composing = useRef(false);
  const submitting = useRef(false);
  const lastSubmission = useRef<{ id: string; content: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const responding = ["loading", "generating"].includes(snapshot.runtime.phase);
  const playing = Boolean(conversation && snapshot.playback);
  const idleBlocked = useRef(false);
  idleBlocked.current = responding || playing || pending || logOpen || input.length > 0;
  const latestUser = (conversation?.messages ?? snapshot.messages)
    .filter((message) => message.role === "user")
    .at(-1);
  const canRetry =
    snapshot.user &&
    (mode === "input" || !mode) &&
    snapshot.runtime.phase === "error" &&
    latestUser;
  const visibleError = error || (mode === "input" || !mode ? snapshot.runtime.error : null);
  const availability = aiAvailability(snapshot);
  const latestInputContent =
    latestUser && lastSubmission.current?.id === latestUser.id
      ? lastSubmission.current.content
      : latestUser?.content;
  const failedContent = visibleError
    ? (failedSubmission?.content ?? (canRetry ? latestInputContent : null))
    : null;
  useLayoutEffect(() => {
    // A failed send can arrive while the native window still has its previous size,
    // or while an expanded conversation log has scrolled the document.
    if (mode === "input" && visibleError) {
      errorRef.current?.scrollIntoView?.({ block: "nearest" });
    }
  }, [mode, visibleError, failureRevision, latestUser?.id]);
  useEffect(() => {
    if (sessionId) return;
    setTarget(persona);
  }, [persona, sessionId]);
  useEffect(() => {
    draft.current = {
      sessionId,
      value: conversation?.session.draft ?? "",
      saved: conversation?.session.draft ?? "",
    };
    setInput(draft.current.value);
    setError(null);
    setFailedSubmission(null);
    lastSubmission.current = null;
  }, [snapshot.user?.id]);
  useEffect(() => {
    if (!conversation || draft.current.sessionId === sessionId) return;
    draft.current = {
      sessionId,
      value: conversation.session.draft,
      saved: conversation.session.draft,
    };
    setInput(conversation.session.draft);
    setError(null);
    setFailedSubmission(null);
    lastSubmission.current = null;
    setLogOpen(false);
  }, [sessionId]);
  useEffect(() => {
    // Async generation can fail after send_message accepted and cleared the editor.
    // Restore only an empty draft, never text written while that request was running.
    if (
      mode !== "input" ||
      !conversation ||
      snapshot.runtime.phase !== "error" ||
      !latestUser ||
      draft.current.value.length > 0
    )
      return;
    const content = latestInputContent ?? latestUser.content;
    draft.current.value = content;
    setInput(content);
  }, [mode, sessionId, snapshot.runtime.phase, latestUser?.id]);
  useEffect(() => {
    if (!conversation) return;
    const participants = conversation.session.participants;
    setTarget(participants.length > 1 ? "all" : (participants[0] ?? persona));
  }, [sessionId]);
  useEffect(() => {
    if (mode === "input") {
      inputRef.current?.focus({ preventScroll: Boolean(visibleError) });
    }
  }, [mode]);
  useEffect(() => {
    setError(null);
    setFailedSubmission(null);
  }, [mode, persona]);
  useEffect(() => {
    if (mode !== "menu" && mode !== "history") return;
    let active = true;
    setSessions([]);
    setSessionsError(null);
    if (!isDesktop()) {
      setSessionsLoading(false);
      setSessions(
        (previewConversations ?? (conversation ? [conversation] : []))
          .map((item) => item.session)
          .filter((session) => session.participants.includes(persona))
          .sort((left, right) => right.updatedAt - left.updatedAt),
      );
      return;
    }
    setSessionsLoading(true);
    void command<ConversationSession[]>("get_conversations", { persona })
      .then((result) => {
        if (active) setSessions(result ?? []);
      })
      .catch((cause: unknown) => {
        if (active) setSessionsError(errorText(cause));
      })
      .finally(() => {
        if (active) setSessionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, persona, snapshot.user?.id, previewConversations]);
  const contentKey = snapshot.panel
    ? `panel:${snapshot.panel.persona}:${snapshot.panel.mode}${mode === "input" && snapshot.playback ? `:playback:${snapshot.playback.id}` : ""}`
    : snapshot.story
      ? `story:${snapshot.story.id}`
      : snapshot.playback
        ? `playback:${snapshot.playback.id}`
        : `runtime:${snapshot.runtime.phase}:${snapshot.runtime.persona ?? ""}`;
  const { elementRef: balloonRef, ready } = useBalloonSizing(
    preview,
    contentKey,
    imageReady,
    `${textStyle.fontSize}:${textStyle.fontFamily ?? ""}`,
    setError,
  );
  const fullText = snapshot.playback?.text ?? "";
  const revealedText = useTypewriter(
    snapshot.playback?.id ?? "",
    fullText,
    snapshot.playback?.textSpeed ?? 0,
    ready && (!mode || mode === "input") && !snapshot.story,
  );
  const revealing = revealedText !== fullText;
  function persistDraft(): Promise<void> {
    const current = draft.current;
    const value = current.value;
    const task = saveQueue.current.then(async () => {
      if (!current.sessionId || current.saved === value) return;
      await dispatch("save_conversation_draft", { sessionId: current.sessionId, draft: value });
      current.saved = value;
    });
    saveQueue.current = task.catch(() => {});
    return task;
  }
  async function flushDraft(): Promise<void> {
    clearTimeout(saveTimer.current);
    await persistDraft();
  }
  useEffect(() => {
    if (mode !== "input" || !sessionId || input === draft.current.saved) return;
    saveTimer.current = setTimeout(() => {
      void persistDraft().catch((cause: unknown) => setError(errorText(cause)));
    }, 400);
    return () => clearTimeout(saveTimer.current);
  }, [input, sessionId, mode]);
  async function leave(name: string, args?: Record<string, unknown>): Promise<void> {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    setNavigating(true);
    setError(null);
    const previousView = currentView.current;
    try {
      await flushDraft();
      if (currentView.current.identity !== previousView.identity) return;
      await dispatch(
        name,
        name === "close_panel" && previousView.mode === "input" && previousView.sessionId
          ? { ...args, sessionId: previousView.sessionId }
          : args,
      );
    } catch (cause) {
      if (currentView.current.identity === previousView.identity) setError(errorText(cause));
    } finally {
      navigatingRef.current = false;
      setNavigating(false);
    }
  }
  async function perform(name: string, args?: Record<string, unknown>): Promise<void> {
    setError(null);
    try {
      await dispatch(name, args);
    } catch (cause) {
      setError(errorText(cause));
      setFailureRevision((revision) => revision + 1);
    }
  }
  async function openModelSettings(): Promise<void> {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    setNavigating(true);
    const previousView = currentView.current;
    try {
      await flushDraft();
      if (currentView.current.identity !== previousView.identity) return;
      await dispatch("set_settings_section", { section: "model" });
      if (currentView.current.identity !== previousView.identity) return;
      await dispatch("open_settings");
    } catch (cause) {
      if (currentView.current.identity === previousView.identity) setError(errorText(cause));
    } finally {
      navigatingRef.current = false;
      setNavigating(false);
    }
  }
  const closeCommand = snapshot.panel ? "close_panel" : "skip_talk";
  useEffect(() => {
    function close(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        void leave(closeCommand);
      }
    }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [closeCommand, dispatch]);
  useEffect(() => {
    lastActivity.current = Date.now();
    if (
      mode !== "input" ||
      !sessionId ||
      input.length > 0 ||
      logOpen ||
      responding ||
      playing ||
      pending
    )
      return;
    const timer = setInterval(() => {
      if (
        Date.now() - lastActivity.current >= 90_000 &&
        !composing.current &&
        !idleBlocked.current &&
        draft.current.value.length === 0 &&
        currentView.current.mode === "input" &&
        currentView.current.sessionId === sessionId
      ) {
        lastActivity.current = Date.now();
        void leave("close_panel");
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [mode, sessionId, input, logOpen, responding, playing, pending]);
  async function send(): Promise<void> {
    if (
      !snapshot.user ||
      !input.trim() ||
      submitting.current ||
      responding ||
      playing ||
      navigatingRef.current
    ) {
      return;
    }
    submitting.current = true;
    setPending(true);
    setError(null);
    setFailedSubmission(null);
    const submittedDraft = draft.current;
    const submittedValue = input;
    const submittedView = currentView.current.identity;
    const clientMessageId = crypto.randomUUID();
    try {
      await flushDraft();
      if (draft.current !== submittedDraft || currentView.current.identity !== submittedView)
        return;
      lastSubmission.current = { id: clientMessageId, content: submittedValue };
      await dispatch("send_message", {
        content: input.trim(),
        target,
        clientMessageId,
        ...(submittedDraft.sessionId ? { sessionId: submittedDraft.sessionId } : {}),
      });
      if (draft.current === submittedDraft) {
        submittedDraft.saved = "";
        if (submittedDraft.value === submittedValue) {
          submittedDraft.value = "";
          setInput("");
        } else {
          await persistDraft();
        }
      }
    } catch (cause) {
      if (draft.current === submittedDraft) {
        setFailedSubmission({ id: clientMessageId, content: submittedValue });
        setError(errorText(cause));
        setFailureRevision((revision) => revision + 1);
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  const latestReply = conversation?.messages
    .filter((message) => message.role === "assistant")
    .at(-1);
  const failedInputIndex =
    conversation?.messages.findIndex(
      (message) => message.id === (failedSubmission?.id ?? latestUser?.id),
    ) ?? -1;
  const hasCurrentReply = Boolean(
    failedInputIndex >= 0 &&
    conversation!.messages
      .slice(failedInputIndex + 1)
      .some((message) => message.role === "assistant" && message.content.trim().length > 0),
  );
  const previousReply = Boolean(
    failedContent &&
    latestReply &&
    (failedInputIndex < 0 || conversation!.messages.indexOf(latestReply) < failedInputIndex),
  );
  const paused = sessions.find((session) => session.status === "paused");
  const recipientName = characterName(
    snapshot,
    target === "all" ? (conversation?.session.participants[0] ?? persona) : target,
  );
  const labels = {
    menu: "무엇을 할까?",
    input: target === "all" ? "함께 대화 중" : `${recipientName}와 대화`,
    history: "지난 대화",
    name: "처음 만났네",
  };
  const speech = (
    <span className={s.speechText}>
      <span style={{ visibility: revealing ? "hidden" : undefined }}>{fullText}</span>
      {revealing && (
        <span className={s.speechReveal} aria-hidden="true">
          {revealedText}
        </span>
      )}
    </span>
  );
  const notice = (visibleError || canRetry || responding) && (
    <div className={s.notice}>
      {failedContent && (
        <div aria-label="답변에 실패한 이번 입력">
          <span className={s.historyName}>
            이번 입력 · {hasCurrentReply ? "답변을 마치지 못했어요" : "답변을 받지 못했어요"}
          </span>
          <p className={s.failedInput}>{failedContent}</p>
        </div>
      )}
      {visibleError && (
        <p ref={errorRef} className={s.error} role="alert">
          {visibleError}
        </p>
      )}
      <div className={s.row}>
        {canRetry && (
          <Button
            variant="secondary"
            disabled={pending || responding}
            onClick={() =>
              void perform("retry_turn", {
                messageId: latestUser.id,
                target: latestUser.persona,
              })
            }
          >
            다시 이야기하기
          </Button>
        )}
        {responding && (
          <Button variant="quiet" size="compact" onClick={() => void perform("cancel_generation")}>
            생성 멈추기
          </Button>
        )}
      </div>
    </div>
  );
  return (
    <section
      ref={balloonRef}
      className={`${s.balloon} ${mode ? s.balloonPanel : ""} ${preview ? s.balloonPreview : ""} ${skin && (!imageReady || slice) ? s.balloonSkinned : ""}`}
      style={skinned}
      aria-label={mode ? labels[mode] : "말풍선"}
      onPointerMove={() => {
        lastActivity.current = Date.now();
      }}
      onPointerDownCapture={() => {
        lastActivity.current = Date.now();
      }}
      onKeyDownCapture={() => {
        lastActivity.current = Date.now();
      }}
      onFocusCapture={() => {
        lastActivity.current = Date.now();
      }}
      onWheel={() => {
        lastActivity.current = Date.now();
      }}
    >
      {mode ? (
        <header className={s.balloonHeader}>
          {(mode === "input" || mode === "history") && (
            <Button
              variant="quiet"
              size="compact"
              disabled={navigating}
              onClick={() => void leave("open_panel", { persona, mode: "menu" })}
            >
              메뉴로
            </Button>
          )}
          <span>{labels[mode]}</span>
          <IconButton
            size="compact"
            variant="quiet"
            label={mode === "input" && conversation ? "대화 접어 두기" : "패널 닫기"}
            disabled={navigating}
            onClick={() => void leave(closeCommand)}
          >
            ×
          </IconButton>
        </header>
      ) : (
        <IconButton
          className={s.balloonClose}
          size="compact"
          variant="quiet"
          label="이야기 닫기"
          onClick={() => void leave(closeCommand)}
        >
          ×
        </IconButton>
      )}
      {mode === "menu" && (
        <>
          <nav className={s.menu} aria-label="캐릭터 메뉴">
            <div className={s.menuGroup} role="group" aria-label="대화">
              <Button
                variant="quiet"
                className={s.menuItem}
                onClick={() => void perform("open_panel", { persona, mode: "input" })}
              >
                말 걸기
              </Button>
              {paused && (
                <Button
                  variant="quiet"
                  className={s.menuItem}
                  onClick={() => void perform("resume_chat", { sessionId: paused.id })}
                >
                  이어하기
                </Button>
              )}
              <Button
                variant="quiet"
                className={s.menuItem}
                onClick={() => void perform("talk_now")}
              >
                {snapshot.characters.active.length > 1 ? "함께 이야기해 봐" : "혼잣말 들어 보기"}
              </Button>
              <Button
                variant="quiet"
                className={s.menuItem}
                onClick={() => void perform("open_panel", { persona, mode: "history" })}
              >
                지난 대화
              </Button>
            </div>
            <div className={s.menuGroup} role="group" aria-label="관리">
              <Button
                variant="quiet"
                className={s.menuItem}
                onClick={() => void perform("open_settings")}
              >
                설정
              </Button>
            </div>
            <div className={s.menuGroup} role="group" aria-label="자동 잡담과 표시">
              {snapshot.runtime.paused ? (
                <Button
                  variant="quiet"
                  className={s.menuItem}
                  onClick={() => void perform("set_paused", { paused: false })}
                >
                  다시 시작
                </Button>
              ) : (
                <details>
                  <summary className={s.pauseSummary}>자동 잡담 쉬기</summary>
                  <Button
                    variant="quiet"
                    className={s.menuItem}
                    onClick={() => void perform("set_paused", { paused: true, minutes: 60 })}
                  >
                    1시간
                  </Button>
                  <Button
                    variant="quiet"
                    className={s.menuItem}
                    onClick={() => void perform("set_paused", { paused: true })}
                  >
                    다시 시작할 때까지
                  </Button>
                </details>
              )}
              <Button
                variant="quiet"
                className={s.menuItem}
                onClick={() => void perform("hide_boxes")}
              >
                캐릭터 숨기기
              </Button>
            </div>
          </nav>
          {sessionsError && (
            <p className={s.error} role="alert">
              {sessionsError}
            </p>
          )}
          <div className={s.footer}>
            <span>
              {name}와 친밀도{" "}
              {snapshot.relationships.find((relationship) => relationship.persona === persona)
                ?.score ?? 20}
              /100
            </span>
            {snapshot.runtime.paused && (
              <span>
                {snapshot.runtime.pausedUntil
                  ? `${new Date(snapshot.runtime.pausedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}까지 자동 잡담 쉬는 중`
                  : "자동 잡담 쉬는 중"}
              </span>
            )}
          </div>
        </>
      )}
      {mode === "name" && !snapshot.user && (
        <NameRegistration
          key={persona}
          greeting={character?.definition.greeting[0]?.text ?? "안녕! 만나서 반가워."}
          dispatch={dispatch}
        />
      )}
      {mode === "input" && (
        <div className={s.inputContents} role="region" aria-label="대화 내용과 입력" tabIndex={0}>
          {notice}
          {conversation && (snapshot.playback || latestReply) && (
            <div
              className={s.conversationSpeech}
              style={textStyle}
              aria-live="polite"
              aria-label={snapshot.playback ? fullText : undefined}
            >
              <span className={s.historyName}>
                {!snapshot.playback && previousReply && "이전 답변 · "}
                {!snapshot.playback && latestReply && conversation.characterNames?.[latestReply.id]
                  ? conversation.characterNames[latestReply.id]
                  : characterName(
                      snapshot,
                      snapshot.playback?.persona ?? latestReply?.persona ?? persona,
                    )}
              </span>
              <span className={s.responseOrigin}>
                {responseOrigin(
                  snapshot.playback?.source ??
                    (latestReply ? conversation.messageSources?.[latestReply.id] : undefined),
                )}
              </span>
              {snapshot.playback ? speech : latestReply?.content}
            </div>
          )}
          {conversation && (
            <details
              className={s.conversationDetails}
              open={logOpen}
              onToggle={(event) => setLogOpen(event.currentTarget.open)}
            >
              <summary className={s.conversationSummary}>이번 대화</summary>
              {logOpen && (
                <ConversationLog
                  key={sessionId}
                  snapshot={snapshot}
                  sessionId={conversation.session.id}
                  page={conversation}
                />
              )}
            </details>
          )}
          <form
            className={s.form}
            onSubmit={(event) => {
              event.preventDefault();
              void send();
            }}
          >
            <div aria-label="대화 가능 상태">
              <div className={s.row}>
                <p className={s.conversationMeta}>{availability.label}</p>
                {!availability.ready && (
                  <Button
                    variant="quiet"
                    size="compact"
                    disabled={navigating}
                    onClick={() => void openModelSettings()}
                  >
                    AI 연결 설정
                  </Button>
                )}
              </div>
              <p className={s.conversationMeta}>
                등록된 키워드 답장·혼잣말은 모델 없이 사용할 수 있어요.
              </p>
            </div>
            <div className={s.recipientRow}>
              <label className={ui.quiet}>
                받는 친구{" "}
                <Select
                  className={s.recipient}
                  value={target}
                  disabled={Boolean(conversation && latestUser) || navigating}
                  onChange={(event) => setTarget(event.target.value as Persona | "all")}
                >
                  <option value={conversation?.session.participants[0] ?? persona}>
                    {recipientName}
                  </option>
                  {(snapshot.characters.active.length > 1 || target === "all") && (
                    <option value="all">모두에게</option>
                  )}
                </Select>
              </label>
              <span className={ui.quiet}>Shift + Enter 줄바꿈</span>
            </div>
            <TextArea
              resize="none"
              ref={inputRef}
              className={s.input}
              aria-label={target === "all" ? "모두에게 할 말" : `${recipientName}에게 할 말`}
              value={input}
              rows={3}
              disabled={!snapshot.user || navigating}
              maxLength={2000}
              placeholder="하고 싶은 이야기를 적어 줘."
              onChange={(event) => {
                draft.current.value = event.target.value;
                setInput(event.target.value);
              }}
              onCompositionStart={() => {
                composing.current = true;
              }}
              onCompositionEnd={() => {
                composing.current = false;
              }}
              onKeyDown={(event) => {
                if (shouldSubmit(event, composing.current)) {
                  event.preventDefault();
                  void send();
                }
              }}
            />
            <div className={s.row}>
              <span className={ui.quiet} role="status">
                {responding && <WaitingDots />}
              </span>
              <Button
                type="submit"
                disabled={
                  !snapshot.user || !input.trim() || responding || playing || pending || navigating
                }
              >
                {pending ? "전송 중" : "보내기"}
              </Button>
            </div>
            {conversation && (
              <Button
                variant="quiet"
                size="compact"
                disabled={navigating}
                onClick={() => void leave("finish_conversation", { sessionId })}
              >
                대화 끝내기
              </Button>
            )}
          </form>
        </div>
      )}
      {mode === "history" && (
        <>
          <ConversationHistory
            key={`${snapshot.user?.id}:${persona}`}
            snapshot={snapshot}
            persona={persona}
            sessions={sessions}
            loading={sessionsLoading}
            error={sessionsError}
            previewConversations={previewConversations}
            onResume={(id) => void perform("resume_chat", { sessionId: id })}
          />
          <div className={s.footer}>
            {snapshot.relationships.map((relationship) => (
              <span key={relationship.persona}>
                {characterName(snapshot, relationship.persona)} 친밀도 {relationship.score}/100
              </span>
            ))}
          </div>
        </>
      )}
      {!mode && snapshot.story && (
        <StoryChoices
          key={snapshot.story.id}
          story={snapshot.story}
          dispatch={dispatch}
          textStyle={textStyle}
        />
      )}
      {!mode && !snapshot.story && (
        <div
          className={s.speech}
          style={textStyle}
          aria-live="polite"
          aria-label={fullText || undefined}
        >
          {snapshot.playback ? (
            <button
              className={s.replySpeech}
              aria-label={`${name}에게 답장: ${fullText}`}
              title="클릭해서 답장"
              onClick={() => void perform("open_reply", { playbackId: snapshot.playback!.id })}
            >
              {speech}
            </button>
          ) : responding ? (
            <WaitingDots />
          ) : (
            ""
          )}
        </div>
      )}
      {!mode && !snapshot.story && snapshot.playback && (
        <span className={s.playbackOrigin}>{responseOrigin(snapshot.playback.source)}</span>
      )}
      {mode !== "input" && notice}
    </section>
  );
}
