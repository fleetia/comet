import { useEffect, useState, type JSX } from "react";
import { IconButton } from "@fleetia/lagrange";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { useCharacterGestures } from "../../hooks/useCharacterGestures";
import { useCharacterCollision } from "../../hooks/useCharacterCollision";
import { useCharacterAnimation } from "../../hooks/useCharacterAnimation";
import { AnimationFrameView } from "../AnimationFrameView/AnimationFrameView";
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
  const character = characterById(snapshot, id);
  const persona = personaOf(snapshot, id);
  const name = character?.definition.name ?? persona?.toUpperCase() ?? "친구";
  const reaction =
    !snapshot.runtime.hidden && !snapshot.runtime.paused ? snapshot.reactions?.[id] : undefined;
  const expressionKey = reaction?.expression ?? currentExpression(snapshot, persona);
  const expression = expressionLabel(character, expressionKey);
  const sprite = spriteSource(character, expressionKey);
  const size = character?.definition.spriteSize ?? 64;
  const animation = useCharacterAnimation(
    character,
    snapshot,
    expressionKey,
    !preview && persona !== null,
    dispatch,
  );
  const imageBody = Boolean(sprite) || animation.hasAnimation;
  const transparent = imageBody && !preview;
  const animated = animation.frameIndex !== null && animation.frames !== null;
  const { bodyRef, imageRef, canvasRef } = useCharacterCollision({
    enabled: isDesktop() && !preview && persona !== null && !snapshot.runtime.hidden,
    source: sprite,
    size,
    dispatch,
    onError: setError,
    animation: animation.frames
      ? { key: animation.cacheKey, frames: animation.frames, frame: animation.frameIndex }
      : undefined,
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
  const gestures = useCharacterGestures({
    enabled: !preview && persona !== null,
    resetKey: JSON.stringify([
      id,
      character?.definition,
      snapshot.runtime.hidden,
      snapshot.runtime.paused,
    ]),
    onClick: () => {
      setError(null);
      void dispatch("trigger_character_reaction").catch((cause: unknown) =>
        setError(errorText(cause)),
      );
    },
    onDoubleClick: () => {
      void open("input");
    },
    onMenu: () => {
      void open("menu");
    },
    onError: setError,
    dispatch,
  });
  return (
    <div className={`${s.bodyFrame} ${preview ? s.bodyPreview : ""}`}>
      <button
        ref={bodyRef}
        className={
          imageBody
            ? `${s.body} ${s.spriteBody}`
            : `${s.body} ${s.tone[snapshot.characters.active.indexOf(id) % 2 === 1 ? "b" : "a"]}`
        }
        aria-label={persona ? `${name} 반응` : name}
        title={
          error ??
          animation.error ??
          (persona
            ? "클릭: 반응 · 우클릭: 메뉴 · 두 번 클릭: 말 걸기 · 끌기: 이동"
            : "끌기: 이동 · 이 친구의 대화는 준비 중이에요")
        }
        {...gestures}
      >
        {imageBody && (
          <AnimationFrameView
            frames={animation.frames}
            index={animation.frameIndex}
            size={size}
            label={`${name} ${expression} 동작`}
            canvasRef={canvasRef}
            className={s.sprite}
            style={{ position: "absolute" }}
          />
        )}
        {sprite ? (
          <img
            ref={imageRef}
            className={s.sprite}
            style={{ width: size, height: size, visibility: animated ? "hidden" : "visible" }}
            crossOrigin="anonymous"
            src={sprite}
            alt={`${name} ${expression}`}
            draggable={false}
          />
        ) : (
          <span style={{ visibility: animated ? "hidden" : "visible", display: "contents" }}>
            <span className={s.bodyName}>{name}</span>
            <span className={s.face}>[{expression}]</span>
          </span>
        )}
      </button>
      {!imageBody && (
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
