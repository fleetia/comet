import { useEffect, useRef, type DOMAttributes, type PointerEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { command, errorText, isDesktop } from "./useSnapshot";
import type { CharacterBodyRegion, Dispatch } from "../types";

type Options = {
  enabled: boolean;
  resetKey: string;
  regions?: CharacterBodyRegion[];
  cheekRegionIds?: string[];
  spriteSize?: number;
  onClick: (bodyPart?: string, sessionId?: string) => void;
  onDoubleClick: () => void;
  onMenu: () => void;
  onError: (message: string) => void;
  dispatch?: Dispatch;
};
type NativeGesture = {
  characterId: string;
  sessionId: string;
  generation: number;
  phase: "started" | "moving" | "stopped" | "ended" | "cancelled";
};
type Pointer = {
  id: number;
  x: number;
  y: number;
  lastX: number;
  lastY: number;
  total: number;
  stroke: boolean;
  mode: "touch" | "move";
  dragged: boolean;
  nativeRequested: boolean;
  cheek: boolean;
  cancelled: boolean;
  region?: string;
  sessionId: string;
  holdTimer: number | null;
  holdRequest?: Promise<unknown>;
  contactRequest?: Promise<unknown>;
  traceCount: number;
  tracedMove: boolean;
};
type TracePhase =
  | "ready"
  | "listener-ready"
  | "move-armed"
  | "down-ignored"
  | "down"
  | "capture-ok"
  | "capture-failed"
  | "contact-start"
  | "contact-resolved"
  | "contact-rejected"
  | "move"
  | "threshold"
  | "listener-unavailable"
  | "begin-skipped"
  | "begin-dispatch"
  | "begin-resolved"
  | "begin-rejected"
  | "up"
  | "cancel"
  | "blur"
  | "reset";
type TracePointerEvent = Pick<
  PointerEvent<HTMLButtonElement>,
  "pointerId" | "buttons" | "clientX" | "clientY" | "metaKey" | "ctrlKey"
>;
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
  const pointer = useRef<Pointer | null>(null);
  const capture = useRef<{ target: HTMLButtonElement; id: number } | null>(null);
  const dragSession = useRef<string | null>(null);
  const dragRequest = useRef<Promise<unknown> | null>(null);
  const moveArmed = useRef(false);
  const suppressClick = useRef(false);
  const initialized = useRef(false);
  const keyboardSpace = useRef(false);
  const interval = useRef<number | null>(null);
  const listenerReady = useRef(false);
  const tracing = useRef(false);
  const traceSequence = useRef(0);
  const traceControls = useRef(0);
  const tracedUnownedMove = useRef(false);
  const candidate = useRef<{
    at: number;
    timer: number | null;
    region?: string;
    sessionId: string;
  } | null>(null);

  function trace(
    phase: TracePhase,
    current = pointer.current,
    event?: TracePointerEvent,
    displacement?: number,
  ): void {
    if (!tracing.current || (current ? current.traceCount >= 24 : traceControls.current >= 64)) {
      return;
    }
    if (current) current.traceCount += 1;
    else traceControls.current += 1;
    traceSequence.current += 1;
    void command("trace_character_gesture", {
      event: {
        phase,
        sequence: traceSequence.current,
        atMs: performance.now(),
        sessionId: current?.sessionId,
        pointerId: current?.id ?? event?.pointerId,
        mode: current?.mode,
        buttons: event?.buttons,
        x: event?.clientX,
        y: event?.clientY,
        displacement,
        total: current?.total,
        listenerReady: listenerReady.current,
        pointerCurrent: current !== null && pointer.current === current,
        nativeRequested: current?.nativeRequested ?? false,
        armed: moveArmed.current,
        metaKey: event?.metaKey ?? false,
        ctrlKey: event?.ctrlKey ?? false,
      },
    }).catch(() => undefined);
  }

  function report(cause: unknown): void {
    if (latest.current.enabled) {
      latest.current.onError(errorText(cause));
    }
  }
  function clearClick(): void {
    if (candidate.current?.timer != null) {
      window.clearTimeout(candidate.current.timer);
    }
    candidate.current = null;
  }
  function clearHold(current: Pointer): void {
    if (current.holdTimer !== null) {
      window.clearTimeout(current.holdTimer);
      current.holdTimer = null;
    }
  }
  function releaseCapture(): void {
    const held = capture.current;
    capture.current = null;
    if (held?.target.hasPointerCapture(held.id)) {
      held.target.releasePointerCapture(held.id);
    }
  }
  function finishTouch(current: Pointer, cancelled: boolean): void {
    current.cancelled ||= cancelled;
    clearHold(current);
    if (cancelled && !current.cheek) {
      return;
    }
    const args = {
      action: current.cheek ? "cheek-grab" : "stroke",
      bodyPart: current.region,
      sessionId: current.sessionId,
      phase: cancelled ? "cancelled" : "ended",
    };
    // A release can arrive before the hold-start IPC resolves. Keep both operations
    // in pointer order so cancellation cannot leave a late hold running.
    void (current.holdRequest ?? current.contactRequest ?? Promise.resolve())
      .then(() => dispatch("trigger_character_interaction", args))
      .catch(report);
  }
  function reset(): void {
    trace("reset");
    clearClick();
    releaseCapture();
    if (pointer.current) {
      finishTouch(pointer.current, true);
    }
    const sessionId = dragSession.current;
    const pending = dragRequest.current;
    dragSession.current = null;
    dragRequest.current = null;
    if (sessionId) {
      void (pending ?? Promise.resolve())
        .catch(() => undefined)
        .then(() => dispatch("cancel_character_drag", { sessionId }))
        .catch(report);
    }
    pointer.current = null;
    moveArmed.current = false;
    suppressClick.current = true;
    keyboardSpace.current = false;
  }
  function armClick(): void {
    const current = candidate.current;
    if (!current || interval.current === null) {
      return;
    }
    current.timer = window.setTimeout(
      () => {
        if (candidate.current === current && latest.current.enabled) {
          candidate.current = null;
          latest.current.onClick(current.region, current.sessionId);
        }
      },
      Math.max(0, interval.current - (performance.now() - current.at)),
    );
  }
  function regionAt(event: PointerEvent<HTMLButtonElement>): string | undefined {
    const bounds = event.currentTarget.getBoundingClientRect();
    const width = latest.current.spriteSize ?? bounds.width;
    const height = latest.current.spriteSize ?? bounds.height;
    if (width <= 0 || height <= 0) {
      return undefined;
    }
    const x = (event.clientX - bounds.left - (bounds.width - width) / 2) / width;
    const y = (event.clientY - bounds.top - (bounds.height - height) / 2) / height;
    return latest.current.regions
      ?.filter(
        (region) =>
          x >= region.x &&
          x <= region.x + region.width &&
          y >= region.y &&
          y <= region.y + region.height,
      )
      .sort((a, b) => a.width * a.height - b.width * b.height)[0]?.id;
  }

  useEffect(() => {
    const firstMount = !initialized.current;
    initialized.current = true;
    reset();
    // A reset keeps late native clicks suppressed until the next real pointer-down.
    if (firstMount) {
      suppressClick.current = false;
    }
    if (!enabled || !isDesktop()) {
      return;
    }
    let active = true;
    const cleanups: (() => void)[] = [];
    listenerReady.current = false;
    tracing.current = false;
    traceControls.current = 0;
    interval.current = null;
    const windowHandle = getCurrentWindow();
    const preference = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const reportPreference = () => {
      void command("report_character_motion_preference", {
        reducedMotion: preference?.matches ?? true,
      }).catch((cause: unknown) => {
        if (active) report(cause);
      });
    };
    reportPreference();
    preference?.addEventListener("change", reportPreference);
    cleanups.push(() => preference?.removeEventListener("change", reportPreference));
    void windowHandle
      .listen<NativeGesture>("character-gesture", ({ payload }) => {
        if (!active || payload.sessionId !== dragSession.current) {
          return;
        }
        if (payload.phase === "ended" || payload.phase === "cancelled") {
          dragSession.current = null;
        }
        // Native terminal events never reactivate the browser's synthetic click.
      })
      .then((cleanup) => {
        if (!active) {
          cleanup();
        } else {
          cleanups.push(cleanup);
          listenerReady.current = true;
          trace("listener-ready");
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          report(cause);
        }
      });
    void windowHandle
      .listen("character-move-armed", () => {
        if (active) {
          reset();
          moveArmed.current = true;
          trace("move-armed");
        }
      })
      .then((cleanup) => {
        if (!active) {
          cleanup();
        } else {
          cleanups.push(cleanup);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          report(cause);
        }
      });
    void command<{ doubleClickMs: number; traceEnabled?: boolean }>(
      "get_character_gesture_settings",
    )
      .then((settings) => {
        if (!active) {
          return;
        }
        if (!Number.isFinite(settings.doubleClickMs) || settings.doubleClickMs < 0) {
          throw new Error("두 번 클릭 간격을 읽지 못했어요.");
        }
        tracing.current = settings.traceEnabled === true;
        trace("ready");
        interval.current = settings.doubleClickMs;
        armClick();
      })
      .catch((cause: unknown) => {
        if (active) {
          report(cause);
        }
      });
    return () => {
      active = false;
      listenerReady.current = false;
      interval.current = null;
      cleanups.forEach((cleanup) => cleanup());
      reset();
      tracing.current = false;
    };
  }, [enabled, resetKey]);

  return {
    onPointerDown(event) {
      if (!enabled || event.button !== 0) {
        trace("down-ignored", null, event);
        return;
      }
      releaseCapture();
      if (pointer.current) {
        finishTouch(pointer.current, true);
      }
      const mode = moveArmed.current || event.metaKey || event.ctrlKey ? "move" : "touch";
      tracedUnownedMove.current = false;
      moveArmed.current = false;
      suppressClick.current = false;
      const current: Pointer = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        total: 0,
        stroke: false,
        mode,
        dragged: false,
        nativeRequested: false,
        cheek: false,
        cancelled: false,
        region: regionAt(event),
        sessionId: crypto.randomUUID(),
        holdTimer: null,
        traceCount: 0,
        tracedMove: false,
      };
      pointer.current = current;
      trace("down", current, event);
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
        capture.current = { target: event.currentTarget, id: event.pointerId };
        trace("capture-ok", current, event);
      } catch {
        trace("capture-failed", current, event);
        pointer.current = null;
        suppressClick.current = true;
        return;
      }
      if (isDesktop()) {
        trace("contact-start", current);
        current.contactRequest = command("begin_character_contact");
        if (tracing.current) {
          void current.contactRequest
            .then(() => trace("contact-resolved", current))
            .catch(() => undefined);
        }
        void current.contactRequest.catch((cause: unknown) => {
          trace("contact-rejected", current);
          if (pointer.current === current) {
            reset();
            report(cause);
          }
        });
      }
      if (
        mode === "touch" &&
        current.region &&
        latest.current.cheekRegionIds?.includes(current.region)
      ) {
        current.holdTimer = window.setTimeout(() => {
          current.holdTimer = null;
          if (pointer.current !== current || current.stroke || !latest.current.enabled) {
            return;
          }
          current.cheek = true;
          clearClick();
          suppressClick.current = true;
          current.holdRequest = (current.contactRequest ?? Promise.resolve()).then(() =>
            current.cancelled
              ? undefined
              : dispatch("trigger_character_interaction", {
                  action: "cheek-grab",
                  bodyPart: current.region,
                  sessionId: current.sessionId,
                  phase: "started",
                }),
          );
          void current.holdRequest.catch((cause: unknown) => {
            if (pointer.current === current) {
              report(cause);
            }
          });
        }, 450);
      }
    },
    onPointerMove(event) {
      const current = pointer.current;
      if (!current && event.buttons !== 0 && !tracedUnownedMove.current && tracing.current) {
        tracedUnownedMove.current = true;
        trace("move", null, event);
      }
      if (current && !current.tracedMove && tracing.current) {
        current.tracedMove = true;
        trace("move", current, event);
      }
      if (
        !enabled ||
        !current ||
        current.id !== event.pointerId ||
        current.dragged ||
        event.buttons !== 1
      ) {
        return;
      }
      const displacement = Math.hypot(event.clientX - current.x, event.clientY - current.y);
      current.total += Math.hypot(event.clientX - current.lastX, event.clientY - current.lastY);
      current.lastX = event.clientX;
      current.lastY = event.clientY;
      if (current.mode === "touch") {
        if (!current.cheek && (displacement >= 8 || current.total >= 24)) {
          current.stroke = true;
          clearHold(current);
          clearClick();
          suppressClick.current = true;
        }
        return;
      }
      if (displacement < 6) {
        return;
      }
      trace("threshold", current, event, displacement);
      current.dragged = true;
      suppressClick.current = true;
      clearClick();
      releaseCapture();
      if (!listenerReady.current || !isDesktop()) {
        trace("listener-unavailable", current, event, displacement);
        return;
      }
      dragSession.current = current.sessionId;
      dragRequest.current = (current.contactRequest ?? Promise.resolve())
        .then(() => {
          if (pointer.current !== current || dragSession.current !== current.sessionId) {
            trace("begin-skipped", current);
            return;
          }
          current.nativeRequested = true;
          trace("begin-dispatch", current);
          const request = dispatch("begin_character_drag", {
            sessionId: current.sessionId,
            ...(current.region ? { bodyPart: current.region } : {}),
          });
          if (tracing.current) {
            void request.then(() => trace("begin-resolved", current)).catch(() => undefined);
          }
          return request;
        })
        .catch((cause: unknown) => {
          trace("begin-rejected", current);
          if (dragSession.current !== current.sessionId) {
            return;
          }
          dragSession.current = null;
          report(cause);
        });
    },
    onPointerUp(event) {
      const current = pointer.current;
      trace("up", current, event);
      if (!current || current.id !== event.pointerId) {
        return;
      }
      clearHold(current);
      releaseCapture();
      if (current.mode === "touch" && !current.cheek) {
        const displacement = Math.hypot(event.clientX - current.x, event.clientY - current.y);
        current.total += Math.hypot(event.clientX - current.lastX, event.clientY - current.lastY);
        current.stroke ||= displacement >= 8 || current.total >= 24;
      }
      if (current.mode === "move") {
        suppressClick.current = true;
        if (!current.nativeRequested && dragSession.current === current.sessionId) {
          dragSession.current = null;
        }
        pointer.current = null;
      } else if (current.stroke || current.cheek) {
        suppressClick.current = true;
        finishTouch(current, false);
        pointer.current = null;
      }
      // A simple touch retains its origin until click/double-click decides poke.
    },
    onPointerCancel(event) {
      const current = pointer.current;
      trace("cancel", current, event);
      if (current?.id !== event.pointerId) return;
      if (current.nativeRequested && dragSession.current === current.sessionId) {
        // OS drag owns capture and its terminal event after the handoff. Browser
        // pointer cancellation during that transfer is not a native cancellation.
        releaseCapture();
        pointer.current = null;
        suppressClick.current = true;
      } else {
        reset();
      }
    },
    onClick(event) {
      if (!enabled) {
        return;
      }
      if (event.detail === 0) {
        clearClick();
        options.onClick(undefined, crypto.randomUUID());
        return;
      }
      if (suppressClick.current) {
        return;
      }
      if (event.detail >= 2) {
        clearClick();
        return;
      }
      if (candidate.current) {
        const previous = candidate.current;
        clearClick();
        options.onClick(previous.region, previous.sessionId);
      }
      candidate.current = {
        at: performance.now(),
        timer: null,
        region: pointer.current?.region,
        sessionId: pointer.current?.sessionId ?? crypto.randomUUID(),
      };
      pointer.current = null;
      armClick();
    },
    onDoubleClick(event) {
      event.preventDefault();
      clearClick();
      if (enabled && !suppressClick.current) {
        options.onDoubleClick();
      }
    },
    onContextMenu(event) {
      event.preventDefault();
      // macOS Control-primary can emit contextmenu during an explicit move.
      if (
        pointer.current?.mode === "move" ||
        (suppressClick.current && event.button === 0 && event.ctrlKey)
      ) {
        return;
      }
      reset();
      if (enabled) {
        options.onMenu();
      }
    },
    onKeyDown(event) {
      if (!enabled) {
        return;
      }
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
        event.preventDefault();
        reset();
        if (!event.repeat) {
          options.onMenu();
        }
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (event.repeat) {
          return;
        }
        reset();
        if (!event.repeat) {
          if (event.key === "Enter") {
            options.onClick(undefined, crypto.randomUUID());
          } else {
            keyboardSpace.current = true;
          }
        }
      } else if (event.key === "Escape") {
        reset();
      }
    },
    onKeyUp(event) {
      if (event.key !== " ") {
        return;
      }
      event.preventDefault();
      if (enabled && keyboardSpace.current) {
        options.onClick(undefined, crypto.randomUUID());
      }
      keyboardSpace.current = false;
    },
    onBlur() {
      trace("blur");
      // Closing the menu hands focus back across native windows. Its one-use
      // reservation survives that handoff until a real pointer or explicit reset.
      const armed = moveArmed.current && !pointer.current && !dragSession.current;
      reset();
      moveArmed.current = armed;
    },
  };
}
