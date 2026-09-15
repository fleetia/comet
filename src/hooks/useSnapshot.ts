import { useEffect, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Snapshot } from "../types";

export const PREVIEW_SNAPSHOT: Snapshot = {
  characters: {
    installed: [
      {
        id: "builtin-a",
        packId: null,
        definition: {
          sourceId: "comet.a",
          version: 1,
          name: "A",
          description: "호기심이 많은 바탕화면 친구",
          personality: "호기심이 많고 다정하며 먼저 말을 건넨다.",
          expressions: { 평온: "평온", 기쁨: "기쁨", 호기심: "호기심", 생각중: "생각중", 걱정: "걱정", 장난: "장난" },
          greeting: [{ expression: "기쁨", text: "안녕. 오늘도 여기서 같이 지내자." }],
          idleLines: [{ expression: "호기심", text: "잠깐 쉬어 갈까?" }],
        },
      },
      {
        id: "builtin-b",
        packId: null,
        definition: {
          sourceId: "comet.b",
          version: 1,
          name: "B",
          description: "차분한 바탕화면 친구",
          personality: "차분하고 간결하며 가끔 부드러운 농담을 한다.",
          expressions: { 평온: "평온", 기쁨: "기쁨", 호기심: "호기심", 생각중: "생각중", 걱정: "걱정", 장난: "장난" },
          greeting: [{ expression: "평온", text: "계속 대답해 주지는 않아도 돼." }],
          idleLines: [{ expression: "평온", text: "좋아. 잠깐이면 충분하지." }],
        },
      },
    ],
    active: ["builtin-a", "builtin-b"],
  },
  messageIdentities: [],
  playback: null,
  panel: null,
  wordbook: [],
  settings: {
    mode: "local",
    autonomousEnabled: true,
    localModel: "qwen3.5-4b",
    baseUrl: "https://api.openai.com/v1",
    apiModel: "",
    apiTokenParameter: "max_tokens",
    localIdleEnabled: true,
    apiIdleEnabled: false,
    idleMinutes: 2,
  },
  messages: [],
  memories: [],
  relationships: [
    { persona: "a", score: 20 },
    { persona: "b", score: 20 },
  ],
  preparedCount: 0,
  runtime: {
    phase: "idle",
    persona: null,
    error: null,
    download: null,
    hidden: false,
    paused: false,
  },
  hasApiKey: false,
  modelReady: false,
  localModels: [
    { id: "qwen3.5-4b", name: "Qwen3.5-4B", size: 2740937888, ready: false, downloadedBytes: 0 },
    { id: "qwen3.5-9b", name: "Qwen3.5-9B", size: 5680522464, ready: false, downloadedBytes: 0 },
  ],
};

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
