import { useCallback, useEffect, useRef, useState } from "react";
import { command, errorText } from "../../hooks/useSnapshot";
import { record } from "../toolData";
import type { WidgetValue, WidgetView } from "../types";

export function useMusicRequest(widget: WidgetView): {
  busy: boolean;
  error: string | null;
  request: (action: string, value?: WidgetValue) => Promise<WidgetValue | undefined>;
  invoke: <T>(name: string, args: Record<string, unknown>) => Promise<{ value: T } | undefined>;
} {
  const context = `${widget.id}:${JSON.stringify(record(widget.data).config)}`;
  const current = useRef({ context, generation: 0 });
  const pending = useRef(false);
  const mounted = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (current.current.context !== context) {
      current.current = { context, generation: current.current.generation + 1 };
    }
    setError(null);
  }, [context]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const invoke = useCallback(
    async <T>(name: string, args: Record<string, unknown>): Promise<{ value: T } | undefined> => {
      if (pending.current) return undefined;
      pending.current = true;
      const requestedContext = context;
      const generation = current.current.generation;
      setBusy(true);
      setError(null);
      try {
        const result = await command<T>(name, args);
        return mounted.current &&
          current.current.context === requestedContext &&
          current.current.generation === generation
          ? { value: result }
          : undefined;
      } catch (cause: unknown) {
        if (
          mounted.current &&
          current.current.context === requestedContext &&
          current.current.generation === generation
        ) {
          setError(errorText(cause));
        }
        return undefined;
      } finally {
        pending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [context],
  );
  const request = useCallback(
    async (action: string, value: WidgetValue = null): Promise<WidgetValue | undefined> =>
      (
        await invoke<WidgetValue>("music_request", {
          id: widget.id,
          expectedRevision: widget.revision,
          action,
          value,
        })
      )?.value,
    [invoke, widget.id, widget.revision],
  );
  return { busy, error, request, invoke };
}
