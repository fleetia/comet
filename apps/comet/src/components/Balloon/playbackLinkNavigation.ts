import { emitTo, listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import { errorText, isDesktop } from "../../hooks/useSnapshot";

type Request = {
  requestId: string;
  playbackId: string;
  sessionId: string;
  userId: string;
  expiresAt: number;
};
type Response = { requestId: string; status: "accepted" | "done" | "error"; message?: string };
const REQUEST = "playback-link-request";
const RESPONSE = "playback-link-response";

export async function requestPlaybackLink(
  target: "conversation-input" | "conversation-history",
  playbackId: string,
  sessionId: string,
  userId: string,
): Promise<void> {
  const requestId = crypto.randomUUID();
  const expiresAt = Date.now() + 10000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unlisten: (() => void) | undefined;
  let expired = false;
  try {
    await new Promise<void>((resolve, reject) => {
      const expire = (message: string, delay: number) => {
        clearTimeout(timer);
        timer = setTimeout(() => {
          expired = true;
          reject(new Error(message));
        }, delay);
      };
      expire("대화 입력창을 확인하지 못했어요. 다시 눌러 주세요.", 10000);
      void listen<Response>(
        RESPONSE,
        (event) => {
          if (event.payload.requestId !== requestId) return;
          // An input window that accepts and then closes must not leave the click pending forever.
          if (event.payload.status === "accepted")
            expire("위젯을 열지 못했어요. 다시 눌러 주세요.", 30000);
          else if (event.payload.status === "done") resolve();
          else reject(new Error(event.payload.message || "위젯을 열지 못했어요."));
        },
        { target: getCurrentWindow().label },
      )
        .then((cleanup) => {
          if (expired) {
            cleanup();
            return;
          }
          unlisten = cleanup;
          return emitTo(target, REQUEST, {
            requestId,
            playbackId,
            sessionId,
            userId,
            expiresAt,
          } satisfies Request);
        })
        .catch(reject);
    });
  } finally {
    clearTimeout(timer);
    unlisten?.();
  }
}

export function usePlaybackLinkRequests(
  enabled: boolean,
  handle: (request: Request) => Promise<void>,
): void {
  const handler = useRef(handle);
  handler.current = handle;
  useEffect(() => {
    if (!enabled || !isDesktop()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    void listen<Request>(
      REQUEST,
      (event) => {
        const request = event.payload;
        if (!active || Date.now() >= request.expiresAt) return;
        void (async () => {
          try {
            await emitTo("balloon", RESPONSE, {
              requestId: request.requestId,
              status: "accepted",
            } satisfies Response);
            if (Date.now() >= request.expiresAt)
              throw new Error("대화 입력창 응답이 늦어졌어요. 다시 눌러 주세요.");
            await handler.current(request);
            await emitTo("balloon", RESPONSE, {
              requestId: request.requestId,
              status: "done",
            } satisfies Response);
          } catch (cause) {
            await emitTo("balloon", RESPONSE, {
              requestId: request.requestId,
              status: "error",
              message: errorText(cause),
            } satisfies Response).catch(() => {});
          }
        })();
      },
      { target: getCurrentWindow().label },
    )
      .then((cleanup) => {
        if (active) unlisten = cleanup;
        else cleanup();
      })
      .catch(() => {});
    return () => {
      active = false;
      unlisten?.();
    };
  }, [enabled]);
}
