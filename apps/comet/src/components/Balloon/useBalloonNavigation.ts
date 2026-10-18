import { useEffect, useRef, useState, type RefObject } from "react";
import type { Dispatch } from "../../types";
import { errorText } from "../../hooks/useSnapshot";
import type { BalloonView } from "./useConversationDraft";

type Leave = (name: string, args?: Record<string, unknown>) => Promise<boolean>;

/** Leaves the current view after saving its draft, ignoring results once another view replaced it. */
export function useBalloonNavigation({
  currentView,
  flushDraft,
  dispatch,
  setError,
}: {
  currentView: RefObject<BalloonView>;
  flushDraft: () => Promise<void>;
  dispatch: Dispatch;
  setError: (error: string | null) => void;
}): {
  navigating: boolean;
  navigatingRef: RefObject<boolean>;
  leave: Leave;
  openModelSettings: () => Promise<void>;
} {
  const [navigating, setNavigating] = useState(false);
  const navigatingRef = useRef(false);
  async function leave(name: string, args?: Record<string, unknown>): Promise<boolean> {
    if (navigatingRef.current) return false;
    navigatingRef.current = true;
    setNavigating(true);
    setError(null);
    const previousView = currentView.current;
    try {
      await flushDraft();
      if (currentView.current.identity !== previousView.identity) return false;
      await dispatch(
        name,
        name === "close_panel" && previousView.mode === "input" && previousView.sessionId
          ? { ...args, sessionId: previousView.sessionId }
          : args,
      );
      return true;
    } catch (cause) {
      if (currentView.current.identity === previousView.identity) setError(errorText(cause));
      return false;
    } finally {
      navigatingRef.current = false;
      setNavigating(false);
    }
  }
  async function openModelSettings(): Promise<void> {
    if (navigatingRef.current) return;
    navigatingRef.current = true;
    setNavigating(true);
    const previousView = currentView.current;
    try {
      await flushDraft();
      if (currentView.current.identity !== previousView.identity) return;
      await dispatch("set_settings_section", { section: "model" });
      if (currentView.current.identity !== previousView.identity) return;
      await dispatch("open_settings");
    } catch (cause) {
      if (currentView.current.identity === previousView.identity) setError(errorText(cause));
    } finally {
      navigatingRef.current = false;
      setNavigating(false);
    }
  }
  return { navigating, navigatingRef, leave, openModelSettings };
}

/** Escape closes the balloon unless a draft replacement confirmation owns it. */
export function useEscapeClose({
  closeCommand,
  dispatch,
  draftReplacement,
  leave,
}: {
  closeCommand: string;
  dispatch: Dispatch;
  draftReplacement: object | null;
  leave: Leave;
}): void {
  useEffect(() => {
    function close(event: globalThis.KeyboardEvent): void {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !event.isComposing &&
        !draftReplacement
      ) {
        event.preventDefault();
        void leave(closeCommand);
      }
    }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [closeCommand, dispatch, draftReplacement]);
}
