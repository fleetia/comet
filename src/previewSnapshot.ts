import type { LocalModel, Snapshot } from "./types";
import CHARACTER_PACK from "../src-tauri/content/default.comet-character.json";

export const PREVIEW_SNAPSHOT: Snapshot = {
  characters: {
    installed: CHARACTER_PACK.characters.map((definition, index) => ({
      id: index === 0 ? "builtin-a" : "builtin-b",
      packId: null,
      definition: { ...definition, faceIcon: false, spriteSize: 64 },
      sprites: {},
    })),
    active: ["builtin-a", "builtin-b"],
  },
  messageIdentities: [],
  playback: null,
  story: null,
  panel: null,
  wordbook: [],
  settings: {
    mode: "local",
    autonomousEnabled: true,
    localModel: "qwen3.5-4b",
    localModelPath: "",
    baseUrl: "https://api.openai.com/v1",
    apiModel: "",
    apiTokenParameter: "max_tokens",
    localIdleEnabled: false,
    apiIdleEnabled: false,
    idleMinutes: 2,
  },
  messages: [],
  memoryCount: 0,
  memoryRevision: 0,
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
  localModels: (
    [
      ["qwen3.5-4b", "Qwen3.5-4B", "기본 · 가벼운 모델", 2740937888],
      ["qwen3.5-9b", "Qwen3.5-9B", "메모리를 더 사용하는 모델", 5680522464],
      ["qwen3.8-2b-distill", "Qwen3.8-2B-Distill", "가장 가벼운 실험용", 1312164224],
      ["qwen3.8-4b-distill", "Qwen3.8-4B-Distill", "상시 구동 후보", 2783446304],
      ["qwen3.8-9b-distill", "Qwen3.8-9B-Distill", "Qwen 계열 품질 상한", 5780090176],
      ["gemma-4-e4b", "Gemma 4 E4B", "Qwen 외 4B급 비교용", 4977171584],
      ["gemma-4-12b", "Gemma 4 12B", "고품질 비교용 · 메모리 많이 사용", 7121861440],
      ["ministral-3-8b", "Ministral 3 8B", "Mistral 계열 비교용", 5198386720],
    ] satisfies [LocalModel, string, string, number][]
  ).map(([id, name, description, size]) => ({
    id,
    name,
    description,
    size,
    ready: false,
    downloadedBytes: 0,
  })),
};
