import { useRef, type DragEvent, type RefObject } from "react";
import type { DataRecord } from "../toolData";
import type { WidgetView } from "../types";

export const TODO_DRAG_TYPE = "application/x-comet-todo";

export type PlannerTaskDrag = {
  dragging: RefObject<{ id: string; widgetId: string } | null>;
  draggedTask: (event: DragEvent) => DataRecord | undefined;
};

/** Resolves a dragged Todo row of this widget, from memory or the drag payload. */
export function usePlannerTaskDrag({
  busy,
  todo,
  items,
}: {
  busy: boolean;
  todo: WidgetView | undefined;
  items: DataRecord[];
}): PlannerTaskDrag {
  const dragging = useRef<{ id: string; widgetId: string } | null>(null);
  function draggedTask(event: DragEvent): DataRecord | undefined {
    let value = dragging.current;
    if (!value) {
      try {
        value = JSON.parse(event.dataTransfer.getData(TODO_DRAG_TYPE));
      } catch {
        return undefined;
      }
    }
    return !busy && value?.widgetId === todo?.id
      ? items.find((item) => item.id === value?.id)
      : undefined;
  }
  return { dragging, draggedTask };
}
