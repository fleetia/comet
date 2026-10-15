export type Persona = string;
export const CHARACTER_SLOTS = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
export type MotionOverride =
  | { mode: "inherit" }
  | { mode: "static" }
  | { mode: "clip"; clipId: string; repeat: boolean; intervalMs: number };
export type ReactionVariant = {
  id: string;
  text?: string;
  expression?: string;
  motion?: MotionOverride;
};
export type ReactionRule = {
  id: string;
  event: string;
  variants: ReactionVariant[];
  cooldownMs: number;
};
export type CharacterReactionRun = {
  id: string;
  event: string;
  expression?: string;
  motion: MotionOverride;
  phase?: "start" | "hold" | "end";
  phaseGeneration?: number;
  definitionRevision?: string;
};
export type CharacterBodyRegion = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  grabPoint?: { x: number; y: number };
};
export type CharacterGestureMotion = {
  id: string;
  gesture:
    | "poke"
    | "stroke"
    | "cheek-grab"
    | "pickup"
    | "snack"
    | "wake"
    | "drink"
    | "gift"
    | "idle-yawn"
    | "idle-stretch"
    | "walk"
    | "fast-walk"
    | "crawl"
    | "climb"
    | "short-fall"
    | "peek";
  regionId?: string;
  expression?: string;
  start?: MotionOverride;
  hold?: MotionOverride;
  movingHold?: MotionOverride;
  end?: MotionOverride;
};
export type ReactionPreview = {
  selection: { ruleId: string; variant: ReactionVariant; speechAllowed: boolean } | null;
  speechReason: string | null;
};
export type CharacterLine = { expression: string; text: string; motion?: MotionOverride };
export type CharacterRelationship = {
  targetId: string;
  description: string;
  replyLines?: CharacterLine[];
};
export type CharacterNpc = {
  inviteKeywords: string[];
  appearanceKeywords: string[];
  requiredFlags: string[];
  entryLines: CharacterLine[];
  exitPolicy: "sceneEnd" | "topicChange";
};
export type StoryFlag = { id: string; public: boolean };
export type ConditionalKnowledge = {
  id: string;
  keywords: string[];
  text: string;
  knownBy: string[];
  requiredFlags: string[];
};
export type ScenarioDefinition = {
  id: string;
  title: string;
  centerId: string;
  participants: string[];
  keywords: string[];
  requiredFlags: string[];
  minAffinity: number;
  intro: SceneLine[];
  accept: SceneLine[];
  decline: SceneLine[];
  ending: SceneLine[];
  acceptKeywords: string[];
  declineKeywords: string[];
  proceedKeywords: string[];
  cancelKeywords: string[];
  acceptNextId: string | null;
  declineNextId: string | null;
  allowIncompleteRepeat: boolean;
  allowRepeat: boolean;
  completion: { setFlags: string[]; memoryTemplate: string | null };
};
export type PackStoryDefinition = {
  worldRules: string;
  storyFlags: StoryFlag[];
  knowledge: ConditionalKnowledge[];
  scenarios: ScenarioDefinition[];
};
export type PackStorySnapshot = {
  packId: string;
  definition: PackStoryDefinition;
  baseline: string;
  sourceToLocal: Record<string, string>;
};
export type AuthoringSubject =
  | { kind: "npc"; actorId: string }
  | { kind: "relation"; actorId: string; targetId: string }
  | { kind: "scenario"; scenarioId: string };
export type AuthoringStage = "entry" | "intro" | "accept" | "decline" | "ending";
export type AuthoringState = {
  stage: AuthoringStage | null;
  ready: boolean;
  presentIds: string[];
  flags: string[];
  turn: number;
  waitTurn: number;
  pendingNextScenarioId: string | null;
};
export type AuthoringTrialRequest = {
  actors: { id: string; packId: string | null; definition: CharacterDefinition }[];
  definition: PackStoryDefinition;
  subject: AuthoringSubject;
  context: {
    centerId: string;
    presentIds: string[];
    flags: string[];
    affinity: number;
    turn: number;
    waitTurn: number;
    completedScenarioIds: string[];
    incompleteScenarioIds: string[];
  };
  inputs: string[];
};
export type AuthoringTrialTrace = {
  blockedReasons: string[];
  steps: {
    input: string | null;
    source: "registered" | "none";
    stage: AuthoringStage | null;
    conditions: { id: string; label: string; matched: boolean }[];
    blockedReasons: string[];
    beforeState: AuthoringState;
    afterState: AuthoringState;
    lines: SceneLine[];
    lineDurationsMs: number[];
    plannedEffects: ScenarioDefinition["completion"];
    modelRequired: boolean;
    modelNotRunReason: string | null;
    presentationAssumed: boolean;
  }[];
};
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
  Record<
    "idle" | "speaking" | "click" | "musicPlaying" | "calendarOpen" | "sleep" | "focus" | "rest",
    AnimationBinding | null
  >
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
  presenceRole?: "resident" | "npc";
  npc?: CharacterNpc | null;
  expressions: Record<string, string>;
  faceIcon: boolean;
  spriteSize: number;
  balloonStyle?: BalloonStyle;
  animation?: CharacterAnimation | null;
  reactions?: ReactionRule[];
  bodyRegions?: CharacterBodyRegion[];
  gestureMotions?: CharacterGestureMotion[];
  greeting: CharacterLine[];
  idleLines: CharacterLine[];
  departureLines: CharacterLine[];
  returnLines: CharacterLine[];
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
export type CharacterPack = Partial<PackStoryDefinition> & {
  formatVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
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
export type SceneLine = CharacterLine & { persona: Persona };
export type WordbookGroup = "work" | "rest" | "daily";
export type WordbookMatchPreview = { entry: WordbookEntry; keyword: string };
export type WordbookEntry = {
  id: string;
  title: string;
  keywords: string[];
  lines: SceneLine[];
  enabled: boolean;
  useForIdle: boolean;
  group?: WordbookGroup;
};
export type Playback = SceneLine & {
  id: string;
  source:
    | "script"
    | "llm"
    | "wordbook"
    | "widget"
    | "talk"
    | "story"
    | "question"
    | "reaction"
    | "presence"
    | "npc"
    | "scenario";
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
export type PanelState = {
  persona: Persona;
  mode: "menu" | "input" | "history" | "name" | "focus";
};
export type Dispatch = (name: string, args?: Record<string, unknown>) => Promise<void>;
export type LocalModel =
  | "qwen3.5-4b"
  | "qwen3.5-9b"
  | "qwen3.5-27b"
  | "qwen3.8-2b-distill"
  | "qwen3.8-4b-distill"
  | "qwen3.8-9b-distill"
  | "gemma-4-e4b"
  | "gemma-4-12b"
  | "ministral-3-8b"
  | "ministral-3-14b"
  | "ministral-3-14b-q5-k-m"
  | "kanana-1.5-2.1b-instruct-2505"
  | "kanana-1.5-8b-instruct-2505"
  | "custom";
export type LocalModelStatus = {
  id: LocalModel;
  name: string;
  description: string;
  quantization: "Q4_K_M" | "Q5_K_M";
  size: number;
  ready: boolean;
  downloadedBytes: number;
  /** Estimated from the file size and this computer's memory, not measured. */
  fit: "fits" | "tight" | "insufficient" | "unknown";
  recommended: boolean;
  widgetCreation: boolean;
};
export type DeviceInfo = { totalMemory: number | null; appleSilicon: boolean };
export type LocalModelTest = { reply: string; elapsedMs: number };
export type QuietHours = {
  enabled: boolean;
  start: string;
  end: string;
  weekdays: number[];
};
export type ProviderKind = "local" | "api" | "chatgpt";
export type Settings = {
  mode: ProviderKind;
  autonomousEnabled: boolean;
  randomPresenceEnabled: boolean;
  localModel: LocalModel;
  localModelPath: string;
  localReasoningEnabled: boolean;
  baseUrl: string;
  apiModel: string;
  chatgptModel: string;
  chatgptIdleEnabled: boolean;
  apiTokenParameter: "max_tokens" | "max_completion_tokens";
  localIdleEnabled: boolean;
  apiIdleEnabled: boolean;
  idleMinutes: number;
  quietHours: QuietHours;
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
export type ConversationSession = {
  id: string;
  userId: string;
  participants: string[];
  status: "active" | "paused" | "ended";
  title: string;
  createdAt: number;
  updatedAt: number;
  draft: string;
  continuedFrom: string | null;
  noteContext?: ConversationNoteContext | null;
};
export type NoteReference = {
  kind: "diary" | "memo";
  id: string;
  widgetId?: string;
  title: string;
};
export type ConversationNoteContext = {
  noteRef: NoteReference;
  linkedAt: number;
  checkpoint?: { text: string; savedAt: number } | null;
  available?: boolean;
  body?: string;
};
export type ConversationNote = { noteRef: NoteReference; body: string };
export type ConversationMessages = {
  messages: Message[];
  /** Stored origin by message ID; absent legacy origins remain unknown. */
  messageSources?: Record<string, string>;
  nextBefore: number | null;
  characterNames?: Record<string, string>;
  userNames?: Record<string, string>;
};
export type ConversationView = ConversationMessages & {
  session: ConversationSession;
  noteContext?: ConversationNoteContext | null;
  recovery?: { messageId: string; reason: "cancelled" | "incomplete" };
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
  presentCharacterIds: string[];
  guestCharacterIds?: string[];
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
  /** Epoch milliseconds of a timed pause; null for an open-ended pause. */
  pausedUntil: number | null;
};
export type ActiveRequest = { epoch: number; sessionId?: string; messageId?: string };
export type Snapshot = {
  chatgptReady?: boolean;
  animationStates?: {
    musicPlaying: boolean;
    calendarOpen: boolean;
    focus?: boolean;
    rest?: boolean;
    sleepingCharacterIds?: string[];
  };
  reactions?: Record<string, CharacterReactionRun>;
  user: UserIdentity | null;
  legacyMemoryCount: number;
  characters: CharacterCollection;
  messageIdentities: MessageIdentity[];
  messageUserNames: Record<string, string>;
  settings: Settings;
  playback: Playback | null;
  story: StoryRequest | null;
  panel: PanelState | null;
  conversation?: ConversationView | null;
  wordbook: WordbookEntry[];
  messages: Message[];
  memoryCount: number;
  memoryRevision: number;
  relationships: Relationship[];
  preparedCount: number;
  runtime: RuntimeStatus;
  activeRequest?: ActiveRequest;
  hasApiKey: boolean;
  modelReady: boolean;
  localModels: LocalModelStatus[];
  device: DeviceInfo;
};
