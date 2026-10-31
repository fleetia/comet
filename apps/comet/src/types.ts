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
export type ScenarioWidget =
  | "memo"
  | "focus-timer"
  | "todo"
  | "calendar"
  | "music"
  | "ball"
  | "paper-plane"
  | "bubbles";
export type ScenarioAction =
  | { do: "widget.open"; widget: ScenarioWidget }
  | { do: "focus.start"; minutes: number }
  | { do: "focus.stop" }
  | {
      do: "settings.open";
      tab: "friends" | "dialogue" | "desktop" | "widgets" | "ai" | "general";
      highlight?: "ai.recommended" | "general.guide" | null;
    }
  | {
      do: "guide.open";
      page:
        | "first-meeting"
        | "talking"
        | "friends"
        | "packs"
        | "widgets"
        | "ai"
        | "rhythm"
        | "diary-memory"
        | "glossary"
        | "troubleshooting"
        | "privacy";
    };
export type ScenarioEvent =
  | { event: "body.clicked" | "body.moved" | "focus.started" | "focus.stopped" }
  | { event: "widget.saved"; widget: "memo" }
  | { event: "window.closed"; window: "settings" | ScenarioWidget };
export type ScenarioLineStep = {
  kind: "line";
  persona: string;
  expression: string;
  text: string;
  motion?: MotionOverride;
};
export type ScenarioActionStep = { kind: "action" } & ScenarioAction;
export type ScenarioStep =
  | ScenarioLineStep
  | { kind: "move"; persona: string; enter: "left" | "right" }
  | ({
      kind: "ask";
      id: string;
      persona: string;
      expression: string;
      prompt: string;
      known?: string | null;
      motion?: MotionOverride;
    } & (
      | { input: "name"; saved?: { expression: string; text: string; motion?: MotionOverride } }
      | { input: "text"; saved?: never }
    ))
  | {
      kind: "choice";
      persona: string;
      expression: string;
      prompt: string;
      options: { id: string; label: string; goto: string }[];
      motion?: MotionOverride;
    }
  | ScenarioActionStep
  | ({
      kind: "wait";
      timeoutSec: number;
      cancelOn?: ScenarioEvent[];
      onTimeout: { steps: (ScenarioLineStep | ScenarioActionStep)[]; then: string };
    } & ScenarioEvent);
export type ScenarioChapter = {
  id: string;
  title: string;
  next?: string | null;
  steps: ScenarioStep[];
};
export type ScenarioDefinition = {
  id: string;
  title: string;
  centerId: string;
  participants: string[];
  keywords: string[];
  requiredFlags: string[];
  minAffinity: number;
  purpose?: "story" | "tutorial";
  chapters?: ScenarioChapter[] | null;
  revealAffinity?: number | null;
  defer?: SceneLine[];
  intro?: SceneLine[];
  accept?: SceneLine[];
  decline?: SceneLine[];
  ending?: SceneLine[];
  acceptKeywords?: string[];
  declineKeywords?: string[];
  proceedKeywords?: string[];
  cancelKeywords?: string[];
  acceptNextId?: string | null;
  declineNextId?: string | null;
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
export type AuthoringStage = "entry" | "intro" | "defer" | "accept" | "decline" | "ending";
export type AuthoringState = {
  stage: AuthoringStage | null;
  ready: boolean;
  presentIds: string[];
  flags: string[];
  turn: number;
  waitTurn: number;
  pendingNextScenarioId: string | null;
};
export type AuthoringTrialTrace = {
  blockedReasons: string[];
  scene?: {
    status: "wait" | "ask" | "choice" | "completed" | "blocked";
    chapterId: string | null;
    prompt: string | null;
    options: { id: string; label: string }[];
    history: { text: string; persona: string | null; line?: SceneLine; durationMs?: number }[];
    chapterPath?: string[];
    exits?: {
      chapterId: string;
      kind: "next" | "choice" | "timeout";
      stepIndex: number | null;
      optionIndex: number | null;
    }[];
  } | null;
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
    | "idle"
    | "speaking"
    | "click"
    | "musicPlaying"
    | "calendarOpen"
    | "sleep"
    | "focus"
    | "rest"
    | "moodHigh"
    | "moodLow",
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
  birthday?: string | null;
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
export type InstalledCharacterPack = {
  id: string;
  name: string;
  characterIds: string[];
  author: string;
  sourceUrl: string;
  license: string;
  official: boolean;
  /** Unix seconds; null for packs installed before the time was recorded. */
  installedAt: number | null;
};
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
  formatVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 12 | 13 | 14;
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
    | "update"
    | "npc"
    | "scenario";
  endsAt: number;
  link?: {
    instanceId: string;
    kind: string;
    label: string;
    item?: { entity: string; id: string } | null;
  } | null;
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
  expression?: string;
  motion?: MotionOverride;
};
export type FollowUpRequest = {
  requestId: string;
  messageId: string;
  sessionId: string;
  surface: string;
  options: { id: string; label: string }[];
};
export type PanelState = {
  persona: Persona;
  mode: "menu" | "input" | "history" | "history-input" | "name" | "focus" | "update";
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
export type DeviceInfo = {
  totalMemory: number | null;
  appleSilicon: boolean;
  platform: "macos" | "windows" | "linux" | "other";
};
export type LocalModelTest = { reply: string; elapsedMs: number };
export type QuietHours = {
  enabled: boolean;
  start: string;
  end: string;
  weekdays: number[];
};
export type ProviderKind = "local" | "api" | "chatgpt" | "apple";
export type AppleModelStatus = {
  available: boolean;
  reason:
    | "available"
    | "unsupportedPlatform"
    | "unsupportedOs"
    | "bridgeUnavailable"
    | "deviceNotEligible"
    | "appleIntelligenceNotEnabled"
    | "modelNotReady"
    | "unsupportedLanguage"
    | "unknown";
  message: string;
  locale: string;
};
export type ApiProvider = "custom" | "claude" | "gemini" | "glm";
export type AiProvider = Exclude<ProviderKind, "api"> | ApiProvider;
export type ApiProfile = {
  baseUrl: string;
  apiModel: string;
  apiTokenParameter: "max_tokens" | "max_completion_tokens";
};
export type ColorMode = "system" | "dark" | "light";
export type SkinName = "night" | "paper" | "play" | "custom";
export type CustomSkin = { background: string; balloon: string; widget: string; accent: string };
export type Appearance = {
  colorMode: ColorMode;
  skin: SkinName;
  customSkin: CustomSkin | null;
  /** Desktop surface opacity in percent, 20–100; 100 is opaque. */
  balloonOpacity: number;
  widgetOpacity: number;
  revision: number;
};
export type Settings = {
  analyticsConsent: boolean;
  mode: ProviderKind;
  apiProvider: ApiProvider;
  apiProfiles: Partial<Record<ApiProvider, ApiProfile>>;
  autonomousEnabled: boolean;
  diaryRecallEnabled: boolean;
  showFollowUps: boolean;
  randomPresenceEnabled: boolean;
  localModel: LocalModel;
  localModelPath: string;
  localReasoningEnabled: boolean;
  baseUrl: string;
  apiModel: string;
  chatgptModel: string;
  chatgptIdleEnabled: boolean;
  appleIdleEnabled: boolean;
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
  messageCount?: number;
  continuedFrom: string | null;
};
export type NoteReference = {
  kind: "diary" | "memo";
  id: string;
  widgetId?: string;
  title: string;
};
export type ConversationNote = { noteRef: NoteReference; body: string };
export type ConversationTimelineEvent = {
  id: string;
  kind: "started" | "resumed" | "focus-paused";
  createdAt: number;
  source?: "desktop" | "reply" | "history" | "note" | "music" | "automatic";
  messageId?: string;
};
export type ConversationMemoryReceipt = {
  id: string;
  sourceMessageId: string;
  characterId: string;
  content: string;
  updatedAt: number;
};
export type ConversationMessages = {
  messages: Message[];
  recovery?: { messageId: string; reason: "cancelled" | "incomplete" };
  /** Stored origin by message ID; absent legacy origins remain unknown. */
  messageSources?: Record<string, string>;
  nextBefore: number | null;
  characterNames?: Record<string, string>;
  userNames?: Record<string, string>;
  timelineEvents?: ConversationTimelineEvent[];
  memoryReceipts?: ConversationMemoryReceipt[];
};
export type ConversationView = ConversationMessages & {
  session: ConversationSession;
};
export type UserIdentity = { id: string; name: string; startedAt: number; endedAt: number | null };
export type UserBirthday = { month: number; day: number; year: number | null };
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
  appleModel: AppleModelStatus;
  animationStates?: {
    musicPlaying: boolean;
    calendarOpen: boolean;
    focus?: boolean;
    rest?: boolean;
    sleepingCharacterIds?: string[];
    moodHighCharacterIds?: string[];
    moodLowCharacterIds?: string[];
  };
  reactions?: Record<string, CharacterReactionRun>;
  user: UserIdentity | null;
  userBirthday?: UserBirthday | null;
  legacyMemoryCount: number;
  characters: CharacterCollection;
  messageIdentities: MessageIdentity[];
  messageUserNames: Record<string, string>;
  settings: Settings;
  playback: Playback | null;
  story: StoryRequest | null;
  sceneAskId?: string;
  followUps?: FollowUpRequest | null;
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
  apiKeyProviders: ApiProvider[];
  modelReady: boolean;
  localModels: LocalModelStatus[];
  device: DeviceInfo;
};
