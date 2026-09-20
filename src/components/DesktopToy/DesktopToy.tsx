import { useEffect, useRef, useState, type JSX, type PointerEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { command, errorText } from "../../hooks/useSnapshot";
import { transparentDocument } from "../companion.css";
import * as s from "./desktopToy.css";

type Frame = {
  id: string;
  kind: "ball" | "paper-plane" | "bubbles" | "pet";
  angle: number;
  dragging: boolean;
  moving: boolean;
  externalWindowsAvailable: boolean;
  bubbleSize?: number;
  bubbleColor?: number;
};
const names = { ball: "공", "paper-plane": "종이비행기", bubbles: "비눗방울", pet: "작은 펫" };
const bubblePalette = [
  {
    borderColor: "#67a8c7",
    background: "radial-gradient(circle at 28% 25%, #ffffffdd 0 8%, #bdefff45 15% 65%, #b9a0ef88 90%)",
    boxShadow: "inset -2px -2px 4px #8ad2e2bb",
  },
  {
    borderColor: "#8f6dcc",
    background: "radial-gradient(circle at 28% 25%, #ffffffdd 0 8%, #e7d6ff55 15% 65%, #b99ae988 90%)",
    boxShadow: "inset -2px -2px 4px #c4a9f0bb",
  },
  {
    borderColor: "#d4678a",
    background: "radial-gradient(circle at 28% 25%, #ffffffdd 0 8%, #ffd5e355 15% 65%, #f2a0bd88 90%)",
    boxShadow: "inset -2px -2px 4px #f4b3c9bb",
  },
  {
    borderColor: "#c19b2e",
    background: "radial-gradient(circle at 28% 25%, #ffffffdd 0 8%, #fff1b855 15% 65%, #f3c86d88 90%)",
    boxShadow: "inset -2px -2px 4px #f4d890bb",
  },
  {
    borderColor: "#4ca884",
    background: "radial-gradient(circle at 28% 25%, #ffffffdd 0 8%, #c8f8e055 15% 65%, #83d9ba88 90%)",
    boxShadow: "inset -2px -2px 4px #9ce4c5bb",
  },
  {
    borderColor: "#cf704e",
    background: "radial-gradient(circle at 28% 25%, #ffffffdd 0 8%, #ffe0c855 15% 65%, #f3aa7e88 90%)",
    boxShadow: "inset -2px -2px 4px #f1b995bb",
  },
] as const;

export function DesktopToy({ id }: { id: string }): JSX.Element | null {
  const [frame, setFrame] = useState<Frame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef(Promise.resolve());
  const held = useRef(false);
  function act(action: string): void {
    pending.current = pending.current
      .then(async () => {
        await command<Frame>("desktop_toy_action", { id, action });
      })
      .catch((cause: unknown) => {
        setError(errorText(cause));
      });
  }
  useEffect(() => {
    document.documentElement.classList.add(transparentDocument);
    let active = true;
    let cleanup: (() => void) | undefined;
    void listen<Frame>("desktop-toy-frame", (event) => {
      if (active && event.payload.id === id) setFrame(event.payload);
    })
      .then(async (unlisten) => {
        if (!active) {
          unlisten();
          return;
        }
        cleanup = unlisten;
        const initial = await command<Frame>("desktop_toy_action", { id, action: "snapshot" });
        if (!active) return;
        setFrame(initial);
        await command("desktop_toy_action", { id, action: "ready" });
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
      cleanup?.();
      document.documentElement.classList.remove(transparentDocument);
    };
  }, [id]);
  function release(event: PointerEvent<HTMLButtonElement>, action: string): void {
    if (!held.current) return;
    held.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    act(action);
  }
  if (!frame) return null;
  const title =
    error ??
    `${names[frame.kind]} · 끌어서 놓기 · 우클릭으로 정리${frame.externalWindowsAvailable ? "" : " · 다른 창을 읽지 못해 화면 가장자리만 사용 중"}`;
  return (
    <div className={s.frame}>
      <button
        className={s.actor}
        aria-label={names[frame.kind]}
        title={title}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          if (frame.kind === "bubbles") {
            act("pop");
            return;
          }
          held.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          act("grab");
        }}
        onPointerUp={(event) => release(event, "release")}
        onPointerCancel={(event) => release(event, "cancel")}
        onLostPointerCapture={() => {
          if (held.current) {
            held.current = false;
            act("cancel");
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          act("dismiss");
        }}
        style={{
          transform:
            frame.kind === "pet"
              ? `scaleX(${frame.angle === 180 ? -1 : 1})`
              : `rotate(${frame.angle}deg)`,
        }}
      >
        {frame.kind === "ball" && <span className={s.ball} aria-hidden="true" />}
        {frame.kind === "paper-plane" && (
          <svg aria-hidden="true" width="56" height="56" viewBox="0 0 56 56">
            <path
              d="M9 12 L49 28 L9 44 L17 28 Z"
              fill="#fffaf0"
              stroke="#4b6372"
              strokeWidth="1.5"
            />
            <path d="M17 28 H49" stroke="#7d919c" />
          </svg>
        )}
        {frame.kind === "bubbles" && (
          <span
            className={s.bubble}
            aria-hidden="true"
            style={{
              ...bubblePalette[frame.bubbleColor ?? 0] ?? bubblePalette[0],
              width: Number.isFinite(frame.bubbleSize)
                ? Math.max(18, Math.min(50, frame.bubbleSize ?? 38))
                : 38,
              height: Number.isFinite(frame.bubbleSize)
                ? Math.max(18, Math.min(50, frame.bubbleSize ?? 38))
                : 38,
            }}
          />
        )}
        {frame.kind === "pet" && (
          <span className={s.pet} aria-hidden="true">
            🐌
          </span>
        )}
      </button>
    </div>
  );
}
