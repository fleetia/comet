import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { WidgetShape } from "@comet/ui";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import desktopKinds from "../desktopKinds.json";

/** The part of the shared desktop state that widget management reads. */
export type WidgetDesktopState = {
  revision: number;
  mode: "freeform" | "stack";
  order: string[];
  shapes?: Record<string, WidgetShape>;
};

export function canPlaceOnDesktop(kind: string): boolean {
  return Object.hasOwn(desktopKinds, kind);
}

export function useWidgetDesktop(active = true): {
  state: WidgetDesktopState | null;
  error: string | null;
  receive: (next: WidgetDesktopState | null | undefined) => void;
} {
  const [state, setState] = useState<WidgetDesktopState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(-1);
  const receive = useCallback((next: WidgetDesktopState | null | undefined): void => {
    if (!next || typeof next.revision !== "number" || next.revision < latest.current) return;
    latest.current = next.revision;
    setState(next);
  }, []);
  useEffect(() => {
    if (!active || !isDesktop()) return;
    let alive = true;
    let cleanup: (() => void) | undefined;
    void listen<WidgetDesktopState>("widget-desktop-state", (event) => {
      if (alive) receive(event.payload);
    })
      .then((unlisten) => {
        if (alive) cleanup = unlisten;
        else unlisten();
      })
      .catch(() => {
        /* The initial read below still reports the current state. */
      });
    void command<WidgetDesktopState>("get_widget_desktop")
      .then((next) => {
        if (alive) receive(next);
      })
      .catch((cause: unknown) => {
        if (alive) setError(errorText(cause));
      });
    return () => {
      alive = false;
      cleanup?.();
    };
  }, [active, receive]);
  return { state, error, receive };
}
