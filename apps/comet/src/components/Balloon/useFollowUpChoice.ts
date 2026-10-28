import { useEffect, useRef, useState } from "react";
import type { Dispatch, FollowUpRequest } from "../../types";
import { errorText } from "../../hooks/useSnapshot";

export function useFollowUpChoice(request: FollowUpRequest | null | undefined, dispatch: Dispatch) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const currentId = useRef(request?.requestId);
  currentId.current = request?.requestId;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setPending(false);
    setError(null);
  }, [request?.requestId]);

  useEffect(() => {
    if (!request) return;
    const { requestId, sessionId } = request;
    const channel =
      typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("comet-follow-ups");
    let timer: ReturnType<typeof setTimeout>;
    let lastBroadcast = 0;
    function reset(): void {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void dispatch("dismiss_follow_ups", { sessionId, requestId }).catch((cause: unknown) => {
          if (alive.current && currentId.current === requestId) setError(errorText(cause));
        });
      }, 90_000);
    }
    function activity(): void {
      reset();
      if (Date.now() - lastBroadcast >= 1000) {
        lastBroadcast = Date.now();
        channel?.postMessage(requestId);
      }
    }
    if (channel)
      channel.onmessage = (event) => {
        if (event.data === requestId) reset();
      };
    const events = ["pointermove", "pointerdown", "keydown", "focusin", "wheel"] as const;
    events.forEach((event) => document.addEventListener(event, activity));
    reset();
    return () => {
      clearTimeout(timer);
      events.forEach((event) => document.removeEventListener(event, activity));
      channel?.close();
    };
  }, [request?.requestId, request?.sessionId, dispatch]);

  async function choose(optionId: string): Promise<void> {
    if (!request || lock.current) return;
    const requestId = request.requestId;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      await dispatch("choose_follow_up", { requestId, optionId });
    } catch (cause) {
      if (alive.current && currentId.current === requestId) setError(errorText(cause));
    } finally {
      lock.current = false;
      if (alive.current && currentId.current === requestId) setPending(false);
    }
  }
  return { pending, error, choose };
}
