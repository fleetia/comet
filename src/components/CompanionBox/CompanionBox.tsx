import { useEffect, useState, type JSX } from "react";
import { IconButton } from "@fleetia/lagrange";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { useWindowDrag } from "../../hooks/useWindowDrag";
import { useCharacterCollision } from "../../hooks/useCharacterCollision";
import type { Dispatch, Snapshot } from "../../types";
import * as s from "../companion.css";
import {
  characterById,
  currentExpression,
  expressionLabel,
  personaOf,
  spriteSource,
} from "../characterIdentity";

type Props = { id: string; snapshot: Snapshot; preview?: boolean; dispatch?: Dispatch };
export function CompanionBox({
  id,
  snapshot,
  preview = false,
  dispatch = command,
}: Props): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const drag = useWindowDrag(!preview, setError);
  const character = characterById(snapshot, id);
  const persona = personaOf(snapshot, id);
  const name = character?.definition.name ?? persona?.toUpperCase() ?? "친구";
  const expressionKey = currentExpression(snapshot, persona);
  const expression = expressionLabel(character, expressionKey);
  const sprite = spriteSource(character, expressionKey);
  const size = character?.definition.spriteSize ?? 64;
  const transparent = Boolean(sprite) && !preview;
  const { bodyRef, imageRef } = useCharacterCollision({
    enabled: isDesktop() && !preview && persona !== null && !snapshot.runtime.hidden,
    source: sprite,
    size,
    dispatch,
    onError: setError,
  });
  useEffect(() => {
    if (!transparent) return;
    document.documentElement.classList.add(s.transparentDocument);
    return () => document.documentElement.classList.remove(s.transparentDocument);
  }, [transparent]);
  async function open(mode: "menu" | "input"): Promise<void> {
    if (!persona) return;
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
        ref={bodyRef}
        className={
          sprite
            ? `${s.body} ${s.spriteBody}`
            : `${s.body} ${s.tone[snapshot.characters.active.indexOf(id) % 2 === 1 ? "b" : "a"]}`
        }
        aria-label={persona ? `${name} 메뉴 열기` : name}
        title={
          error ??
          (persona
            ? "클릭: 메뉴 · 두 번 클릭: 말 걸기 · 끌기: 이동"
            : "끌기: 이동 · 이 친구의 대화는 준비 중이에요")
        }
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onClick={() => {
          if (drag.dragged()) {
            return;
          }
          void open("menu");
        }}
        onDoubleClick={() => {
          if (!drag.dragged()) {
            void open("input");
          }
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          void open("menu");
        }}
        onKeyDown={(event) => {
          drag.reset();
          if ((event.shiftKey && event.key === "F10") || event.key === "ContextMenu") {
            event.preventDefault();
            void open("menu");
          }
        }}
      >
        {sprite ? (
          <img
            ref={imageRef}
            className={s.sprite}
            style={{ width: size, height: size }}
            crossOrigin="anonymous"
            src={sprite}
            alt={`${name} ${expression}`}
            draggable={false}
          />
        ) : (
          <>
            <span className={s.bodyName}>{name}</span>
            <span className={s.face}>[{expression}]</span>
          </>
        )}
      </button>
      {!sprite && (
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
      )}
    </div>
  );
}
