import { useEffect, useRef, type RefObject } from "react";
import type { ConversationSaveRequest } from "./ConversationSave";
import type { BalloonView, ConversationDraft } from "./useConversationDraft";

const IDLE_CLOSE_MS = 90_000;

/**
 * Folds an empty input conversation after 90 seconds without activity. Typing, composing,
 * open details, saving, a running reply or playback each hold the conversation open.
 */
export function useIdleClose({
  mode,
  sessionId,
  input,
  logOpen,
  latestUserOpen,
  saveRequest,
  responding,
  playing,
  pending,
  composing,
  draft,
  currentView,
  leave,
}: {
  mode: string | undefined;
  sessionId: string | undefined;
  input: string;
  logOpen: boolean;
  latestUserOpen: boolean;
  saveRequest: ConversationSaveRequest | null;
  responding: boolean;
  playing: boolean;
  pending: boolean;
  composing: RefObject<boolean>;
  draft: RefObject<ConversationDraft>;
  currentView: RefObject<BalloonView>;
  leave: (name: string, args?: Record<string, unknown>) => Promise<boolean>;
}): () => void {
  const lastActivity = useRef(Date.now());
  const idleBlocked = useRef(false);
  idleBlocked.current =
    responding ||
    playing ||
    pending ||
    logOpen ||
    latestUserOpen ||
    Boolean(saveRequest) ||
    input.length > 0;
  useEffect(() => {
    lastActivity.current = Date.now();
    if (
      mode !== "input" ||
      !sessionId ||
      input.length > 0 ||
      logOpen ||
      latestUserOpen ||
      saveRequest ||
      responding ||
      playing ||
      pending
    )
      return;
    const timer = setInterval(() => {
      if (
        Date.now() - lastActivity.current >= IDLE_CLOSE_MS &&
        !composing.current &&
        !idleBlocked.current &&
        draft.current.value.length === 0 &&
        currentView.current.mode === "input" &&
        currentView.current.sessionId === sessionId
      ) {
        lastActivity.current = Date.now();
        void leave("close_panel", { idle: true });
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [
    mode,
    sessionId,
    input,
    logOpen,
    latestUserOpen,
    saveRequest,
    responding,
    playing,
    pending,
  ]);
  return () => {
    lastActivity.current = Date.now();
  };
}
