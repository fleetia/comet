import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
} from "react";
import { Button, IconButton, Select, TextArea } from "../../ui";
import { SendIcon, CloseIcon, ArrowRightIcon, Icon } from "@comet/icon";
import {
  Balloon as NoticeBalloon,
  Button as CometButton,
  Dialog,
  InputCapsule,
  WaitingDots,
} from "@comet/ui";
import type { ConversationView, Dispatch, Persona, Snapshot } from "../../types";
import { command, errorText } from "../../hooks/useSnapshot";
import { useBalloonSizing } from "../../hooks/useBalloonSizing";
import { useTypewriter } from "../../hooks/useTypewriter";
import * as s from "../companion.css";
import * as ui from "../../common.css";
import * as surfaceStyle from "./conversationSurface.css";
import { CharacterOrbit } from "./CharacterOrbit";
import { NameRegistration } from "./NameRegistration";
import { ConversationHistory, ConversationLog } from "./ConversationHistory";
import { StoryChoices } from "../StoryChoices/StoryChoices";
import * as storyStyle from "../StoryChoices/story.css";
import { activeCharacter, BALLOON_SPRITE, characterName, spriteUrl } from "../characterIdentity";
import { skinStyle, useImageSlice } from "../../hooks/useImageSlice";
import { balloonTextStyle } from "../balloonTypography";
import { aiAvailability, responseOrigin } from "./conversationStatus";
import { OrganizerReceipt } from "./OrganizerReceipt";
import { ConversationContext } from "./ConversationContext";
import { useConversationSessions } from "./useConversationSessions";
import {
  ConversationMessageActions,
  ConversationSave,
  type ConversationSaveRequest,
} from "./ConversationSave";

type Props = {
  snapshot: Snapshot;
  preview?: boolean;
  dispatch?: Dispatch;
  previewConversations?: ConversationView[];
  surface?: "combined" | "input";
};

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
  surface = "combined",
}: Props): JSX.Element {
  const speaker: Persona =
    snapshot.panel?.persona ??
    snapshot.story?.persona ??
    snapshot.playback?.persona ??
    snapshot.runtime.persona ??
    snapshot.characters.active[0] ??
    "a";
  const persona = activeCharacter(snapshot, speaker)?.id ?? speaker;
  const guestPersona = snapshot.runtime.guestCharacterIds?.includes(persona) ? persona : undefined;
  const mode = snapshot.panel?.mode;
  const updateNotice = snapshot.playback?.source === "update" && (!mode || mode === "update");
  const updateActionsId = useId();
  const conversation = snapshot.conversation;
  const sessionId = conversation?.session.id;
  const userId = snapshot.user?.id;
  const viewIdentity = `${snapshot.user?.id ?? ""}:${mode === "input" && sessionId ? `conversation:${sessionId}` : snapshot.panel ? `${mode}:${snapshot.panel.persona}${mode === "update" ? `:${snapshot.playback?.id ?? ""}` : ""}` : (snapshot.playback?.id ?? "")}`;
  const currentView = useRef({
    identity: viewIdentity,
    mode,
    sessionId,
    userId,
    recoveryId: conversation?.recovery?.messageId,
  });
  currentView.current = {
    identity: viewIdentity,
    mode,
    sessionId,
    userId,
    recoveryId: conversation?.recovery?.messageId,
  };
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
    userId: conversation?.session.userId ?? userId,
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
  const [orbitCloseRequest, setOrbitCloseRequest] = useState(0);
  const navigatingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (updateNotice) setError(null);
  }, [updateNotice, snapshot.playback?.id]);
  const [draftReplacement, setDraftReplacement] = useState<{
    identity: string;
    messageId: string;
    content: string;
    previousDraft: string;
  } | null>(null);
  const [failureRevision, setFailureRevision] = useState(0);
  const [failedSubmission, setFailedSubmission] = useState<{
    id: string;
    content: string;
  } | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const [latestUserOpen, setLatestUserOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [choosingResumeNote, setChoosingResumeNote] = useState(false);
  const [saveSelection, setSaveSelection] = useState<{
    identity: string;
    request: ConversationSaveRequest;
  } | null>(null);
  const saveRequest = saveSelection?.identity === viewIdentity ? saveSelection.request : null;
  function selectSave(request: ConversationSaveRequest | null): void {
    setSaveSelection(request ? { identity: viewIdentity, request } : null);
  }
  const [contextBusy, setContextBusy] = useState(false);
  const lastActivity = useRef(Date.now());
  const composing = useRef(false);
  const submitting = useRef(false);
  const currentRequestEpoch = useRef(snapshot.activeRequest?.epoch);
  currentRequestEpoch.current = snapshot.activeRequest?.epoch;
  const lastSubmission = useRef<{ id: string; content: string } | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const responding = ["loading", "generating"].includes(snapshot.runtime.phase);
  const playing = Boolean(conversation && snapshot.playback);
  const idleBlocked = useRef(false);
  idleBlocked.current =
    responding ||
    playing ||
    pending ||
    logOpen ||
    latestUserOpen ||
    moreOpen ||
    choosingResumeNote ||
    contextBusy ||
    Boolean(saveRequest) ||
    input.length > 0;
  const latestUser = (conversation?.messages ?? snapshot.messages)
    .filter((message) => message.role === "user")
    .at(-1);
  const recovery = conversation?.recovery;
  const canRetry = Boolean(
    snapshot.user &&
    mode === "input" &&
    latestUser &&
    recovery?.messageId === latestUser.id &&
    !responding &&
    !playing,
  );
  const visibleError = error || (mode === "input" || !mode ? snapshot.runtime.error : null);
  const availability = aiAvailability(snapshot);
  const latestInputContent =
    latestUser && lastSubmission.current?.id === latestUser.id
      ? lastSubmission.current.content
      : latestUser?.content;
  const failedContent =
    visibleError || canRetry
      ? (failedSubmission?.content ?? (canRetry ? latestInputContent : null))
      : null;
  useEffect(() => {
    setDraftReplacement(null);
  }, [viewIdentity, latestUser?.id, responding, playing]);
  useEffect(() => {
    setSaveSelection(null);
    setChoosingResumeNote(false);
    setMoreOpen(false);
  }, [viewIdentity]);
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
      userId: conversation?.session.userId ?? userId,
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
      userId: conversation.session.userId,
      sessionId,
      value: conversation.session.draft,
      saved: conversation.session.draft,
    };
    setInput(conversation.session.draft);
    setError(null);
    setFailedSubmission(null);
    lastSubmission.current = null;
    setLogOpen(false);
    setLatestUserOpen(false);
  }, [sessionId]);
  useEffect(() => {
    // Async generation can fail after send_message accepted and cleared the editor.
    // Restore only an empty draft, never text written while that request was running.
    if (
      mode !== "input" ||
      !conversation ||
      snapshot.runtime.phase !== "error" ||
      recovery?.reason !== "incomplete" ||
      recovery.messageId !== latestUser?.id ||
      !latestUser ||
      draft.current.value.length > 0
    )
      return;
    const content = latestInputContent ?? latestUser.content;
    draft.current.value = content;
    setInput(content);
  }, [
    mode,
    sessionId,
    snapshot.runtime.phase,
    latestUser?.id,
    recovery?.messageId,
    recovery?.reason,
  ]);
  useEffect(() => {
    if (!conversation) return;
    const participants = conversation.session.participants;
    setTarget(guestPersona ?? (participants.length > 1 ? "all" : (participants[0] ?? persona)));
  }, [sessionId, guestPersona]);
  useEffect(() => {
    if (mode === "input") {
      inputRef.current?.focus({ preventScroll: Boolean(visibleError) });
    }
  }, [mode, choosingResumeNote]);
  useEffect(() => {
    setError(null);
    setFailedSubmission(null);
  }, [mode, persona]);
  useEffect(() => {
    if (surface === "input") setChoosingResumeNote(false);
  }, [viewIdentity, surface]);
  const { sessions, sessionsLoading, sessionsError } = useConversationSessions({
    mode,
    surface,
    persona,
    userId: snapshot.user?.id,
    conversation,
    previewConversations,
  });
  const contentKey = snapshot.panel
    ? `panel:${snapshot.panel.persona}:${snapshot.panel.mode}${(mode === "input" || mode === "history-input" || mode === "update") && snapshot.playback ? `:playback:${snapshot.playback.id}` : ""}`
    : snapshot.story
      ? `story:${snapshot.story.id}`
      : snapshot.playback
        ? `playback:${snapshot.playback.id}`
        : `runtime:${snapshot.runtime.phase}:${snapshot.runtime.persona ?? ""}`;
  const orbitMenu = mode === "menu" && !choosingResumeNote && !saveRequest;
  const {
    elementRef: balloonRef,
    ready,
    orbitAnchor,
    native: sizingNative,
  } = useBalloonSizing(
    preview,
    contentKey,
    surface === "input" || orbitMenu || imageReady,
    `${textStyle.fontSize}:${textStyle.fontFamily ?? ""}`,
    setError,
    surface === "input" ? "input" : undefined,
  );
  const fullText = snapshot.playback?.text ?? "";
  const revealedText = useTypewriter(
    snapshot.playback?.id ?? "",
    fullText,
    snapshot.playback?.textSpeed ?? 0,
    ready &&
      surface !== "input" &&
      (!mode || mode === "input" || mode === "update") &&
      (!snapshot.story || mode === "input"),
  );
  const revealing = revealedText !== fullText;
  function persistDraft(current = draft.current): Promise<void> {
    const value = current.value;
    const task = saveQueue.current.then(async () => {
      if (
        !current.sessionId ||
        current.userId !== currentView.current.userId ||
        current.saved === value
      )
        return;
      await dispatch("save_conversation_draft", {
        sessionId: current.sessionId,
        draft: value,
        inputOwner: "desktop",
      });
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
  useEffect(() => {
    if (mode !== "input") return;
    const current = draft.current;
    return () => {
      void persistDraft(current).catch((cause: unknown) => {
        if (current.userId === currentView.current.userId) setError(errorText(cause));
      });
    };
  }, [sessionId, mode, userId]);
  async function leave(name: string, args?: Record<string, unknown>): Promise<boolean> {
    if (navigatingRef.current) return false;
    navigatingRef.current = true;
    setNavigating(true);
    setError(null);
    const previousView = currentView.current;
    try {
      await flushDraft();
      if (currentView.current.identity !== previousView.identity) return false;
      await dispatch(
        name,
        name === "close_panel" && previousView.mode === "input" && previousView.sessionId
          ? { ...args, sessionId: previousView.sessionId }
          : args,
      );
      return true;
    } catch (cause) {
      if (currentView.current.identity === previousView.identity) setError(errorText(cause));
      return false;
    } finally {
      navigatingRef.current = false;
      setNavigating(false);
    }
  }
  async function perform(name: string, args?: Record<string, unknown>): Promise<boolean> {
    setError(null);
    try {
      await dispatch(name, args);
      return true;
    } catch (cause) {
      setError(errorText(cause));
      setFailureRevision((revision) => revision + 1);
      return false;
    }
  }
  async function cancelGeneration(): Promise<void> {
    const request = snapshot.activeRequest;
    if (!request || submitting.current) return;
    submitting.current = true;
    setPending(true);
    const previousView = currentView.current;
    try {
      await dispatch("cancel_generation", { request });
    } catch (cause) {
      if (
        currentView.current.identity === previousView.identity &&
        currentRequestEpoch.current === request.epoch
      ) {
        setError(errorText(cause));
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  async function retry(): Promise<void> {
    if (!canRetry || !latestUser || submitting.current || navigatingRef.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    const previousView = currentView.current;
    try {
      await flushDraft();
      if (
        currentView.current.identity !== previousView.identity ||
        currentView.current.recoveryId !== latestUser.id
      )
        return;
      await dispatch("retry_turn", { messageId: latestUser.id, target: latestUser.persona });
    } catch (cause) {
      if (
        currentView.current.identity === previousView.identity &&
        currentView.current.recoveryId === latestUser.id
      ) {
        setError(errorText(cause));
        setFailureRevision((revision) => revision + 1);
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  function editFailedInput(): void {
    if (!canRetry || !latestUser || latestInputContent === undefined || pending || navigating)
      return;
    if (draft.current.value && draft.current.value !== latestInputContent) {
      setDraftReplacement({
        identity: viewIdentity,
        messageId: latestUser.id,
        content: latestInputContent,
        previousDraft: draft.current.value,
      });
      return;
    }
    draft.current.value = latestInputContent;
    setInput(latestInputContent);
    inputRef.current?.focus();
  }
  function replaceDraft(): void {
    if (!draftReplacement) return;
    setDraftReplacement(null);
    if (
      !canRetry ||
      pending ||
      navigating ||
      currentView.current.identity !== draftReplacement.identity ||
      currentView.current.recoveryId !== draftReplacement.messageId ||
      draft.current.value !== draftReplacement.previousDraft
    )
      return;
    draft.current.value = draftReplacement.content;
    setInput(draftReplacement.content);
    window.requestAnimationFrame(() => {
      if (
        currentView.current.identity === draftReplacement.identity &&
        currentView.current.recoveryId === draftReplacement.messageId
      ) {
        inputRef.current?.focus();
      }
    });
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
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !event.isComposing &&
        !draftReplacement
      ) {
        event.preventDefault();
        void leave(closeCommand);
      }
    }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [closeCommand, dispatch, draftReplacement]);
  useEffect(() => {
    lastActivity.current = Date.now();
    if (
      mode !== "input" ||
      !sessionId ||
      input.length > 0 ||
      logOpen ||
      latestUserOpen ||
      moreOpen ||
      contextBusy ||
      saveRequest ||
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
        void leave("close_panel", { idle: true });
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [
    mode,
    sessionId,
    input,
    logOpen,
    latestUserOpen,
    moreOpen,
    contextBusy,
    saveRequest,
    responding,
    playing,
    pending,
  ]);
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
  const resumableWork = sessions
    .filter((session) => session.noteContext)
    .sort(
      (left, right) =>
        (right.noteContext?.linkedAt ?? 0) - (left.noteContext?.linkedAt ?? 0) ||
        right.updatedAt - left.updatedAt,
    )[0];
  const noteContext = conversation?.noteContext ?? conversation?.session.noteContext;
  async function resumeFromInput(): Promise<void> {
    const resumeSession = resumableWork ?? paused;
    if (resumeSession) {
      await leave("resume_chat", { sessionId: resumeSession.id });
      return;
    }
    const identity = currentView.current.identity;
    try {
      await flushDraft();
      if (currentView.current.identity === identity && !navigatingRef.current)
        setChoosingResumeNote(true);
    } catch (cause) {
      if (currentView.current.identity === identity) setError(errorText(cause));
    }
  }
  const recipientName = characterName(
    snapshot,
    target === "all" ? (conversation?.session.participants[0] ?? persona) : target,
  );
  const labels = {
    menu: "무엇을 할까?",
    input: target === "all" ? "함께 대화 중" : `${recipientName}와 대화`,
    history: "지난 대화",
    "history-input": "지난 대화",
    name: "처음 만났네",
    focus: "집중 중",
    update: "업데이트 알림",
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
      {canRetry && (
        <p role="status">
          {recovery?.reason === "cancelled"
            ? "생성을 멈췄어요."
            : "답변을 끝내지 못했어요. 보낸 내용은 남아 있어요."}
        </p>
      )}
      {visibleError && (
        <p ref={errorRef} className={s.error} role="alert">
          {visibleError}
        </p>
      )}
      <div className={s.row}>
        {canRetry && (
          <Button variant="secondary" disabled={pending || navigating} onClick={() => void retry()}>
            다시 이야기하기
          </Button>
        )}
        {canRetry && (
          <>
            <Button
              variant="quiet"
              size="compact"
              disabled={pending || navigating}
              onClick={editFailedInput}
            >
              입력 수정
            </Button>
            <Button
              variant="quiet"
              size="compact"
              disabled={pending || navigating}
              onClick={() => void openModelSettings()}
            >
              AI 연결 확인
            </Button>
          </>
        )}
        {responding && snapshot.activeRequest && (
          <Button
            variant="quiet"
            size="compact"
            disabled={pending}
            onClick={() => void cancelGeneration()}
          >
            생성 멈추기
          </Button>
        )}
      </div>
    </div>
  );
  const inputOptions = (
    <>
      <ConversationContext
        key={`${userId}:${sessionId ?? persona}`}
        sessionId={sessionId}
        persona={persona}
        context={noteContext}
        onBusyChange={setContextBusy}
        disabled={responding || playing || pending || navigating}
      />
      {latestUser && <OrganizerReceipt key={latestUser.id} inputId={latestUser.id} />}
      {surface !== "input" && conversation && (snapshot.playback || latestReply) && (
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
      {conversation && latestReply && !snapshot.playback && (
        <div className={s.notice}>
          <ConversationMessageActions
            message={latestReply}
            onSave={(kind) =>
              selectSave({
                sessionId: conversation.session.id,
                context: noteContext,
                message: latestReply,
                kind,
              })
            }
          />
        </div>
      )}
      {conversation && latestUser && (
        <details
          className={s.conversationDetails}
          open={latestUserOpen}
          onToggle={(event) => setLatestUserOpen(event.currentTarget.open)}
        >
          <summary className={s.conversationSummary}>최근에 한 말</summary>
          {latestUserOpen && (
            <>
              <p className={s.historyMessage}>{latestUser.content}</p>
              <ConversationMessageActions
                message={latestUser}
                onSave={(kind) =>
                  selectSave({
                    sessionId: conversation.session.id,
                    context: noteContext,
                    message: latestUser,
                    kind,
                  })
                }
              />
            </>
          )}
        </details>
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
              onSave={(message, kind) =>
                selectSave({
                  sessionId: conversation.session.id,
                  context: noteContext,
                  message,
                  kind,
                })
              }
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
              <option value={guestPersona ?? conversation?.session.participants[0] ?? persona}>
                {recipientName}
              </option>
              {(snapshot.characters.active.length > 1 || target === "all") && (
                <option value="all">모두에게</option>
              )}
            </Select>
          </label>
          <span className={ui.quiet}>Shift + Enter 줄바꿈</span>
        </div>
        {surface !== "input" && (
          <div className={s.inputCapsule}>
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
            <Button
              type="submit"
              className={s.capsuleSend}
              aria-label={pending ? "전송 중" : "보내기"}
              disabled={
                !snapshot.user || !input.trim() || responding || playing || pending || navigating
              }
            >
              <SendIcon size={18} />
            </Button>
          </div>
        )}
        {surface !== "input" && responding && (
          <div className={s.recipientRow}>
            <WaitingDots label="답변 준비 중" />
          </div>
        )}
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
    </>
  );
  if (updateNotice && snapshot.playback) {
    const playbackId = snapshot.playback.id;
    const expanded = mode === "update";
    return (
      <section ref={balloonRef} className={s.updateNoticeHost} aria-label="업데이트 알림">
        <NoticeBalloon
          aria-live="polite"
          speakerName={name}
          tail={skin && (!imageReady || slice) ? "none" : "left"}
          content={expanded ? "actions" : "text"}
          className={`${s.updateNoticeBalloon} ${skin && (!imageReady || slice) ? s.balloonSkinned : ""}`}
          style={skinned}
          speechTrigger={{
            "aria-label": fullText,
            "aria-expanded": expanded,
            "aria-controls": expanded ? updateActionsId : undefined,
            disabled: navigating,
            style: { ...textStyle, lineHeight: 1.65, wordBreak: "keep-all" },
            onClick: () => {
              if (!expanded) void leave("expand_update_notice", { playbackId });
            },
          }}
          actions={
            expanded && (
              <div id={updateActionsId} className={s.updateNoticeAction}>
                <CometButton
                  variant="link"
                  trailingIcon={<ArrowRightIcon size={14} />}
                  disabled={navigating}
                  onClick={() => void leave("open_update_settings", { playbackId })}
                >
                  이동하기
                </CometButton>
              </div>
            )
          }
        >
          {speech}
        </NoticeBalloon>
        <IconButton
          className={s.balloonClose}
          size="compact"
          variant="quiet"
          label="업데이트 알림 닫기"
          disabled={navigating}
          onClick={() => void leave(closeCommand)}
        >
          <CloseIcon size={14} />
        </IconButton>
        {visibleError && (
          <p className={s.error} role="alert">
            {visibleError}
          </p>
        )}
      </section>
    );
  }
  if (!mode && snapshot.story) {
    return (
      <section ref={balloonRef} className={storyStyle.host} aria-label="말풍선">
        <StoryChoices
          key={snapshot.story.id}
          story={snapshot.story}
          dispatch={dispatch}
          speakerName={name}
          speaker={character?.definition.sourceId === "builtin-b" ? "nadir" : "byulkkori"}
          textStyle={textStyle}
          skinned={Boolean(skin && (!imageReady || slice))}
          balloonClassName={skin && (!imageReady || slice) ? s.balloonSkinned : undefined}
          balloonStyle={skinned}
          onClose={() => void leave(closeCommand)}
        />
        {visibleError && (
          <p className={storyStyle.error} role="alert">
            {visibleError}
          </p>
        )}
      </section>
    );
  }
  return (
    <section
      ref={balloonRef}
      className={
        surface === "input"
          ? surfaceStyle.inputHost
          : `${s.balloon} ${mode ? s.balloonPanel : ""} ${orbitMenu ? s.balloonOrbit : ""} ${preview && !orbitMenu ? s.balloonPreview : ""} ${!orbitMenu && skin && (!imageReady || slice) ? s.balloonSkinned : ""}`
      }
      style={surface === "input" || orbitMenu ? undefined : skinned}
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
      {surface === "input" ? null : mode && mode !== "menu" ? (
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
          label={mode ? "패널 닫기" : "이야기 닫기"}
          onClick={() => {
            if (orbitMenu) setOrbitCloseRequest((request) => request + 1);
            else void leave(closeCommand);
          }}
        >
          <CloseIcon size={14} />
        </IconButton>
      )}
      {mode === "menu" && !saveRequest && (
        <>
          {!choosingResumeNote && (
            <CharacterOrbit
              key={contentKey}
              closeRequest={orbitCloseRequest}
              anchor={orbitAnchor ?? undefined}
              ready={ready && (!sizingNative || Boolean(orbitAnchor))}
              name={name}
              character={character}
              paused={snapshot.runtime.paused}
              pausedUntil={snapshot.runtime.pausedUntil}
              sleeping={Boolean(
                character && snapshot.animationStates?.sleepingCharacterIds?.includes(character.id),
              )}
              busy={navigating || sessionsLoading}
              onClose={() => leave(closeCommand)}
              onAction={(action) => {
                switch (action) {
                  case "chat":
                    return perform("open_panel", { persona, mode: "input" });
                  case "resume":
                    if (resumableWork)
                      return perform("resume_chat", { sessionId: resumableWork.id });
                    else if (paused) return perform("resume_chat", { sessionId: paused.id });
                    else setChoosingResumeNote(true);
                    return true;
                  case "together":
                    return perform("talk_now");
                  case "history":
                    return perform("open_panel", { persona, mode: "history" });
                  case "settings":
                    return perform("open_settings");
                  case "hide":
                    return perform("hide_boxes");
                  case "move":
                    return perform("arm_character_move", { persona });
                  case "snack":
                    return perform("give_character_snack", { persona });
                  case "drink":
                  case "gift":
                    if (character)
                      return perform("give_character_item", {
                        characterId: character.id,
                        action,
                        sessionId: crypto.randomUUID(),
                      });
                    return false;
                  case "sleep":
                    if (character)
                      return perform("set_character_sleep", {
                        characterId: character.id,
                        sleeping: !snapshot.animationStates?.sleepingCharacterIds?.includes(
                          character.id,
                        ),
                      });
                    return false;
                  case "pause":
                    return perform("set_paused", { paused: false });
                  case "pause-hour":
                    return perform("set_paused", { paused: true, minutes: 60 });
                  case "pause-restart":
                    return perform("set_paused", { paused: true });
                }
                return false;
              }}
            />
          )}
          {choosingResumeNote && (
            <div className={s.inputContents}>
              <ConversationContext
                key={`${userId}:${persona}`}
                persona={persona}
                initiallyChoosing
                onBusyChange={setContextBusy}
                onClose={() => setChoosingResumeNote(false)}
              />
            </div>
          )}
          {sessionsError && (
            <p className={s.error} role="alert">
              {sessionsError}
            </p>
          )}
        </>
      )}
      {mode === "name" && !snapshot.user && (
        <NameRegistration
          key={persona}
          greeting={character?.definition.greeting[0]?.text ?? "안녕! 만나서 반가워."}
          dispatch={dispatch}
        />
      )}
      {mode === "focus" && (
        <p className={s.notice} role="status">
          집중 시간 동안에는 대화를 사용할 수 없어요. 집중을 마친 뒤 다시 말 걸어 주세요.
        </p>
      )}
      {saveRequest && (
        <div className={s.inputContents}>
          <ConversationSave
            key={`${userId}:${saveRequest.sessionId}:${saveRequest.message.id}:${saveRequest.kind}`}
            snapshot={snapshot}
            request={saveRequest}
            onClose={() => selectSave(null)}
          />
        </div>
      )}
      {mode === "input" && !saveRequest && (
        <div
          className={surface === "input" ? surfaceStyle.inputContents : s.inputContents}
          role="region"
          aria-label="대화 내용과 입력"
          tabIndex={surface === "input" ? undefined : 0}
        >
          {surface === "input" && (
            <>
              <div className={surfaceStyle.inputActions}>
                <CometButton
                  variant="ghost"
                  className={`${surfaceStyle.inputAction} ${surfaceStyle.resumeAction}`}
                  leadingIcon={<Icon name="resume" size={15} />}
                  disabled={
                    navigating ||
                    pending ||
                    responding ||
                    playing ||
                    sessionsLoading ||
                    choosingResumeNote ||
                    Boolean(sessionsError)
                  }
                  onClick={() => void resumeFromInput()}
                >
                  이어서 하기
                </CometButton>
                <CometButton
                  variant="ghost"
                  className={`${surfaceStyle.inputAction} ${surfaceStyle.togetherAction}`}
                  leadingIcon={<Icon name="together" size={15} />}
                  disabled={navigating || pending || responding || playing || choosingResumeNote}
                  onClick={() => void leave("talk_now")}
                >
                  함께 이야기해 봐
                </CometButton>
                <CometButton
                  variant="ghost"
                  className={`${surfaceStyle.inputAction} ${surfaceStyle.historyAction}`}
                  leadingIcon={<Icon name="history" size={15} />}
                  disabled={navigating || choosingResumeNote}
                  onClick={() => void leave("open_panel", { persona, mode: "history" })}
                >
                  지난 대화
                </CometButton>
              </div>
              {choosingResumeNote ? (
                <div className={surfaceStyle.optionsPanel}>
                  <ConversationContext
                    key={`${userId}:${persona}:resume`}
                    persona={persona}
                    initiallyChoosing
                    onBusyChange={setContextBusy}
                    onClose={() => setChoosingResumeNote(false)}
                  />
                </div>
              ) : (
                <InputCapsule
                  className={surfaceStyle.inputCapsule}
                  form="large"
                  asTextarea
                  inputRef={inputRef}
                  value={input}
                  label={target === "all" ? "모두에게 할 말" : `${recipientName}에게 할 말`}
                  placeholder="하고 싶은 이야기를 적어 줘."
                  disabled={!snapshot.user || navigating}
                  sending={pending}
                  disableInputWhileSending={false}
                  sendDisabled={responding || playing}
                  onValueChange={(value) => {
                    draft.current.value = value;
                    setInput(value);
                  }}
                  onSend={() => void send()}
                  textareaProps={{
                    maxLength: 2000,
                    onCompositionStart: () => {
                      composing.current = true;
                    },
                    onCompositionEnd: () => {
                      composing.current = false;
                    },
                    onKeyDown: (event) => {
                      if (shouldSubmit(event, composing.current)) {
                        event.preventDefault();
                        void send();
                      }
                    },
                  }}
                />
              )}
              {sessionsError && (
                <p className={s.error} role="alert">
                  {sessionsError}
                </p>
              )}
            </>
          )}
          {surface === "input" && notice ? (
            <div className={surfaceStyle.optionsPanel}>{notice}</div>
          ) : (
            notice
          )}
          {surface === "input" ? (
            choosingResumeNote ? null : (
              <details
                className={surfaceStyle.more}
                open={moreOpen}
                onToggle={(event) => {
                  const open = event.currentTarget.open;
                  setMoreOpen(open);
                  if (!open) {
                    setLogOpen(false);
                    setLatestUserOpen(false);
                  }
                }}
              >
                <summary className={surfaceStyle.moreSummary}>더보기</summary>
                <div className={surfaceStyle.optionsPanel}>
                  <CometButton
                    variant="link"
                    aria-label="대화 접어 두기"
                    disabled={navigating}
                    onClick={() => void leave(closeCommand)}
                  >
                    접어 두기
                  </CometButton>
                  {inputOptions}
                </div>
              </details>
            )
          ) : (
            inputOptions
          )}
        </div>
      )}
      {mode === "history" && (
        <div style={{ display: saveRequest ? "none" : "contents" }}>
          <ConversationHistory
            key={`${snapshot.user?.id}:${persona}`}
            snapshot={snapshot}
            persona={persona}
            sessions={sessions}
            loading={sessionsLoading}
            error={sessionsError}
            previewConversations={previewConversations}
            onResume={(id) => void perform("resume_chat", { sessionId: id })}
            onSave={selectSave}
          />
          <div className={s.footer}>
            {snapshot.relationships.map((relationship) => (
              <span key={relationship.persona}>
                {characterName(snapshot, relationship.persona)} 친밀도 {relationship.score}/100
              </span>
            ))}
          </div>
        </div>
      )}
      {!mode && !snapshot.story && <span className={s.speakerName}>{name}</span>}
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
            <WaitingDots label="답변 준비 중" />
          ) : (
            ""
          )}
        </div>
      )}
      {!mode && !snapshot.story && snapshot.playback && (
        <span className={s.playbackOrigin}>{responseOrigin(snapshot.playback.source)}</span>
      )}
      {mode !== "input" && mode !== "focus" && notice}
      <Dialog
        isOpen={Boolean(draftReplacement && canRetry)}
        title="작성 중인 초안을 바꿀까요?"
        variant="confirm"
        closeLabel="초안 교체 닫기"
        onOpenChange={(open) => {
          if (!open) setDraftReplacement(null);
        }}
        footer={
          <>
            <Button variant="quiet" onClick={() => setDraftReplacement(null)}>
              계속 작성
            </Button>
            <Button variant="primary" onClick={replaceDraft}>
              초안 바꾸기
            </Button>
          </>
        }
      >
        <p>
          작성 중인 초안 대신 답변을 마치지 못한 입력을 가져와요. 이미 보낸 원문은 그대로 남아요.
        </p>
      </Dialog>
    </section>
  );
}
