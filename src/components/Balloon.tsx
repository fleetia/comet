import { useEffect, useRef, useState, type JSX, type KeyboardEvent } from "react";
import { Button, IconButton, Rule, Select, TextArea } from "@fleetia/lagrange";
import type { Dispatch, Persona, Snapshot } from "../types";
import { command, errorText, isDesktop } from "../hooks/useSnapshot";
import * as s from "./companion.css";
import * as ui from "../lagrange.css";
import {
  activeCharacter,
  BALLOON_SPRITE,
  characterName,
  spriteSource,
  spriteUrl,
} from "./characterIdentity";
import { skinStyle, useImageSlice } from "../hooks/useImageSlice";

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
  const persona: Persona =
    snapshot.panel?.persona ??
    snapshot.playback?.persona ??
    (snapshot.runtime.persona === "b" ? "b" : "a");
  const mode = snapshot.panel?.mode;
  const name = characterName(snapshot, persona);
  const character = activeCharacter(snapshot, persona);
  const speakerLabel =
    snapshot.playback && spriteSource(character, snapshot.playback.expression) ? "" : name;
  const skin = spriteUrl(character, BALLOON_SPRITE);
  const slice = useImageSlice(skin);
  const skinned = skin && slice ? skinStyle(skin, slice) : undefined;
  const transparent = Boolean(skinned) && !preview;
  useEffect(() => {
    if (!transparent) return;
    document.documentElement.classList.add(s.transparentDocument);
    return () => document.documentElement.classList.remove(s.transparentDocument);
  }, [transparent]);
  const [input, setInput] = useState("");
  const [target, setTarget] = useState<Persona | "both">(persona);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composing = useRef(false);
  const submitting = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const balloonRef = useRef<HTMLElement>(null);
  const responding = ["loading", "generating"].includes(snapshot.runtime.phase);
  const latestUser = snapshot.messages.filter((message) => message.role === "user").at(-1);
  const canRetry = (mode === "input" || !mode) && snapshot.runtime.phase === "error" && latestUser;
  const visibleError = error || (mode === "input" || !mode ? snapshot.runtime.error : null);
  useEffect(() => {
    setTarget(persona);
  }, [persona]);
  useEffect(() => {
    if (mode === "input") {
      inputRef.current?.focus();
    }
  }, [mode]);
  useEffect(() => {
    setError(null);
  }, [mode, persona]);
  useEffect(() => {
    const element = balloonRef.current;
    if (
      !element ||
      preview ||
      !isDesktop() ||
      new URLSearchParams(window.location.search).get("view") !== "balloon"
    ) {
      return;
    }
    const measuredElement = element;
    let active = true;
    let previousHeight = 0;
    let frame = 0;
    function measure(): void {
      const height = Math.min(
        520,
        Math.max(110, Math.ceil(measuredElement.getBoundingClientRect().height)),
      );
      if (height === previousHeight) {
        return;
      }
      previousHeight = height;
      void command("resize_balloon", { height }).catch((cause: unknown) => {
        if (active) {
          setError(errorText(cause));
        }
      });
    }
    function schedule(): void {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    }
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    schedule();
    return () => {
      active = false;
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [preview]);
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
    if (!input.trim() || submitting.current || responding) {
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
      className={`${s.balloon} ${preview ? s.balloonPreview : ""} ${skinned ? s.balloonSkinned : ""}`}
      style={skinned}
      aria-label={mode ? labels[mode] : "말풍선"}
    >
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
        <span>{mode ? labels[mode] : speakerLabel}</span>
        <IconButton
          size="compact"
          variant="quiet"
          label={snapshot.panel ? "패널 닫기" : "이야기 닫기"}
          onClick={() => void perform(closeCommand)}
        >
          ×
        </IconButton>
      </header>
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
                {snapshot.characters.active.length > 1 ? "둘이 이야기해 봐" : "혼잣말 들어 보기"}
              </Button>
              <Button
                variant="quiet"
                className={s.menuItem}
                onClick={() => void perform("open_panel", { persona, mode: "history" })}
              >
                지난 대화
              </Button>
            </div>
            <Rule variant="weak" />
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
            <Rule variant="weak" />
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
          <div className={s.row}>
            <label className={ui.quiet}>
              받는 친구{" "}
              <Select
                className={s.recipient}
                value={target}
                onChange={(event) => setTarget(event.target.value as Persona | "both")}
              >
                <option value={persona}>{name}</option>
                {snapshot.characters.active.length > 1 && <option value="both">모두에게</option>}
              </Select>
            </label>
            <span className={ui.quiet}>Shift + Enter 줄바꿈</span>
          </div>
          <TextArea
            resize="none"
            ref={inputRef}
            className={s.input}
            aria-label={`${name}에게 할 말`}
            value={input}
            rows={3}
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
            <Button type="submit" disabled={!input.trim() || responding || pending}>
              {pending ? "전송 중" : "보내기"}
            </Button>
          </div>
        </form>
      )}
      {mode === "history" && (
        <>
          <div className={s.history}>
            {snapshot.messages.length === 0 ? (
              <p className={ui.quiet}>아직 나눈 이야기가 없어요.</p>
            ) : (
              [...snapshot.messages]
                .sort((left, right) => left.createdAt - right.createdAt)
                .map((message) => (
                  <p className={s.historyMessage} key={message.id}>
                    <span className={s.historyName}>
                      {message.role === "user"
                        ? "나"
                        : (snapshot.messageIdentities.find(
                            (identity) => identity.messageId === message.id,
                          )?.name ??
                          message.persona?.toUpperCase() ??
                          "친구")}
                    </span>
                    {message.content}
                  </p>
                ))
            )}
          </div>
          <div className={s.footer}>
            {snapshot.relationships.map((relationship) => (
              <span key={relationship.persona}>
                {relationship.persona === "a" || relationship.persona === "b"
                  ? characterName(snapshot, relationship.persona)
                  : relationship.persona}{" "}
                친밀도 {relationship.score}/100
              </span>
            ))}
          </div>
        </>
      )}
      {!mode && (
        <div className={s.speech} aria-live="polite">
          {snapshot.playback?.text ?? (responding ? <WaitingDots /> : "")}
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
