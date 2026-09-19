import type { Snapshot } from "./types";
import CHARACTER_PACK from "../examples/character-packs/nadir-and-star-tail.comet-character.json";

export const PREVIEW_SNAPSHOT: Snapshot = {
  characters: {
    installed: CHARACTER_PACK.characters.map((definition, index) => ({
      id: index === 0 ? "builtin-a" : "builtin-b",
      packId: null,
      definition,
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
