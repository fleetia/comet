import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Snapshot } from "../types";
import { PREVIEW_SNAPSHOT } from "../previewSnapshot";

export { PREVIEW_SNAPSHOT };

export function isDesktop(): boolean {
  return isTauri();
}

export async function command<T = void>(name: string, args?: Record<string, unknown>): Promise<T> {
  if (!isDesktop()) {
    throw new Error(
      "브라우저는 화면 미리보기입니다. 실제 기능은 데스크톱 앱에서 사용할 수 있어요.",
    );
  }
  return invoke<T>(name, args);
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useSnapshot(): {
  snapshot: Snapshot | null;
  error: string | null;
  reload: () => void;
} {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(isDesktop() ? null : PREVIEW_SNAPSHOT);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!isDesktop()) {
      return;
    }
    let active = true;
    let receivedEvent = false;
    let unlisten: (() => void) | undefined;
    setError(null);
    void listen<Snapshot>("app-state", (event) => {
      receivedEvent = true;
      if (active) {
        setSnapshot(event.payload);
        setError(null);
      }
    })
      .then(async (cleanup) => {
        if (!active) {
          cleanup();
          return;
        }
        unlisten = cleanup;
        const initial = await command<Snapshot>("get_snapshot");
        if (active && !receivedEvent) {
          setSnapshot(initial);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(errorText(cause));
        }
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [revision]);
  return { snapshot, error, reload: () => setRevision((value) => value + 1) };
}
