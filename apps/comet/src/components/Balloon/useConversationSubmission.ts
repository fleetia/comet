import { useEffect, useRef, useState, type RefObject } from "react";
import type { ActiveRequest, Dispatch, Message, Persona, Snapshot } from "../../types";
import { errorText } from "../../hooks/useSnapshot";
import type { BalloonView, ConversationDraft } from "./useConversationDraft";

type Submission = { id: string; content: string };

/**
 * Sends, retries and cancels conversation turns. Each result applies only while the draft,
 * view, recovery marker or request epoch it started from is still current.
 */
export function useConversationSubmission({
  user,
  activeRequest,
  input,
  setInput,
  target,
  draft,
  currentView,
  dispatch,
  flushDraft,
  persistDraft,
  navigatingRef,
  setError,
  responding,
  playing,
  canRetry,
  latestUser,
}: {
  user: Snapshot["user"];
  activeRequest: ActiveRequest | undefined;
  input: string;
  setInput: (value: string) => void;
  target: Persona | "all";
  draft: RefObject<ConversationDraft>;
  currentView: RefObject<BalloonView>;
  dispatch: Dispatch;
  flushDraft: () => Promise<void>;
  persistDraft: () => Promise<void>;
  navigatingRef: RefObject<boolean>;
  setError: (error: string | null) => void;
  responding: boolean;
  playing: boolean;
  canRetry: boolean;
  latestUser: Message | undefined;
}): {
  pending: boolean;
  failedSubmission: Submission | null;
  failureRevision: number;
  lastSubmission: RefObject<Submission | null>;
  forgetSubmission: () => void;
  clearFailedSubmission: () => void;
  perform: (name: string, args?: Record<string, unknown>) => Promise<boolean>;
  send: () => Promise<void>;
  retry: () => Promise<void>;
  cancelGeneration: () => Promise<void>;
} {
  const [pending, setPending] = useState(false);
  const [failureRevision, setFailureRevision] = useState(0);
  const [failedSubmission, setFailedSubmission] = useState<Submission | null>(null);
  const submitting = useRef(false);
  const currentRequestEpoch = useRef(activeRequest?.epoch);
  currentRequestEpoch.current = activeRequest?.epoch;
  const lastSubmission = useRef<Submission | null>(null);
  function forgetSubmission(): void {
    setFailedSubmission(null);
    lastSubmission.current = null;
  }
  async function perform(name: string, args?: Record<string, unknown>): Promise<boolean> {
    setError(null);
    try {
      await dispatch(name, args);
      return true;
    } catch (cause) {
      setError(errorText(cause));
      setFailureRevision((revision) => revision + 1);
      return false;
    }
  }
  async function cancelGeneration(): Promise<void> {
    const request = activeRequest;
    if (!request || submitting.current) return;
    submitting.current = true;
    setPending(true);
    const previousView = currentView.current;
    try {
      await dispatch("cancel_generation", { request });
    } catch (cause) {
      if (
        currentView.current.identity === previousView.identity &&
        currentRequestEpoch.current === request.epoch
      ) {
        setError(errorText(cause));
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  async function retry(): Promise<void> {
    if (!canRetry || !latestUser || submitting.current || navigatingRef.current) return;
    submitting.current = true;
    setPending(true);
    setError(null);
    const previousView = currentView.current;
    try {
      await flushDraft();
      if (
        currentView.current.identity !== previousView.identity ||
        currentView.current.recoveryId !== latestUser.id
      )
        return;
      await dispatch("retry_turn", { messageId: latestUser.id, target: latestUser.persona });
    } catch (cause) {
      if (
        currentView.current.identity === previousView.identity &&
        currentView.current.recoveryId === latestUser.id
      ) {
        setError(errorText(cause));
        setFailureRevision((revision) => revision + 1);
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  async function send(): Promise<void> {
    if (
      !user ||
      !input.trim() ||
      submitting.current ||
      responding ||
      playing ||
      navigatingRef.current
    ) {
      return;
    }
    submitting.current = true;
    setPending(true);
    setError(null);
    setFailedSubmission(null);
    const submittedDraft = draft.current;
    const submittedValue = input;
    const submittedView = currentView.current.identity;
    const clientMessageId = crypto.randomUUID();
    try {
      await flushDraft();
      if (draft.current !== submittedDraft || currentView.current.identity !== submittedView)
        return;
      lastSubmission.current = { id: clientMessageId, content: submittedValue };
      await dispatch("send_message", {
        content: input.trim(),
        target,
        clientMessageId,
        ...(submittedDraft.sessionId ? { sessionId: submittedDraft.sessionId } : {}),
      });
      if (draft.current === submittedDraft) {
        submittedDraft.saved = "";
        if (submittedDraft.value === submittedValue) {
          submittedDraft.value = "";
          setInput("");
        } else {
          await persistDraft();
        }
      }
    } catch (cause) {
      if (draft.current === submittedDraft) {
        setFailedSubmission({ id: clientMessageId, content: submittedValue });
        setError(errorText(cause));
        setFailureRevision((revision) => revision + 1);
      }
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }
  return {
    pending,
    failedSubmission,
    failureRevision,
    lastSubmission,
    forgetSubmission,
    clearFailedSubmission: () => setFailedSubmission(null),
    perform,
    send,
    retry,
    cancelGeneration,
  };
}

type DraftReplacement = {
  identity: string;
  messageId: string;
  content: string;
  previousDraft: string;
};

/**
 * Brings an interrupted input back into the editor. A different draft is replaced only after
 * confirmation, and the confirmation is dropped once the view, input or reply state changes.
 */
export function useDraftReplacement({
  viewIdentity,
  latestUser,
  latestInputContent,
  responding,
  playing,
  canRetry,
  pending,
  navigating,
  draft,
  currentView,
  setInput,
  inputRef,
}: {
  viewIdentity: string;
  latestUser: Message | undefined;
  latestInputContent: string | undefined;
  responding: boolean;
  playing: boolean;
  canRetry: boolean;
  pending: boolean;
  navigating: boolean;
  draft: RefObject<ConversationDraft>;
  currentView: RefObject<BalloonView>;
  setInput: (value: string) => void;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}): {
  draftReplacement: DraftReplacement | null;
  dismissDraftReplacement: () => void;
  editFailedInput: () => void;
  replaceDraft: () => void;
} {
  const [draftReplacement, setDraftReplacement] = useState<DraftReplacement | null>(null);
  useEffect(() => {
    setDraftReplacement(null);
  }, [viewIdentity, latestUser?.id, responding, playing]);
  function editFailedInput(): void {
    if (!canRetry || !latestUser || latestInputContent === undefined || pending || navigating)
      return;
    if (draft.current.value && draft.current.value !== latestInputContent) {
      setDraftReplacement({
        identity: viewIdentity,
        messageId: latestUser.id,
        content: latestInputContent,
        previousDraft: draft.current.value,
      });
      return;
    }
    draft.current.value = latestInputContent;
    setInput(latestInputContent);
    inputRef.current?.focus();
  }
  function replaceDraft(): void {
    if (!draftReplacement) return;
    setDraftReplacement(null);
    if (
      !canRetry ||
      pending ||
      navigating ||
      currentView.current.identity !== draftReplacement.identity ||
      currentView.current.recoveryId !== draftReplacement.messageId ||
      draft.current.value !== draftReplacement.previousDraft
    )
      return;
    draft.current.value = draftReplacement.content;
    setInput(draftReplacement.content);
    window.requestAnimationFrame(() => {
      if (
        currentView.current.identity === draftReplacement.identity &&
        currentView.current.recoveryId === draftReplacement.messageId
      ) {
        inputRef.current?.focus();
      }
    });
  }
  return {
    draftReplacement,
    dismissDraftReplacement: () => setDraftReplacement(null),
    editFailedInput,
    replaceDraft,
  };
}
