import type { CSSProperties, JSX, ReactNode } from "react";
import { WaitingDots } from "@comet/ui";
import type { Playback } from "../../types";
import * as s from "../companion.css";
import { responseOrigin } from "./conversationStatus";

/** A spoken line outside a panel; clicking it opens a reply to that exact line. */
export function IdleSpeech({
  name,
  textStyle,
  fullText,
  playback,
  responding,
  speech,
  onReply,
}: {
  name: string;
  textStyle: CSSProperties;
  fullText: string;
  playback: Playback | null | undefined;
  responding: boolean;
  speech: ReactNode;
  onReply: (playbackId: string) => void;
}): JSX.Element {
  return (
    <>
      <span className={s.speakerName}>{name}</span>
      <div
        className={s.speech}
        style={textStyle}
        aria-live="polite"
        aria-label={fullText || undefined}
      >
        {playback ? (
          <button
            className={s.replySpeech}
            aria-label={`${name}에게 답장: ${fullText}`}
            title="클릭해서 답장"
            onClick={() => onReply(playback.id)}
          >
            {speech}
          </button>
        ) : responding ? (
          <WaitingDots label="답변 준비 중" />
        ) : (
          ""
        )}
      </div>
      {playback && <span className={s.playbackOrigin}>{responseOrigin(playback.source)}</span>}
    </>
  );
}
