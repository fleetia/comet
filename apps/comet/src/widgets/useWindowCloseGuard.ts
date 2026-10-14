import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { errorText, isDesktop } from "../hooks/useSnapshot";

export function useWindowCloseGuard(
  dirty: boolean,
  busy: boolean,
  close: () => Promise<void>,
): {
  confirmClose: boolean;
  closeError: string | null;
  requestClose: () => Promise<void>;
  keepEditing: () => void;
  discardAndClose: () => Promise<void>;
} {
  const [confirmClose, setConfirmClose] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const current = useRef({ dirty, busy, close });
  current.current = { dirty, busy, close };
  const mounted = useRef(true);
  const closing = useRef(false);
  async function discardAndClose(): Promise<void> {
    if (current.current.busy || closing.current) return;
    closing.current = true;
    setCloseError(null);
    try {
      await current.current.close();
      if (mounted.current) setConfirmClose(false);
    } catch (cause) {
      if (mounted.current) setCloseError(errorText(cause));
    } finally {
      closing.current = false;
    }
  }
  async function requestClose(): Promise<void> {
    if (current.current.busy) return;
    if (current.current.dirty) setConfirmClose(true);
    else await discardAndClose();
  }
  const request = useRef(requestClose);
  request.current = requestClose;
  useEffect(() => {
    mounted.current = true;
    let cleanup: (() => void) | undefined;
    if (isDesktop())
      void (async () => {
        try {
          const unlisten = await getCurrentWindow().onCloseRequested((event) => {
            if (current.current.dirty || current.current.busy) {
              event.preventDefault();
              void request.current();
            }
          });
          if (mounted.current) cleanup = unlisten;
          else unlisten();
        } catch (cause) {
          if (mounted.current) setCloseError(errorText(cause));
        }
      })();
    return () => {
      mounted.current = false;
      cleanup?.();
    };
  }, []);
  return {
    confirmClose,
    closeError,
    requestClose,
    keepEditing: () => setConfirmClose(false),
    discardAndClose,
  };
}
