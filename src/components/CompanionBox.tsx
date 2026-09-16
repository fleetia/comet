import { useRef, useState, type JSX } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconButton } from "@fleetia/lagrange";
import { command, errorText, isDesktop } from "../hooks/useSnapshot";
import type { Dispatch, Persona, Snapshot } from "../types";
import * as s from "./companion.css";
import { activeCharacter, characterName } from "./characterIdentity";

type Props = { persona: Persona; snapshot: Snapshot; preview?: boolean; dispatch?: Dispatch };
export function CompanionBox({
  persona,
  snapshot,
  preview = false,
  dispatch = command,
}: Props): JSX.Element {
  const pointer = useRef<{ x: number; y: number; dragged: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const character = activeCharacter(snapshot, persona);
  const name = characterName(snapshot, persona);
  const expressionKey =
    snapshot.playback?.persona === persona ? snapshot.playback.expression : "평온";
  const expression = character?.definition.expressions[expressionKey] ?? expressionKey;
  async function open(mode: "menu" | "input"): Promise<void> {
    setError(null);
    try {
      await dispatch("open_panel", { persona, mode });
    } catch (cause) {
      setError(errorText(cause));
    }
  }
  return (
    <div className={`${s.bodyFrame} ${preview ? s.bodyPreview : ""}`}>
      <button
        className={`${s.body} ${s.tone[persona]}`}
        aria-label={`${name} 메뉴 열기`}
        title={error ?? "클릭: 메뉴 · 두 번 클릭: 말 걸기 · 끌기: 이동"}
        onPointerDown={(event) => {
          if (event.button === 0) {
            pointer.current = { x: event.clientX, y: event.clientY, dragged: false };
          }
        }}
        onPointerMove={(event) => {
          const start = pointer.current;
          if (
            !start ||
            start.dragged ||
            event.buttons !== 1 ||
            Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6
          ) {
            return;
          }
          start.dragged = true;
          if (isDesktop() && !preview) {
            void getCurrentWindow()
              .startDragging()
              .catch((cause: unknown) => setError(errorText(cause)));
          }
        }}
        onClick={() => {
          if (pointer.current?.dragged) {
            return;
          }
          void open("menu");
        }}
        onDoubleClick={() => {
          if (!pointer.current?.dragged) {
            void open("input");
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          void open("menu");
        }}
        onKeyDown={(event) => {
          pointer.current = null;
          if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
            event.preventDefault();
            void open("menu");
          }
        }}
      >
        <span className={s.bodyName}>{name}</span>
        <span className={s.face}>[{expression}]</span>
      </button>
      <IconButton
        className={s.bodyClose}
        variant="quiet"
        size="compact"
        label="캐릭터 숨기기"
        disabled={!isDesktop() || preview}
        onClick={() => {
          setError(null);
          void dispatch("hide_boxes").catch((cause: unknown) => setError(errorText(cause)));
        }}
      >
        ×
      </IconButton>
    </div>
  );
}
