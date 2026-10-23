import { useEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { command, errorText, isDesktop } from "../hooks/useSnapshot";

type WindowState = { generation: number; active: boolean };

/** Keep the native GTK view, not its closed editors or subscriptions. */
export function PlanningWindow({
  label,
  children,
}: {
  label: "planner" | "travel";
  children: (close: () => void) => ReactNode;
}) {
  const [state, setState] = useState<WindowState | null>(
    isDesktop() ? null : { generation: 0, active: true },
  );
  const current = useRef(state);
  const [closing, setClosing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  function receive(next: WindowState): void {
    if (!alive.current || (current.current && next.generation < current.current.generation)) return;
    if (current.current?.generation === next.generation && !current.current.active && next.active)
      return;
    current.current = next;
    setState(next);
    setClosing(null);
  }
  useEffect(() => {
    alive.current = true;
    if (!isDesktop()) return;
    let active = true;
    let received = false;
    let unlisten: (() => void) | undefined;
    void listen<WindowState & { label: string }>(
      "planning-window-state",
      ({ payload }) => {
        if (!active || payload.label !== label) return;
        received = true;
        receive(payload);
      },
      { target: { kind: "WebviewWindow", label } },
    )
      .then(async (cleanup) => {
        if (!active) {
          cleanup();
          return;
        }
        unlisten = cleanup;
        const initial = await command<WindowState>("get_planning_window_state");
        if (active && !received) receive(initial);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
      alive.current = false;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    if (closing === null || !isDesktop()) return;
    // This effect runs after the editor subtree has unmounted and cleaned up.
    const generation = closing;
    void command<WindowState>("release_planning_window", { generation })
      .then((next) => {
        if (current.current?.generation === generation && next.generation === generation)
          receive(next);
      })
      .catch((cause: unknown) => {
        if (!alive.current || current.current?.generation !== generation) return;
        setError(errorText(cause));
        setClosing(null);
      });
  }, [closing]);
  function close(): void {
    if (isDesktop() && current.current?.active) {
      setError(null);
      setClosing(current.current.generation);
    }
  }
  return (
    <>
      {error && <p role="alert">{error}</p>}
      {state?.active && closing === null ? children(close) : null}
    </>
  );
}
