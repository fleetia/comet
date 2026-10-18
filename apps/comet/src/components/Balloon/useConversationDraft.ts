import { useEffect, useRef, type RefObject } from "react";
import type { Dispatch } from "../../types";
import { errorText } from "../../hooks/useSnapshot";

/** The view that async work started from; work is dropped once a newer view replaces it. */
export type BalloonView = {
  identity: string;
  mode: string | undefined;
  sessionId: string | undefined;
  userId: string | undefined;
  recoveryId: string | undefined;
};

export type ConversationDraft = {
  userId: string | undefined;
  sessionId: string | undefined;
  value: string;
  saved: string;
};

type SaveTimer = RefObject<ReturnType<typeof setTimeout> | undefined>;

export function useDraftPersistence({
  draft,
  currentView,
  dispatch,
}: {
  draft: RefObject<ConversationDraft>;
  currentView: RefObject<BalloonView>;
  dispatch: Dispatch;
}): {
  saveTimer: SaveTimer;
  persistDraft: (current?: ConversationDraft) => Promise<void>;
  flushDraft: () => Promise<void>;
} {
  const saveQueue = useRef(Promise.resolve());
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  function persistDraft(current = draft.current): Promise<void> {
    const value = current.value;
    const task = saveQueue.current.then(async () => {
      if (
        !current.sessionId ||
        current.userId !== currentView.current.userId ||
        current.saved === value
      )
        return;
      await dispatch("save_conversation_draft", {
        sessionId: current.sessionId,
        draft: value,
        inputOwner: "desktop",
      });
      current.saved = value;
    });
    saveQueue.current = task.catch(() => {});
    return task;
  }
  async function flushDraft(): Promise<void> {
    clearTimeout(saveTimer.current);
    await persistDraft();
  }
  return { saveTimer, persistDraft, flushDraft };
}

/** Saves typed text after a pause and saves the leaving session's draft on unmount or switch. */
export function useDraftAutosave({
  draft,
  input,
  mode,
  sessionId,
  userId,
  currentView,
  saveTimer,
  persistDraft,
  setError,
}: {
  draft: RefObject<ConversationDraft>;
  input: string;
  mode: string | undefined;
  sessionId: string | undefined;
  userId: string | undefined;
  currentView: RefObject<BalloonView>;
  saveTimer: SaveTimer;
  persistDraft: (current?: ConversationDraft) => Promise<void>;
  setError: (error: string | null) => void;
}): void {
  useEffect(() => {
    if (mode !== "input" || !sessionId || input === draft.current.saved) return;
    saveTimer.current = setTimeout(() => {
      void persistDraft().catch((cause: unknown) => setError(errorText(cause)));
    }, 400);
    return () => clearTimeout(saveTimer.current);
  }, [input, sessionId, mode]);
  useEffect(() => {
    if (mode !== "input") return;
    // Capture the draft after the session switch replaced it, so leaving saves this session.
    const current = draft.current;
    return () => {
      void persistDraft(current).catch((cause: unknown) => {
        if (current.userId === currentView.current.userId) setError(errorText(cause));
      });
    };
  }, [sessionId, mode, userId]);
}
