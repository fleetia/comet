import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { command, errorText, isDesktop } from "../hooks/useSnapshot";
import type { WidgetRuntime, WidgetRuntimeSnapshot } from "./types";

export function useWidgetRuntime(active: boolean): {
  snapshot: WidgetRuntimeSnapshot | null;
  error: string | null;
  reload: () => void;
} {
  const [snapshot, setSnapshot] = useState<WidgetRuntimeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sequence = useRef(-1);
  const successful = useRef(new Map<string, WidgetRuntime>());
  const read = useRef<() => void>(() => undefined);
  const reload = useCallback((): void => read.current(), []);
  useEffect(() => {
    if (!active || !isDesktop()) {
      return;
    }
    let alive = true;
    let pending = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let unlisten: (() => void) | undefined;
    let unfocus: (() => void) | undefined;
    function receive(next: WidgetRuntimeSnapshot): void {
      if (!alive || next.sequence < sequence.current) {
        return;
      }
      sequence.current = next.sequence;
      setSnapshot({
        ...next,
        widgets: next.widgets.map((entry) => {
          if (!entry.queryError) {
            successful.current.set(entry.id, entry);
            return entry;
          }
          const previous = successful.current.get(entry.id);
          return previous
            ? {
                ...previous,
                queryError: entry.queryError,
                actionError: entry.actionError,
                lastConfirmed: true,
              }
            : { ...entry, lastConfirmed: false };
        }),
      });
      setError(null);
    }
    async function refresh(checkVisibility = false): Promise<void> {
      if (!alive || pending || document.hidden) {
        return;
      }
      pending = true;
      const startedSequence = sequence.current;
      try {
        if (checkVisibility && !(await getCurrentWindow().isVisible())) {
          return;
        }
        receive(await command<WidgetRuntimeSnapshot>("get_widget_runtime"));
      } catch (cause: unknown) {
        if (alive && sequence.current === startedSequence) {
          setError(errorText(cause));
        }
      } finally {
        pending = false;
      }
    }
    function poll(): void {
      if (!alive) {
        return;
      }
      timer = setTimeout(() => {
        void refresh(true).finally(poll);
      }, 1000);
    }
    read.current = (): void => {
      void refresh();
    };
    void listen<WidgetRuntimeSnapshot>("widgets-runtime", (event) => receive(event.payload))
      .then(async (cleanup) => {
        if (!alive) {
          cleanup();
          return;
        }
        unlisten = cleanup;
        await refresh();
        poll();
      })
      .catch((cause: unknown) => {
        if (alive) {
          setError(errorText(cause));
        }
      });
    async function subscribeFocus(): Promise<void> {
      const cleanup = await getCurrentWindow().onFocusChanged(({ payload }) => {
        if (payload) {
          void refresh(true);
        }
      });
      if (alive) {
        unfocus = cleanup;
      } else {
        cleanup();
      }
    }
    void subscribeFocus().catch(() => undefined);
    function visibility(): void {
      if (!document.hidden) {
        void refresh(true);
      }
    }
    document.addEventListener("visibilitychange", visibility);
    return () => {
      alive = false;
      read.current = (): void => undefined;
      clearTimeout(timer);
      unlisten?.();
      unfocus?.();
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [active]);
  return { snapshot, error, reload };
}
