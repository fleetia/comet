import { useCallback, useEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import type { WidgetShape } from "@comet/ui";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import desktopKinds from "../desktopKinds.json";

export type DesktopShape = WidgetShape;
export type DesktopLayout = {
  mode: "freeform" | "stack";
  order: string[];
  anchor: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  width: "narrow" | "normal" | "wide";
  overlapped: boolean;
  oneExpanded: boolean;
  pinned: string[];
  positions: Record<string, { x: number; y: number }>;
  shapes: Record<string, DesktopShape>;
  snapToGrid: boolean;
  showGuides: boolean;
  stackPosition?: { x: number; y: number } | null;
  stackHidden?: boolean;
};
export type DesktopState = DesktopLayout & { revision: number; editing: boolean };
export type LayoutSettings = Pick<
  DesktopLayout,
  | "mode"
  | "order"
  | "anchor"
  | "width"
  | "overlapped"
  | "oneExpanded"
  | "pinned"
  | "snapToGrid"
  | "showGuides"
>;

type DesktopKind = { width: number; height: number; appearance: boolean };
const KINDS: Record<string, DesktopKind> = desktopKinds;

export function desktopKind(kind: string): DesktopKind | undefined {
  return Object.hasOwn(KINDS, kind) ? KINDS[kind] : undefined;
}

export const DEFAULT_LAYOUT: DesktopLayout = {
  mode: "stack",
  order: [],
  anchor: "top-right",
  width: "normal",
  overlapped: true,
  oneExpanded: true,
  pinned: [],
  positions: {},
  shapes: {},
  snapToGrid: false,
  showGuides: true,
};

export function layoutSettings(layout: DesktopLayout): LayoutSettings {
  return {
    mode: layout.mode,
    order: layout.order,
    anchor: layout.anchor,
    width: layout.width,
    overlapped: layout.overlapped,
    oneExpanded: layout.oneExpanded,
    pinned: layout.pinned ?? [],
    snapToGrid: layout.snapToGrid,
    showGuides: layout.showGuides !== false,
  };
}

function isState(value: unknown): value is DesktopState {
  return typeof (value as DesktopState | null)?.revision === "number";
}

/**
 * Shared desktop layout state for the stack, display and editor windows.
 * Every change goes through one queue so `configure` always sends the newest revision.
 */
export function useDesktopState(): {
  state: DesktopState | null;
  error: string | null;
  setError: (error: string | null) => void;
  busy: boolean;
  selected: string | null;
  select: (id: string | null) => void;
  run: (name: string, args?: Record<string, unknown>) => Promise<DesktopState | null>;
  configure: (patch: Partial<LayoutSettings>) => Promise<DesktopState | null>;
  restore: () => Promise<DesktopState | null>;
} {
  const [state, setState] = useState<DesktopState | null>(() =>
    isDesktop() ? null : { ...DEFAULT_LAYOUT, revision: 0, editing: false },
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const latest = useRef<DesktopState | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const receive = useCallback((next: unknown): DesktopState | null => {
    if (!isState(next)) return latest.current;
    if (latest.current && next.revision < latest.current.revision) return latest.current;
    latest.current = next;
    setState(next);
    return next;
  }, []);

  useEffect(() => {
    if (!isDesktop()) return;
    let alive = true;
    const cleanups: (() => void)[] = [];
    for (const subscription of [
      listen<DesktopState>("widget-desktop-state", (event) => {
        if (alive) receive(event.payload);
      }),
      listen<boolean>("widget-desktop-editing", (event) => {
        if (!alive || !latest.current) return;
        latest.current = { ...latest.current, editing: event.payload };
        setState(latest.current);
      }),
      listen<string | null>("widget-desktop-selection", (event) => {
        if (alive) setSelected(event.payload ?? null);
      }),
    ])
      void subscription
        .then((cleanup) => {
          if (alive) cleanups.push(cleanup);
          else cleanup();
        })
        .catch((cause: unknown) => {
          if (alive) setError(errorText(cause));
        });
    void command<DesktopState>("get_widget_desktop")
      .then((next) => {
        if (alive) receive(next);
      })
      .catch((cause: unknown) => {
        if (alive) setError(errorText(cause));
      });
    return () => {
      alive = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [receive]);

  const serialized = useCallback(
    (task: () => Promise<DesktopState | null>): Promise<DesktopState | null> => {
      if (!isDesktop()) {
        setError("미리보기에서는 바탕화면 위젯 배치를 저장하지 않아요.");
        return Promise.resolve(null);
      }
      setPending((count) => count + 1);
      const result = queue.current.then(async () => {
        setError(null);
        try {
          return await task();
        } catch (cause: unknown) {
          setError(errorText(cause));
          return null;
        } finally {
          setPending((count) => count - 1);
        }
      });
      queue.current = result;
      return result;
    },
    [],
  );

  const run = useCallback(
    (name: string, args?: Record<string, unknown>) =>
      serialized(async () => receive(await command<DesktopState>(name, args))),
    [receive, serialized],
  );

  const configure = useCallback(
    (patch: Partial<LayoutSettings>) =>
      serialized(async () => {
        const attempt = (base: DesktopState): Promise<DesktopState> =>
          command<DesktopState>("configure_widget_desktop", {
            expectedRevision: base.revision,
            input: { ...layoutSettings(base), ...patch },
          });
        const base = latest.current ?? receive(await command<DesktopState>("get_widget_desktop"));
        if (!base) return null;
        try {
          return receive(await attempt(base));
        } catch {
          // Another window saved first: retry once on the newest revision.
          const fresh = receive(await command<DesktopState>("get_widget_desktop"));
          return fresh ? receive(await attempt(fresh)) : null;
        }
      }),
    [receive, serialized],
  );

  const restore = useCallback(
    () =>
      serialized(async () => {
        const layout = await command<DesktopLayout | null>("get_widget_desktop_snapshot");
        if (!layout) throw new Error("되돌릴 편집 시작 배치가 없어요.");
        const base = latest.current ?? receive(await command<DesktopState>("get_widget_desktop"));
        if (!base) return null;
        return receive(
          await command<DesktopState>("restore_widget_desktop", {
            expectedRevision: base.revision,
            layout,
          }),
        );
      }),
    [receive, serialized],
  );

  const select = useCallback((id: string | null) => {
    setSelected(id);
    if (isDesktop())
      void emit("widget-desktop-selection", id).catch((cause: unknown) =>
        setError(errorText(cause)),
      );
  }, []);

  return {
    state,
    error,
    setError,
    busy: pending > 0,
    selected: state?.editing ? selected : null,
    select,
    run,
    configure,
    restore,
  };
}
