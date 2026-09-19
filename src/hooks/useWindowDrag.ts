import { useRef, type PointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { errorText, isDesktop } from "./useSnapshot";

type Handlers = {
  onPointerDown: (event: PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLElement>) => void;
  dragged: () => boolean;
  reset: () => void;
};
export function useWindowDrag(enabled: boolean, onError: (message: string) => void): Handlers {
  const pointer = useRef<{ x: number; y: number; dragged: boolean } | null>(null);
  return {
    onPointerDown(event) {
      if (event.button === 0) {
        pointer.current = { x: event.clientX, y: event.clientY, dragged: false };
      }
    },
    onPointerMove(event) {
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
      if (enabled && isDesktop()) {
        void getCurrentWindow()
          .startDragging()
          .catch((cause: unknown) => onError(errorText(cause)));
      }
    },
    dragged: () => Boolean(pointer.current?.dragged),
    reset: () => {
      pointer.current = null;
    },
  };
}
