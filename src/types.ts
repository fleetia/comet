export type Persona = string;
export const CHARACTER_SLOTS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
export type CharacterLine = { expression: string; text: string };
export type CharacterDefinition = {
  sourceId: string;
  version: number;
  name: string;
  description: string;
  personality: string;
  expressions: Record<string, string>;
  faceIcon: boolean;
  spriteSize: number;
  greeting: CharacterLine[];
  idleLines: CharacterLine[];
};
export type SpriteInfo = { mime: string; updatedAt: number };
export type InstalledCharacter = {
  id: string;
  packId: string | null;
  definition: CharacterDefinition;
  sprites: Record<string, SpriteInfo>;
};
export type CharacterCollection = { installed: InstalledCharacter[]; active: string[] };
export type InstalledCharacterPack = { id: string; name: string; characterIds: string[] };
export type CharacterDialogue = { pairScenes: SceneLine[][]; wordbook: WordbookEntry[] };
export type PackSprite = { sourceId: string; expression: string; mime: string; data: string };
export type CharacterPack = {
  formatVersion: 1 | 2;
  name: string;
  author: string;
  sourceUrl?: string;
  license: string;
  characters: CharacterDefinition[];
  pairScenes: SceneLine[][];
  wordbook: WordbookEntry[];
  sprites?: PackSprite[];
};
export type MessageIdentity = {
  messageId: string;
  persona: Persona;
  characterId: string;
  name: string;
  version: number;
};
export type SceneLine = { persona: Persona; expression: string; text: string };
export type WordbookEntry = {
  id: string;
  title: string;
  keywords: string[];
  lines: SceneLine[];
  enabled: boolean;
  useForIdle: boolean;
};
export type Playback = SceneLine & {
  id: string;
  source: "script" | "llm" | "wordbook" | "widget" | "talk" | "story" | "question";
  endsAt: number;
  lineIndex: number;
  lineCount: number;
};
export type StoryRequest = {
  id: string;
  persona: Persona;
  title: string;
  prompt: string;
  choices: { id: string; label: string }[];
};
export type PanelState = { persona: Persona; mode: "menu" | "input" | "history" };
export type Dispatch = (name: string, args?: Record<string, unknown>) => Promise<void>;
export type LocalModel =
  | "qwen3.5-4b"
  | "qwen3.5-9b"
  | "qwen3.8-2b-distill"
  | "qwen3.8-4b-distill"
  | "qwen3.8-9b-distill"
  | "gemma-4-e4b"
  | "gemma-4-12b"
  | "ministral-3-8b"
  | "custom";
export type LocalModelStatus = {
  id: LocalModel;
  name: string;
  description: string;
  size: number;
  ready: boolean;
  downloadedBytes: number;
};
export type LocalModelTest = { reply: string; elapsedMs: number };
export type Settings = {
  mode: "local" | "api";
  autonomousEnabled: boolean;
  localModel: LocalModel;
  localModelPath: string;
  baseUrl: string;
  apiModel: string;
  apiTokenParameter: "max_tokens" | "max_completion_tokens";
  localIdleEnabled: boolean;
  apiIdleEnabled: boolean;
  idleMinutes: number;
};
export type Message = {
  id: string;
  role: string;
  persona: string | null;
  content: string;
  expression: string | null;
  createdAt: number;
  status: string;
};
export type Memory = { id: string; content: string; sourceMessageId: string; updatedAt: number };
export type TalkPack = {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  bundled: boolean;
  defaultInstalled: boolean;
};
export type Relationship = { persona: string; score: number };
export type RuntimeStatus = {
  phase: string;
  persona: string | null;
  error: string | null;
  download: {
    model: LocalModel;
    received: number;
    total: number;
    status: string;
    error: string | null;
  } | null;
  hidden: boolean;
  paused: boolean;
};
export type Snapshot = {
  characters: CharacterCollection;
  messageIdentities: MessageIdentity[];
  settings: Settings;
  playback: Playback | null;
  story: StoryRequest | null;
  panel: PanelState | null;
  wordbook: WordbookEntry[];
  messages: Message[];
  memories: Memory[];
  relationships: Relationship[];
  preparedCount: number;
  runtime: RuntimeStatus;
  hasApiKey: boolean;
  modelReady: boolean;
  localModels: LocalModelStatus[];
};
