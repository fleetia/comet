import { useId, useLayoutEffect, useState, type CSSProperties, type JSX } from "react";
import { Balloon, WaitingDots } from "@comet/ui";
import type { Snapshot } from "../../types";
import { useBalloonSizing } from "../../hooks/useBalloonSizing";
import { skinStyle, useImageSlice } from "../../hooks/useImageSlice";
import { useTypewriter } from "../../hooks/useTypewriter";
import { activeCharacter, BALLOON_SPRITE, characterName, spriteUrl } from "../characterIdentity";
import { balloonTextStyle } from "../balloonTypography";
import { responseOrigin } from "./conversationStatus";
import * as companion from "../companion.css";
import * as styles from "./conversationSurface.css";

type Props = { snapshot: Snapshot; preview?: boolean };

export function ConversationResponse({ snapshot, preview = false }: Props): JSX.Element | null {
  const conversation = snapshot.conversation;
  const latestReply = conversation?.messages
    .filter((message) => message.role === "assistant")
    .at(-1);
  const latestUser = conversation?.messages.filter((message) => message.role === "user").at(-1);
  const previousReply = Boolean(
    conversation &&
    latestReply &&
    latestUser &&
    (conversation.recovery || snapshot.runtime.phase === "error") &&
    conversation.messages.indexOf(latestReply) < conversation.messages.indexOf(latestUser),
  );
  const responding = ["loading", "generating"].includes(snapshot.runtime.phase);
  const persona =
    snapshot.playback?.persona ??
    (responding ? (snapshot.runtime.persona ?? snapshot.panel?.persona) : undefined) ??
    latestReply?.persona ??
    snapshot.panel?.persona ??
    "builtin-a";
  const character = activeCharacter(snapshot, persona);
  const textStyle = balloonTextStyle(character?.definition.balloonStyle);
  const sourceId = useId();
  const skin = spriteUrl(character, BALLOON_SPRITE);
  const { slice, ready: imageReady } = useImageSlice(skin);
  const skinned = skin && slice ? skinStyle(skin, slice) : undefined;
  const [error, setError] = useState<string | null>(null);
  const mode = snapshot.panel?.mode;
  const active = mode === "input" || mode === "history-input";
  const contentKey = snapshot.panel
    ? `panel:${snapshot.panel.persona}:${snapshot.panel.mode}${snapshot.playback ? `:playback:${snapshot.playback.id}` : ""}`
    : "conversation:closed";
  const { elementRef, ready, conversationTailX } = useBalloonSizing(
    preview,
    contentKey,
    imageReady,
    `${textStyle.fontSize}:${textStyle.fontFamily ?? ""}`,
    setError,
    undefined,
    snapshot.panel?.persona,
  );
  const fullText = snapshot.playback?.text ?? latestReply?.content ?? "";
  const revealedText = useTypewriter(
    snapshot.playback?.id ?? latestReply?.id ?? "",
    fullText,
    snapshot.playback?.textSpeed ?? 0,
    ready && active,
  );
  const revealing = revealedText !== fullText;
  const waiting = responding && !snapshot.playback;
  const name =
    !snapshot.playback && !waiting && latestReply
      ? (conversation?.characterNames?.[latestReply.id] ?? characterName(snapshot, persona))
      : characterName(snapshot, persona);
  const source =
    snapshot.playback?.source ??
    (latestReply ? conversation?.messageSources?.[latestReply.id] : undefined);
  useLayoutEffect(() => {
    if (preview) return;
    document.documentElement.classList.add(companion.transparentDocument);
    return () => document.documentElement.classList.remove(companion.transparentDocument);
  }, [preview]);
  if (!active) return null;
  return (
    <section
      ref={elementRef}
      className={styles.responseHost}
      aria-label="캐릭터 대답"
      style={
        conversationTailX == null
          ? undefined
          : ({
              "--comet-response-tail-x": `${conversationTailX}px`,
            } as CSSProperties)
      }
    >
      <Balloon
        speaker={character?.definition.sourceId === "builtin-b" ? "nadir" : "byulkkori"}
        speakerName={!snapshot.playback && !waiting && previousReply ? `이전 답변 · ${name}` : name}
        tail={skin && (!imageReady || slice) ? "none" : "left"}
        tailClassName={styles.responseTail}
        className={`${styles.responseBubble} ${skin && (!imageReady || slice) ? companion.balloonSkinned : ""}`}
        style={skinned}
        aria-live="polite"
        aria-describedby={!waiting && fullText ? sourceId : undefined}
        title={!waiting && fullText ? responseOrigin(source) : undefined}
      >
        <div
          className={styles.responseText}
          style={textStyle}
          aria-label={waiting ? undefined : fullText}
        >
          {waiting ? (
            <WaitingDots label="답변 준비 중" />
          ) : (
            <span className={companion.speechText}>
              <span style={{ visibility: revealing ? "hidden" : undefined }}>{fullText}</span>
              {revealing && (
                <span className={companion.speechReveal} aria-hidden="true">
                  {revealedText}
                </span>
              )}
            </span>
          )}
        </div>
        {!waiting && fullText && (
          <span id={sourceId} className={styles.responseSource}>
            {responseOrigin(source)}
          </span>
        )}
      </Balloon>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
