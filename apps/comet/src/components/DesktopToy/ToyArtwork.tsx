import type { ReactElement } from "react";
import paperPlane from "./assets/paper-plane.svg";
import * as s from "./desktopToy.css";

const bubbles = [
  { borderColor: "rgba(201,184,245,0.85)", background: "rgba(201,184,245,0.12)" },
  { borderColor: "rgba(143,227,214,0.85)", background: "rgba(143,227,214,0.1)" },
  { borderColor: "rgba(201,184,245,0.7)", background: "transparent" },
] as const;

export function ToyArtwork({
  kind,
  bubbleSize = 38,
  bubbleColor = 0,
}: {
  kind: "ball" | "paper-plane" | "bubbles" | "pet";
  bubbleSize?: number;
  bubbleColor?: number;
}): ReactElement {
  switch (kind) {
    case "paper-plane":
      return <img src={paperPlane} alt="" aria-hidden="true" />;
    case "ball":
      return <span className={s.ball} aria-hidden="true" />;
    case "bubbles": {
      const size = Number.isFinite(bubbleSize) ? Math.max(12, Math.min(50, bubbleSize)) : 38;
      return (
        <span
          className={s.bubble}
          aria-hidden="true"
          style={{ ...(bubbles[bubbleColor % 3] ?? bubbles[0]), width: size, height: size }}
        />
      );
    }
    case "pet":
      return (
        <span className={s.pet} aria-hidden="true">
          🐌
        </span>
      );
  }
}
