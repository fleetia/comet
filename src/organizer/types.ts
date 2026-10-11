export type OrganizerSettingsValue = {
  enabled: boolean;
  cometEnabled: boolean;
  idleSeconds: number;
  dailyRequestLimit: number;
};
export type VaultConnection = {
  id: string;
  userId: string;
  root: string;
  include: string[];
  exclude: string[];
  outputDir: string;
  enabled: boolean;
  automatic: boolean;
};
export type SourceRef = {
  id: string;
  userId: string;
  workspaceId: string;
  projectId: string;
  kind: string;
  locator: string;
  title: string;
  contentHash: string;
  active: boolean;
};
export type SourceDocument = { source: SourceRef; content: string };
export type OrganizerRecord = {
  id: string;
  operationId: string;
  source: SourceRef;
  title: string;
  markdown: string;
  outputPath: string | null;
  createdAt: number;
  state: string;
};
export type OrganizerProgress = {
  pending: number;
  running: number;
  deferred: number;
  completed: number;
  records: number;
  requestsToday: number;
};
export type OrganizerStatus = {
  settings: OrganizerSettingsValue;
  vaults: VaultConnection[];
  progress: OrganizerProgress;
  paused: boolean;
  error: string | null;
};
export type OrganizerAction = {
  id: string;
  inputId: string;
  title: string;
  kind: string;
  sourceId?: string | null;
  targetId?: string;
  createdAt: number;
  undone: boolean;
  error?: string | null;
};
export type OrganizerSearchHit = {
  source: SourceRef;
  recordId: string | null;
  title: string;
  excerpt: string;
};
export const DEFAULT_ORGANIZER_SETTINGS: OrganizerSettingsValue = {
  enabled: false,
  cometEnabled: false,
  idleSeconds: 300,
  dailyRequestLimit: 20,
};
export const PREVIEW_ORGANIZER_STATUS: OrganizerStatus = {
  settings: DEFAULT_ORGANIZER_SETTINGS,
  vaults: [],
  progress: { pending: 0, running: 0, deferred: 0, completed: 0, records: 0, requestsToday: 0 },
  paused: false,
  error: null,
};
