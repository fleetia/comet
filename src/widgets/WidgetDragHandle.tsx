import type { ReactElement } from "react";
import { writeWidgetDrag, type WidgetDragPayload } from "./widgetDrag";
import * as s from "./widgetDrag.css";

export function WidgetDragHandle({
  payload,
  title,
  disabled = false,
}: {
  payload: WidgetDragPayload;
  title: string;
  disabled?: boolean;
}): ReactElement {
  return (
    <span
      className={s.handle}
      draggable={!disabled}
      aria-label={`${title} 다이어리로 드래그`}
      aria-disabled={disabled}
      title={disabled ? "저장을 마친 뒤 다이어리로 끌어 놓으세요" : "다이어리로 끌어 놓기"}
      onDragStart={(event) => {
        if (disabled) {
          event.preventDefault();
          return;
        }
        writeWidgetDrag(event.dataTransfer, payload);
      }}
    >
      ⠿
    </span>
  );
}
