import { useEffect, useState, type JSX } from "react";
import { command, errorText } from "../hooks/useSnapshot";
import { useWindowDrag } from "../hooks/useWindowDrag";
import type { Dispatch, Persona, Snapshot } from "../types";
import * as s from "./companion.css";
import {
  activeCharacter,
  characterName,
  currentExpression,
  expressionLabel,
} from "./characterIdentity";

type Props = { persona: Persona; snapshot: Snapshot; dispatch?: Dispatch };
export function FaceTag({ persona, snapshot, dispatch = command }: Props): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const drag = useWindowDrag(true, setError);
  const character = activeCharacter(snapshot, persona);
  const expression = expressionLabel(character, currentExpression(snapshot, persona));
  useEffect(() => {
    document.documentElement.classList.add(s.transparentDocument);
    return () => document.documentElement.classList.remove(s.transparentDocument);
  }, []);
  return (
    <div className={s.faceFrame}>
      <button
        className={s.faceTag}
        aria-label={`${characterName(snapshot, persona)} 표정`}
        title={error ?? "끌기: 이동 · 클릭: 메뉴"}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onClick={() => {
          if (drag.dragged()) return;
          setError(null);
          void dispatch("open_panel", { persona, mode: "menu" }).catch((cause: unknown) =>
            setError(errorText(cause)),
          );
        }}
      >
        {expression}
      </button>
    </div>
  );
}
