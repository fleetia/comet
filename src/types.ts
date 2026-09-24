export type Persona = string;
export const CHARACTER_SLOTS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
export type CharacterLine = { expression: string; text: string };
export type CharacterRelationship = { targetId: string; description: string };
export type BalloonStyle = {
  fontSize: number;
  fontFamily: string;
  textColor: string | null;
  textSpeed?: number;
};
export type AnimationFrame = {
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export type AnimationClip = { id: string; name: string; fps: number; frames: AnimationFrame[] };
export type AnimationBinding = { clipId: string; repeat: boolean; intervalMs: number };
export type AnimationBindings = Partial<
  Record<"idle" | "speaking" | "click", AnimationBinding | null>
>;
export type CharacterAnimation = {
  clips: AnimationClip[];
  bindings: AnimationBindings;
  overrides: Record<string, Partial<Record<"idle" | "speaking", AnimationBinding | null>>>;
};
export type AnimationAssetInfo = { mime: string; width: number; height: number };
export type AnimationAsset = AnimationAssetInfo & { assetId: string; data: string };
export type CharacterDefinition = {
  sourceId: string;
  name: string;
  description: string;
  personality: string;
  instructions: string;
  relationships: CharacterRelationship[];
  expressions: Record<string, string>;
  faceIcon: boolean;
  spriteSize: number;
  balloonStyle?: BalloonStyle;
  animation?: CharacterAnimation | null;
  greeting: CharacterLine[];
  idleLines: CharacterLine[];
};
export type SpriteInfo = { mime: string; updatedAt: number };
export type InstalledCharacter = {
  id: string;
  packId: string | null;
  definition: CharacterDefinition;
  sprites: Record<string, SpriteInfo>;
  animationAssets?: Record<string, AnimationAssetInfo>;
};
export type CharacterCollection = { installed: InstalledCharacter[]; active: string[] };
export type InstalledCharacterPack = { id: string; name: string; characterIds: string[] };
export type CharacterDialogue = { pairScenes: SceneLine[][]; wordbook: WordbookEntry[] };
export type PackSprite = { sourceId: string; expression: string; mime: string; data: string };
export type CharacterArchive = {
  exportedAt: number;
  people: UserIdentity[];
  memories: {
    id: string;
    characterSourceId: string;
    personId: string;
    kind: string;
    content: string;
    sourceId: string;
    sourceText: string;
    sourceCreatedAt: number;
    updatedAt: number;
    requiredChapter?: number | null;
  }[];
  affinity: { characterSourceId: string; personId: string; score: number }[];
  messages: {
    id: string;
    personId: string;
    role: string;
    content: string;
    expression: string | null;
    createdAt: number;
    status: string;
    sourceKind: string;
    characters: { sourceId: string; name: string }[];
  }[];
};
export type CharacterPack = {
  formatVersion: 1 | 2 | 3 | 4;
  name: string;
  author: string;
  sourceUrl?: string;
  license: string;
  characters: CharacterDefinition[];
  pairScenes: SceneLine[][];
  wordbook: WordbookEntry[];
  sprites?: PackSprite[];
  animationAssets?: (AnimationAsset & { sourceId: string })[];
  archive?: CharacterArchive | null;
};
export type MessageIdentity = {
  messageId: string;
  persona: Persona;
  characterId: string;
  name: string;
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
  textSpeed?: number;
  displayStartedAt?: number | null;
  lineIndex: number;
  lineCount: number;
};
export type StoryRequest = {
  id: string;
  displayStartedAt?: number | null;
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
export type UserIdentity = { id: string; name: string; startedAt: number; endedAt: number | null };
export type CharacterExportOptions = {
  includeSprites: boolean;
  includeMemories: boolean;
  includeAffinity: boolean;
  includeMessages: boolean;
};
export type Memory = {
  id: string;
  characterId: string;
  userId: string;
  userName: string;
  kind: "user_fact" | "experience";
  content: string;
  sourceMessageId: string;
  sourceText: string;
  sourceCreatedAt: number;
  updatedAt: number;
  retiredAt: number | null;
  recallWeight: number;
};
export type MemoryPage = {
  items: Memory[];
  total: number;
  offset: number;
  nextOffset: number | null;
  revision: number;
};
export type MemoryAnalysisStatus = { pending: number; deferred: number; legacyUnverified: number };
export type NlpModel = "kiwi" | "semantic";
export type MemorySearchSettings = { kiwiEnabled: boolean; semanticEnabled: boolean };
export type NlpModelStatus = {
  installed: boolean;
  enabled: boolean;
  state: string;
  downloadedBytes: number;
  totalBytes: number;
  error: string | null;
  profile: string | null;
};
export type MemorySearchStatus = {
  nlp: {
    settings: MemorySearchSettings;
    kiwi: NlpModelStatus;
    semantic: NlpModelStatus;
    running: boolean;
    busy: boolean;
    activeMethods: string[];
  };
  analysis: MemoryAnalysisStatus;
  index: { kiwiPending: number; semanticPending: number };
};
export type TalkPack = {
  id: string;
  name: string;
  description: string;
  installed: boolean;
  bundled: boolean;
  defaultInstalled: boolean;
};
export type Relationship = { persona: string; score: number };
export type RuntimePhase =
  | "idle"
  | "loading"
  | "generating"
  | "playing"
  | "waiting"
  | "analyzing"
  | "preparing"
  | "story"
  | "error";
export type RuntimeStatus = {
  phase: RuntimePhase;
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
  user: UserIdentity | null;
  legacyMemoryCount: number;
  characters: CharacterCollection;
  messageIdentities: MessageIdentity[];
  messageUserNames: Record<string, string>;
  settings: Settings;
  playback: Playback | null;
  story: StoryRequest | null;
  panel: PanelState | null;
  wordbook: WordbookEntry[];
  messages: Message[];
  memoryCount: number;
  memoryRevision: number;
  relationships: Relationship[];
  preparedCount: number;
  runtime: RuntimeStatus;
  hasApiKey: boolean;
  modelReady: boolean;
  localModels: LocalModelStatus[];
};
