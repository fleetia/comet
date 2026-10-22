import { useEffect, useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { Button, IconButton, InputCapsule } from "@comet/ui";
import type { ConversationView, Dispatch, Message, Persona, Snapshot } from "../../types";
import { command } from "../../hooks/useSnapshot";
import { useBalloonSizing } from "../../hooks/useBalloonSizing";
import { useTypewriter } from "../../hooks/useTypewriter";
import * as s from "../companion.css";
import * as surfaceStyle from "./conversationSurface.css";
import { CharacterOrbit } from "./CharacterOrbit";
import { NameRegistration } from "./NameRegistration";
import { StoryChoices } from "../StoryChoices/StoryChoices";
import * as storyStyle from "../StoryChoices/story.css";
import { activeCharacter, BALLOON_SPRITE, characterName, spriteUrl } from "../characterIdentity";
import { skinStyle, useImageSlice } from "../../hooks/useImageSlice";
import { balloonTextStyle } from "../balloonTypography";
import { aiAvailability } from "./conversationStatus";
import { OrganizerReceipt } from "./OrganizerReceipt";
import { useConversationSessions } from "./useConversationSessions";
import { useBalloonNavigation, useEscapeClose } from "./useBalloonNavigation";
import { useConversationSubmission, useDraftReplacement } from "./useConversationSubmission";
import { useIdleClose } from "./useIdleClose";
import { UpdateNoticeBalloon } from "./UpdateNoticeBalloon";
import { InputSurfaceActions } from "./InputSurfaceActions";
import { BalloonHeader } from "./BalloonHeader";
import { HistoryPanel } from "./HistoryPanel";
import { IdleSpeech } from "./IdleSpeech";
import { runOrbitAction } from "./orbitActions";
import { ConversationReply } from "./ConversationReply";
import { ConversationDisclosures } from "./ConversationDisclosures";
import { ConversationForm, type EditorKeyHandlers } from "./ConversationForm";
import { SpeechText } from "./SpeechText";
import { ConversationNotice } from "./ConversationNotice";
import { DraftReplacementDialog } from "./DraftReplacementDialog";
import {
  useDraftAutosave,
  useDraftPersistence,
  type BalloonView,
  type ConversationDraft,
} from "./useConversationDraft";
import { ConversationSave, type ConversationSaveRequest } from "./ConversationSave";

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
  const conversation = snapshot.conversation;
  const sessionId = conversation?.session.id;
  const userId = snapshot.user?.id;
  const viewIdentity = `${snapshot.user?.id ?? ""}:${mode === "input" && sessionId ? `conversation:${sessionId}` : snapshot.panel ? `${mode}:${snapshot.panel.persona}${mode === "update" ? `:${snapshot.playback?.id ?? ""}` : ""}` : (snapshot.playback?.id ?? "")}`;
  const currentView = useRef<BalloonView>({
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
  // Keep the skinned frame while its image loads so the balloon does not flash a default tail.
  const skinFramed = Boolean(skin && (!imageReady || slice));
  const transparent = !preview;
  useLayoutEffect(() => {
    if (!transparent) return;
    document.documentElement.classList.add(s.transparentDocument);
    return () => document.documentElement.classList.remove(s.transparentDocument);
  }, [transparent]);
  const draft = useRef<ConversationDraft>({
    userId: conversation?.session.userId ?? userId,
    sessionId,
    value: conversation?.session.draft ?? "",
    saved: conversation?.session.draft ?? "",
  });
  const [input, setInput] = useState(draft.current.value);
  const { saveTimer, persistDraft, flushDraft } = useDraftPersistence({
    draft,
    currentView,
    dispatch,
  });
  const [target, setTarget] = useState<Persona | "all">(persona);
  const [orbitCloseRequest, setOrbitCloseRequest] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const { navigating, navigatingRef, leave, openModelSettings } = useBalloonNavigation({
    currentView,
    flushDraft,
    dispatch,
    setError,
  });
  useEffect(() => {
    if (updateNotice) setError(null);
  }, [updateNotice, snapshot.playback?.id]);
  const [logOpen, setLogOpen] = useState(false);
  const [latestUserOpen, setLatestUserOpen] = useState(false);
  const [saveSelection, setSaveSelection] = useState<{
    identity: string;
    request: ConversationSaveRequest;
  } | null>(null);
  const saveRequest = saveSelection?.identity === viewIdentity ? saveSelection.request : null;
  function selectSave(request: ConversationSaveRequest | null): void {
    setSaveSelection(request ? { identity: viewIdentity, request } : null);
  }
  const composing = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const responding = ["loading", "generating"].includes(snapshot.runtime.phase);
  const playing = Boolean(conversation && snapshot.playback);
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
  const {
    pending,
    failedSubmission,
    failureRevision,
    lastSubmission,
    forgetSubmission,
    clearFailedSubmission,
    perform,
    send,
    retry,
    cancelGeneration,
  } = useConversationSubmission({
    user: snapshot.user,
    activeRequest: snapshot.activeRequest,
    input,
    setInput,
    target,
    draft,
    currentView,
    dispatch,
    flushDraft,
    persistDraft,
    navigatingRef,
    setError,
    responding,
    playing,
    canRetry,
    latestUser,
  });
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
  const { draftReplacement, dismissDraftReplacement, editFailedInput, replaceDraft } =
    useDraftReplacement({
      viewIdentity,
      latestUser,
      latestInputContent,
      responding,
      playing,
      canRetry,
      pending,
      navigating,
      draft,
      currentView,
      setInput,
      inputRef,
    });
  useEffect(() => {
    setSaveSelection(null);
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
    forgetSubmission();
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
    forgetSubmission();
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
  }, [mode]);
  useEffect(() => {
    setError(null);
    clearFailedSubmission();
  }, [mode, persona]);
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
  const orbitMenu = mode === "menu" && !saveRequest;
  const sleeping = Boolean(
    character && snapshot.animationStates?.sleepingCharacterIds?.includes(character.id),
  );
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
  useDraftAutosave({
    draft,
    input,
    mode,
    sessionId,
    userId,
    currentView,
    saveTimer,
    persistDraft,
    setError,
  });
  const closeCommand = snapshot.panel ? "close_panel" : "skip_talk";
  useEscapeClose({ closeCommand, dispatch, draftReplacement, leave });
  const markActivity = useIdleClose({
    mode,
    sessionId,
    input,
    logOpen,
    latestUserOpen,
    saveRequest,
    responding,
    playing,
    pending,
    composing,
    draft,
    currentView,
    leave,
  });
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
  async function resumeFromInput(): Promise<void> {
    if (paused) await leave("resume_chat", { sessionId: paused.id });
    else await leave("open_panel", { persona, mode: "history" });
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
  const inputLabel = target === "all" ? "모두에게 할 말" : `${recipientName}에게 할 말`;
  function changeInput(value: string): void {
    draft.current.value = value;
    setInput(value);
  }
  const editorKeys: EditorKeyHandlers = {
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
  };
  function saveMessage(message: Message, kind: ConversationSaveRequest["kind"]): void {
    if (!conversation) return;
    selectSave({ sessionId: conversation.session.id, message, kind });
  }
  const speech = <SpeechText fullText={fullText} revealedText={revealedText} />;
  const notice = (visibleError || canRetry || responding) && (
    <ConversationNotice
      failedContent={failedContent}
      hasCurrentReply={hasCurrentReply}
      canRetry={canRetry}
      recoveryReason={recovery?.reason}
      visibleError={visibleError}
      errorRef={errorRef}
      pending={pending}
      navigating={navigating}
      canCancel={Boolean(responding && snapshot.activeRequest)}
      onRetry={() => void retry()}
      onEditInput={editFailedInput}
      onOpenModelSettings={() => void openModelSettings()}
      onCancel={() => void cancelGeneration()}
    />
  );
  const inputOptions = (
    <>
      {latestUser && <OrganizerReceipt key={latestUser.id} inputId={latestUser.id} />}
      {conversation && (
        <ConversationReply
          snapshot={snapshot}
          conversation={conversation}
          persona={persona}
          showSpeech={surface !== "input"}
          textStyle={textStyle}
          fullText={fullText}
          speech={speech}
          latestReply={latestReply}
          previousReply={previousReply}
          onSave={saveMessage}
        />
      )}
      {conversation && (
        <ConversationDisclosures
          snapshot={snapshot}
          conversation={conversation}
          latestUser={latestUser}
          latestUserOpen={latestUserOpen}
          onLatestUserOpenChange={setLatestUserOpen}
          logOpen={logOpen}
          onLogOpenChange={setLogOpen}
          onSave={saveMessage}
        />
      )}
      <ConversationForm
        availability={availability}
        navigating={navigating}
        onOpenModelSettings={() => void openModelSettings()}
        target={target}
        onTargetChange={setTarget}
        recipientLocked={Boolean(conversation && latestUser)}
        recipient={guestPersona ?? conversation?.session.participants[0] ?? persona}
        recipientName={recipientName}
        offerAll={snapshot.characters.active.length > 1 || target === "all"}
        showEditor={surface !== "input"}
        inputRef={inputRef}
        input={input}
        inputLabel={inputLabel}
        inputDisabled={!snapshot.user || navigating}
        onInputChange={changeInput}
        editorKeys={editorKeys}
        pending={pending}
        sendDisabled={
          !snapshot.user || !input.trim() || responding || playing || pending || navigating
        }
        responding={responding}
        onSubmit={() => void send()}
        onFinish={conversation ? () => void leave("finish_conversation", { sessionId }) : undefined}
      />
    </>
  );
  if (updateNotice && snapshot.playback) {
    const playbackId = snapshot.playback.id;
    const expanded = mode === "update";
    return (
      <UpdateNoticeBalloon
        hostRef={balloonRef}
        speakerName={name}
        skinFramed={skinFramed}
        skinned={skinned}
        textStyle={textStyle}
        fullText={fullText}
        expanded={expanded}
        navigating={navigating}
        visibleError={visibleError}
        onExpand={() => void leave("expand_update_notice", { playbackId })}
        onOpenSettings={() => void leave("open_update_settings", { playbackId })}
        onClose={() => void leave(closeCommand)}
      >
        {speech}
      </UpdateNoticeBalloon>
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
          skinned={skinFramed}
          balloonClassName={skinFramed ? s.balloonSkinned : undefined}
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
          : `${s.balloon} ${mode ? s.balloonPanel : ""} ${orbitMenu ? s.balloonOrbit : ""} ${preview && !orbitMenu ? s.balloonPreview : ""} ${!orbitMenu && skinFramed ? s.balloonSkinned : ""}`
      }
      style={surface === "input" || orbitMenu ? undefined : skinned}
      aria-label={mode ? labels[mode] : "말풍선"}
      onPointerMove={markActivity}
      onPointerDownCapture={markActivity}
      onKeyDownCapture={markActivity}
      onFocusCapture={markActivity}
      onWheel={markActivity}
    >
      {surface === "input" ? null : mode && mode !== "menu" ? (
        <BalloonHeader
          label={labels[mode]}
          showMenu={mode === "input" || mode === "history"}
          closeLabel={mode === "input" && conversation ? "대화 접어 두기" : "패널 닫기"}
          navigating={navigating}
          onMenu={() => void leave("open_panel", { persona, mode: "menu" })}
          onClose={() => void leave(closeCommand)}
        />
      ) : (
        <IconButton
          className={s.balloonClose}
          size="compact"
          icon="close"
          aria-label={mode ? "패널 닫기" : "이야기 닫기"}
          onClick={() => {
            if (orbitMenu) setOrbitCloseRequest((request) => request + 1);
            else void leave(closeCommand);
          }}
        />
      )}
      {mode === "menu" && !saveRequest && (
        <>
          <CharacterOrbit
              key={contentKey}
              closeRequest={orbitCloseRequest}
              anchor={orbitAnchor ?? undefined}
              ready={ready && (!sizingNative || Boolean(orbitAnchor))}
              name={name}
              character={character}
              paused={snapshot.runtime.paused}
              pausedUntil={snapshot.runtime.pausedUntil}
              sleeping={sleeping}
              busy={navigating || sessionsLoading}
              onClose={() => leave(closeCommand)}
              onAction={(action) =>
                runOrbitAction(action, {
                  persona,
                  character,
                  sleeping,
                  paused,
                  perform,
                })
              }
            />
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
              <InputSurfaceActions
                resumeDisabled={
                  navigating ||
                  pending ||
                  responding ||
                  playing ||
                  sessionsLoading ||
                  Boolean(sessionsError)
                }
                togetherDisabled={navigating || pending || responding || playing}
                historyDisabled={navigating}
                onResume={() => void resumeFromInput()}
                onTogether={() => void leave("talk_now")}
                onHistory={() => void leave("open_panel", { persona, mode: "history" })}
              />
              <InputCapsule
                  className={surfaceStyle.inputCapsule}
                  form="large"
                  asTextarea
                  inputRef={inputRef}
                  value={input}
                  label={inputLabel}
                  placeholder="하고 싶은 이야기를 적어 줘."
                  disabled={!snapshot.user || navigating}
                  sending={pending}
                  disableInputWhileSending={false}
                  sendDisabled={responding || playing}
                  onValueChange={changeInput}
                  onSend={() => void send()}
                  textareaProps={{ maxLength: 2000, ...editorKeys }}
                />
              {sessionsError && (
                <p className={s.error} role="alert">
                  {sessionsError}
                </p>
              )}
            </>
          )}
          {surface === "input"
            ? visibleError && (
                <div className={surfaceStyle.inputError}>
                  <p ref={errorRef} className={surfaceStyle.inputErrorMessage} role="alert">
                    {visibleError}
                  </p>
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={pending || navigating}
                    onClick={() => void openModelSettings()}
                  >
                    AI 연결 열기
                  </Button>
                </div>
              )
            : notice}
          {surface !== "input" && inputOptions}
        </div>
      )}
      {mode === "history" && (
        <HistoryPanel
          snapshot={snapshot}
          persona={persona}
          sessions={sessions}
          loading={sessionsLoading}
          error={sessionsError}
          previewConversations={previewConversations}
          hidden={Boolean(saveRequest)}
          onResume={(id) => void perform("resume_chat", { sessionId: id })}
          onSave={selectSave}
        />
      )}
      {!mode && !snapshot.story && (
        <IdleSpeech
          name={name}
          textStyle={textStyle}
          fullText={fullText}
          playback={snapshot.playback}
          responding={responding}
          speech={speech}
          onReply={(playbackId) => void perform("open_reply", { playbackId })}
        />
      )}
      {mode !== "input" && mode !== "focus" && notice}
      <DraftReplacementDialog
        open={Boolean(draftReplacement && canRetry)}
        onDismiss={dismissDraftReplacement}
        onReplace={replaceDraft}
      />
    </section>
  );
}
