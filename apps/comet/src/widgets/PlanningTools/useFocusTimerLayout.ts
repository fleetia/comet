import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from "react";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { WidgetView } from "../types";
import type { FocusTimerState } from "./focusTimerState";
import type { FocusTimerContextState } from "./useFocusTimerContext";

export type FocusTimerLayoutState = {
  expanded: boolean;
  setExpanded: Dispatch<SetStateAction<boolean>>;
  collapsed: boolean;
  setCollapsed: Dispatch<SetStateAction<boolean>>;
  resizeWidth: number | null;
  setResizeWidth: Dispatch<SetStateAction<number | null>>;
  resizing: RefObject<boolean>;
  context: RefObject<HTMLElement | null>;
  host: RefObject<HTMLElement | null>;
  layout: RefObject<HTMLDivElement | null>;
  lastFit: RefObject<{ key: string; height: number } | null>;
};

export type FocusTimerLayout = FocusTimerLayoutState & {
  resize: (nextExpanded: boolean, nextCollapsed?: boolean) => Promise<void>;
  expand: () => Promise<void>;
};

export function useFocusTimerLayoutState(embedded: boolean): FocusTimerLayoutState {
  const [expanded, setExpanded] = useState(!embedded);
  const [collapsed, setCollapsed] = useState(false);
  const [resizeWidth, setResizeWidth] = useState<number | null>(null);
  const resizing = useRef(false);
  const context = useRef<HTMLElement>(null);
  const host = useRef<HTMLElement>(null);
  const layout = useRef<HTMLDivElement>(null);
  const lastFit = useRef<{ key: string; height: number } | null>(null);
  return {
    expanded,
    setExpanded,
    collapsed,
    setCollapsed,
    resizeWidth,
    setResizeWidth,
    resizing,
    context,
    host,
    layout,
    lastFit,
  };
}

export function useFocusTimerLayout(
  widget: WidgetView,
  embedded: boolean,
  active: boolean,
  state: FocusTimerLayoutState,
  panel: FocusTimerContextState,
  phase: FocusTimerState["phase"],
  setError: Dispatch<SetStateAction<string>>,
): FocusTimerLayout {
  const {
    expanded,
    setExpanded,
    collapsed,
    setCollapsed,
    resizeWidth,
    setResizeWidth,
    resizing,
    context,
    host,
    layout,
    lastFit,
  } = state;
  const { tab, usagePickerOpen } = panel;
  async function resize(nextExpanded: boolean, nextCollapsed = false): Promise<void> {
    if (resizing.current) return;
    const animate = !(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    resizing.current = true;
    setResizeWidth(556);
    setExpanded(nextExpanded);
    setCollapsed(nextCollapsed);
    setError("");
    try {
      if (isDesktop() && !embedded) {
        const timerHeight =
          phase === "ready"
            ? 464
            : phase === "complete"
              ? 423
              : phase === "rest"
                ? 383
                : phase === "rest-complete"
                  ? 376
                  : 455;
        await command("set_focus_expanded", {
          id: widget.id,
          expanded: nextExpanded,
          collapsed: nextCollapsed,
          height: nextCollapsed
            ? 56
            : nextExpanded
              ? Math.max(tab === "notes" ? 547 : 580, timerHeight)
              : timerHeight,
          animate,
        });
      } else if (animate) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 280));
      }
    } catch (cause: unknown) {
      setExpanded(expanded);
      setCollapsed(collapsed);
      setError(errorText(cause));
    } finally {
      resizing.current = false;
      setResizeWidth(null);
    }
  }
  function expand(): Promise<void> {
    return resize(!expanded);
  }
  useEffect(() => {
    if (!active || embedded || collapsed || !isDesktop() || typeof ResizeObserver === "undefined")
      return;
    const element = layout.current;
    if (!element) return;
    let alive = true;
    let scheduled: number | undefined;
    function fit(): void {
      if (!alive || resizing.current || !element || !host.current) return;
      const offset = element.getBoundingClientRect().top - host.current.getBoundingClientRect().top;
      const height = Math.ceil(
        Math.max(
          expanded ? (tab === "notes" ? 547 : 580) : 376,
          offset + host.current.scrollTop + element.scrollHeight,
        ),
      );
      const key = `${widget.id}:${expanded}:${height}`;
      const allocated = lastFit.current;
      const canShrink = allocated && Math.abs(window.innerHeight - allocated.height) < 2;
      if (
        height === window.innerHeight ||
        (height < window.innerHeight && !canShrink) ||
        allocated?.key === key
      )
        return;
      lastFit.current = { key, height };
      void command("set_focus_expanded", {
        id: widget.id,
        expanded,
        collapsed: false,
        height,
        animate: false,
        autoFit: true,
      }).catch((cause: unknown) => {
        if (alive) setError(errorText(cause));
      });
    }
    const schedule = (): void => {
      if (scheduled !== undefined) window.clearTimeout(scheduled);
      scheduled = window.setTimeout(fit, 0);
    };
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    if (context.current) observer.observe(context.current);
    schedule();
    return () => {
      alive = false;
      observer.disconnect();
      if (scheduled !== undefined) window.clearTimeout(scheduled);
    };
  }, [active, embedded, collapsed, expanded, tab, phase, usagePickerOpen, resizeWidth, widget.id]);
  return { ...state, resize, expand };
}
