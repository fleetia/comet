import type { JSX } from "react";
import * as s from "../companion.css";

/** Keeps the full line laid out while the typewriter reveals it on top. */
export function SpeechText({
  fullText,
  revealedText,
}: {
  fullText: string;
  revealedText: string;
}): JSX.Element {
  const revealing = revealedText !== fullText;
  return (
    <span className={s.speechText}>
      <span style={{ visibility: revealing ? "hidden" : undefined }}>{fullText}</span>
      {revealing && (
        <span className={s.speechReveal} aria-hidden="true">
          {revealedText}
        </span>
      )}
    </span>
  );
}
