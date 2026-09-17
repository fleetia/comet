export type Persona = "a" | "b";
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
export type CharacterDialogue = { pairScenes: SceneLine[][]; wordbook: WordbookEntry[] };
export type PackSprite = { sourceId: string; expression: string; mime: string; data: string };
export type CharacterPack = {
  formatVersion: 1;
  name: string;
  author: string;
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
  source: "script" | "llm" | "wordbook" | "widget" | "talk";
  endsAt: number;
  lineIndex: number;
  lineCount: number;
};
export type PanelState = { persona: Persona; mode: "menu" | "input" | "history" };
export type Dispatch = (name: string, args?: Record<string, unknown>) => Promise<void>;
export type LocalModel = "qwen3.5-4b" | "qwen3.5-9b";
export type LocalModelStatus = {
  id: LocalModel;
  name: string;
  size: number;
  ready: boolean;
  downloadedBytes: number;
};
export type Settings = {
  mode: "local" | "api";
  autonomousEnabled: boolean;
  localModel: LocalModel;
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
