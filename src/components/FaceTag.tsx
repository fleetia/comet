import { useEffect, useState, type JSX } from "react";
import { command, errorText } from "../hooks/useSnapshot";
import { useWindowDrag } from "../hooks/useWindowDrag";
import type { Dispatch, Snapshot } from "../types";
import * as s from "./companion.css";
import {
  characterById,
  currentExpression,
  expressionLabel,
  personaOf,
} from "./characterIdentity";

type Props = { id: string; snapshot: Snapshot; dispatch?: Dispatch };
export function FaceTag({ id, snapshot, dispatch = command }: Props): JSX.Element {
  const [error, setError] = useState<string | null>(null);
  const drag = useWindowDrag(true, setError);
  const character = characterById(snapshot, id);
  const persona = personaOf(snapshot, id);
  const name = character?.definition.name ?? persona?.toUpperCase() ?? "친구";
  const expression = expressionLabel(character, currentExpression(snapshot, persona));
  useEffect(() => {
    document.documentElement.classList.add(s.transparentDocument);
    return () => document.documentElement.classList.remove(s.transparentDocument);
  }, []);
  return (
    <div className={s.faceFrame}>
      <button
        className={s.faceTag}
        aria-label={`${name} 표정`}
        title={error ?? (persona ? "끌기: 이동 · 클릭: 메뉴" : "끌기: 이동")}
        onPointerDown={drag.onPointerDown}
        onPointerMove={drag.onPointerMove}
        onClick={() => {
          if (drag.dragged() || !persona) return;
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
