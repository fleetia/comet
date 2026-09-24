import { useEffect, useRef, type DOMAttributes } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { command, errorText, isDesktop } from "./useSnapshot";
import type { Dispatch } from "../types";

type Options = {
  enabled: boolean;
  resetKey: string;
  onClick: () => void;
  onDoubleClick: () => void;
  onMenu: () => void;
  onError: (message: string) => void;
  dispatch?: Dispatch;
};
type NativeGesture = {
  characterId: string;
  sessionId: string;
  generation: number;
  phase: "started" | "ended" | "cancelled";
};
type Handlers = Pick<
  DOMAttributes<HTMLButtonElement>,
  | "onPointerDown"
  | "onPointerMove"
  | "onPointerUp"
  | "onPointerCancel"
  | "onClick"
  | "onDoubleClick"
  | "onContextMenu"
  | "onKeyDown"
  | "onKeyUp"
  | "onBlur"
>;

export function useCharacterGestures(options: Options): Handlers {
  const { enabled, resetKey, dispatch = command } = options;
  const latest = useRef(options);
  latest.current = options;
  const pointer = useRef<{ id: number; x: number; y: number; dragged: boolean } | null>(null);
  const capture = useRef<{ target: HTMLButtonElement; id: number } | null>(null);
  const dragSession = useRef<string | null>(null);
  const keyboardSpace = useRef(false);
  const interval = useRef<number | null>(null);
  const listenerReady = useRef(false);
  const candidate = useRef<{ at: number; timer: number | null } | null>(null);

  function clearClick(): void {
    if (candidate.current?.timer != null) window.clearTimeout(candidate.current.timer);
    candidate.current = null;
  }
  function releaseCapture(): void {
    const held = capture.current;
    capture.current = null;
    if (held?.target.hasPointerCapture(held.id)) held.target.releasePointerCapture(held.id);
  }
  function armClick(): void {
    const current = candidate.current;
    if (!current || interval.current === null) return;
    current.timer = window.setTimeout(
      () => {
        if (candidate.current === current && latest.current.enabled) {
          candidate.current = null;
          latest.current.onClick();
        }
      },
      Math.max(0, interval.current - (performance.now() - current.at)),
    );
  }
  function reset(): void {
    clearClick();
    releaseCapture();
    pointer.current = null;
    dragSession.current = null;
    keyboardSpace.current = false;
  }

  useEffect(() => {
    reset();
    if (!enabled || !isDesktop()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    listenerReady.current = false;
    interval.current = null;
    void getCurrentWindow()
      .listen<NativeGesture>("character-gesture", ({ payload }) => {
        if (!active || payload.sessionId !== dragSession.current) return;
        if (payload.phase !== "started") dragSession.current = null;
        // Keep dragged=true until a fresh pointer-down. Some webviews emit click after
        // the native loop ends; it is not a second user activation.
      })
      .then((cleanup) => {
        if (!active) cleanup();
        else {
          unlisten = cleanup;
          listenerReady.current = true;
        }
      })
      .catch((cause: unknown) => {
        if (active) latest.current.onError(errorText(cause));
      });
    void command<{ doubleClickMs: number }>("get_character_gesture_settings")
      .then((settings) => {
        if (!active) return;
        if (!Number.isFinite(settings.doubleClickMs) || settings.doubleClickMs < 0) {
          throw new Error("두 번 클릭 간격을 읽지 못했어요.");
        }
        interval.current = settings.doubleClickMs;
        armClick();
      })
      .catch((cause: unknown) => {
        if (active) latest.current.onError(errorText(cause));
      });
    return () => {
      active = false;
      listenerReady.current = false;
      interval.current = null;
      unlisten?.();
      reset();
    };
  }, [enabled, resetKey]);

  return {
    onPointerDown(event) {
      if (!enabled || event.button !== 0) return;
      releaseCapture();
      pointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dragged: false };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
        capture.current = { target: event.currentTarget, id: event.pointerId };
      } catch {
        // The pointer can already be inactive when the WebView dispatches a delayed event.
        pointer.current = null;
      }
    },
    onPointerMove(event) {
      const start = pointer.current;
      if (
        !enabled ||
        !start ||
        start.id !== event.pointerId ||
        start.dragged ||
        event.buttons !== 1 ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6
      )
        return;
      start.dragged = true;
      clearClick();
      releaseCapture();
      if (!listenerReady.current || !isDesktop()) return;
      const sessionId = crypto.randomUUID();
      dragSession.current = sessionId;
      void dispatch("begin_character_drag", { sessionId }).catch((cause: unknown) => {
        if (dragSession.current !== sessionId) return;
        dragSession.current = null;
        latest.current.onError(errorText(cause));
      });
    },
    onPointerUp(event) {
      if (pointer.current?.id !== event.pointerId) return;
      releaseCapture();
      if (!pointer.current.dragged) pointer.current = null;
    },
    onPointerCancel(event) {
      if (pointer.current?.id !== event.pointerId) return;
      releaseCapture();
      if (!pointer.current?.dragged) pointer.current = null;
      clearClick();
    },
    onClick(event) {
      if (!enabled || pointer.current?.dragged) return;
      if (event.detail === 0) {
        clearClick();
        options.onClick();
        return;
      }
      if (event.detail >= 2) {
        clearClick();
        return;
      }
      if (candidate.current) {
        // A second detail=1 is a distinct click outside the OS double-click region.
        clearClick();
        options.onClick();
      }
      candidate.current = { at: performance.now(), timer: null };
      armClick();
    },
    onDoubleClick(event) {
      event.preventDefault();
      clearClick();
      if (enabled && !pointer.current?.dragged) options.onDoubleClick();
    },
    onContextMenu(event) {
      event.preventDefault();
      clearClick();
      if (enabled) options.onMenu();
    },
    onKeyDown(event) {
      if (!enabled) return;
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        reset();
        if (!event.repeat) options.onMenu();
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        clearClick();
        releaseCapture();
        pointer.current = null;
        if (!event.repeat) {
          if (event.key === "Enter") options.onClick();
          else keyboardSpace.current = true;
        }
      } else if (event.key === "Escape") {
        clearClick();
        releaseCapture();
        if (!pointer.current?.dragged) pointer.current = null;
        keyboardSpace.current = false;
      }
    },
    onKeyUp(event) {
      if (event.key !== " ") return;
      event.preventDefault();
      if (enabled && keyboardSpace.current) options.onClick();
      keyboardSpace.current = false;
    },
    onBlur() {
      keyboardSpace.current = false;
    },
  };
}
