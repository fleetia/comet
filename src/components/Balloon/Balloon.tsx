import { useEffect, useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { Button, IconButton, Select, TextArea } from "@fleetia/lagrange";
import type { Dispatch, Persona, Snapshot } from "../../types";
import { command, errorText } from "../../hooks/useSnapshot";
import { useBalloonSizing } from "../../hooks/useBalloonSizing";
import { useTypewriter } from "../../hooks/useTypewriter";
import * as s from "../companion.css";
import * as ui from "../../lagrange.css";
import { CharacterHistory } from "../CharacterHistory/CharacterHistory";
import { StoryChoices } from "../StoryChoices/StoryChoices";
import { activeCharacter, BALLOON_SPRITE, characterName, spriteUrl } from "../characterIdentity";
import { skinStyle, useImageSlice } from "../../hooks/useImageSlice";
import { balloonTextStyle } from "../balloonTypography";

type Props = { snapshot: Snapshot; preview?: boolean; dispatch?: Dispatch };

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
export function Balloon({ snapshot, preview = false, dispatch = command }: Props): JSX.Element {
  const speaker: Persona =
    snapshot.panel?.persona ??
    snapshot.story?.persona ??
    snapshot.playback?.persona ??
    snapshot.runtime.persona ??
    snapshot.characters.active[0] ??
    "a";
  const persona = activeCharacter(snapshot, speaker)?.id ?? speaker;
  const mode = snapshot.panel?.mode;
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
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<Persona | "all">(persona);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composing = useRef(false);
  const submitting = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const responding = ["loading", "generating"].includes(snapshot.runtime.phase);
  const latestUser = snapshot.messages.filter((message) => message.role === "user").at(-1);
  const canRetry =
    snapshot.user &&
    (mode === "input" || !mode) &&
    snapshot.runtime.phase === "error" &&
    latestUser;
  const visibleError = error || (mode === "input" || !mode ? snapshot.runtime.error : null);
  useEffect(() => {
    setTarget(persona);
  }, [persona]);
  useEffect(() => {
    setInput("");
    setError(null);
  }, [snapshot.user?.id]);
  useEffect(() => {
    if (mode === "input") {
      inputRef.current?.focus();
    }
  }, [mode]);
  useEffect(() => {
    setError(null);
  }, [mode, persona]);
  const contentKey = snapshot.panel
    ? `panel:${snapshot.panel.persona}:${snapshot.panel.mode}`
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
    ready && !mode && !snapshot.story,
  );
  const revealing = revealedText !== fullText;
  async function perform(name: string, args?: Record<string, unknown>): Promise<void> {
    setError(null);
    try {
      await dispatch(name, args);
    } catch (cause) {
      setError(errorText(cause));
    }
  }
  const closeCommand = snapshot.panel ? "close_panel" : "skip_talk";
  useEffect(() => {
    function close(event: globalThis.KeyboardEvent): void {
      if (event.key === "Escape" && !event.isComposing) {
        event.preventDefault();
        void dispatch(closeCommand).catch((cause: unknown) => setError(errorText(cause)));
      }
    }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [closeCommand, dispatch]);
  async function send(): Promise<void> {
    if (!snapshot.user || !input.trim() || submitting.current || responding) {
      return;
    }
    submitting.current = true;
    setPending(true);
    setError(null);
    try {
      await dispatch("send_message", {
        content: input.trim(),
        target,
        clientMessageId: crypto.randomUUID(),
      });
      setInput("");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  const labels = { menu: "무엇을 할까?", input: "말 걸기", history: "지난 대화" };
  return (
    <section
      ref={balloonRef}
      className={`${s.balloon} ${mode ? s.balloonPanel : ""} ${preview ? s.balloonPreview : ""} ${skin && (!imageReady || slice) ? s.balloonSkinned : ""}`}
      style={skinned}
      aria-label={mode ? labels[mode] : "말풍선"}
    >
      {mode ? (
        <header className={s.balloonHeader}>
          {(mode === "input" || mode === "history") && (
            <Button
              variant="quiet"
              size="compact"
              onClick={() => void perform("open_panel", { persona, mode: "menu" })}
            >
              메뉴로
            </Button>
          )}
          <span>{labels[mode]}</span>
          <IconButton
            size="compact"
            variant="quiet"
            label={snapshot.panel ? "패널 닫기" : "이야기 닫기"}
            onClick={() => void perform(closeCommand)}
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
          onClick={() => void perform(closeCommand)}
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
                onClick={() => void perform("open_characters")}
              >
                캐릭터 관리
              </Button>
              <Button
                variant="quiet"
                className={s.menuItem}
                onClick={() => void perform("open_widgets")}
              >
                위젯 관리
              </Button>
              <Button
                variant="quiet"
                className={s.menuItem}
                onClick={() => void perform("open_settings")}
              >
                설정
              </Button>
            </div>
            <div className={s.menuGroup} role="group" aria-label="자동 잡담과 표시">
              <Button
                variant="quiet"
                className={s.menuItem}
                onClick={() => void perform("set_paused", { paused: !snapshot.runtime.paused })}
              >
                {snapshot.runtime.paused ? "자동 잡담 다시 시작" : "자동 잡담 잠시 쉬기"}
              </Button>
              <Button
                variant="quiet"
                className={s.menuItem}
                onClick={() => void perform("hide_boxes")}
              >
                숨기기
              </Button>
            </div>
          </nav>
          <div className={s.footer}>
            <span>
              {name}와 친밀도{" "}
              {snapshot.relationships.find((relationship) => relationship.persona === persona)
                ?.score ?? 20}
              /100
            </span>
            {snapshot.runtime.paused && <span>자동 잡담 쉬는 중</span>}
          </div>
        </>
      )}
      {mode === "input" && (
        <form
          className={s.form}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          {!snapshot.user && (
            <div className={s.row}>
              <span className={ui.quiet}>함께 이야기하기 전에 이름을 알려 주세요.</span>
              <Button
                variant="secondary"
                onClick={() => {
                  void dispatch("set_settings_section", { section: "user" })
                    .then(() => dispatch("open_settings"))
                    .catch((cause: unknown) => setError(errorText(cause)));
                }}
              >
                이름 설정
              </Button>
            </div>
          )}
          <div className={s.row}>
            <label className={ui.quiet}>
              받는 친구{" "}
              <Select
                className={s.recipient}
                value={target}
                onChange={(event) => setTarget(event.target.value as Persona | "all")}
              >
                <option value={persona}>{name}</option>
                {snapshot.characters.active.length > 1 && <option value="all">모두에게</option>}
              </Select>
            </label>
            <span className={ui.quiet}>Shift + Enter 줄바꿈</span>
          </div>
          <TextArea
            resize="none"
            ref={inputRef}
            className={s.input}
            aria-label={target === "all" ? "모두에게 할 말" : `${name}에게 할 말`}
            value={input}
            rows={3}
            disabled={!snapshot.user}
            maxLength={2000}
            placeholder="하고 싶은 이야기를 적어 줘."
            onChange={(event) => setInput(event.target.value)}
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
              disabled={!snapshot.user || !input.trim() || responding || pending}
            >
              {pending ? "전송 중" : "보내기"}
            </Button>
          </div>
        </form>
      )}
      {mode === "history" && (
        <>
          <CharacterHistory key={persona} snapshot={snapshot} characterId={persona} />
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
            <span className={s.speechText}>
              <span style={{ visibility: revealing ? "hidden" : undefined }}>{fullText}</span>
              {revealing && (
                <span className={s.speechReveal} aria-hidden="true">
                  {revealedText}
                </span>
              )}
            </span>
          ) : responding ? (
            <WaitingDots />
          ) : (
            ""
          )}
        </div>
      )}
      {(visibleError || canRetry || responding) && (
        <div className={s.notice}>
          {visibleError && (
            <p className={s.error} role="alert">
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
              <Button
                variant="quiet"
                size="compact"
                onClick={() => void perform("cancel_generation")}
              >
                생성 멈추기
              </Button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
