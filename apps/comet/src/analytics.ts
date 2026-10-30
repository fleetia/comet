import { invoke, isTauri } from "@tauri-apps/api/core";

type AnalyticsContext = {
  appVersion: string;
  os: "macos" | "windows" | "linux" | "unknown";
  environment: "production" | "development" | "qa";
  appStarted: boolean;
  analyticsConsent: boolean;
  consentRevision: number;
};

type AnalyticsEvent = {
  event: string;
  [parameter: string]: string | boolean | null;
};

const SETTINGS_SECTIONS = [
  "characters",
  "widgets",
  "automatic",
  "dialogue",
  "desktop",
  "organizer",
  "user",
  "model",
  "general",
] as const;
const AI_PROVIDERS = ["local", "chatgpt", "apple", "claude", "gemini", "glm", "custom"] as const;
const WIDGET_ACTIONS = [
  "add",
  "complete",
  "undo",
  "delete",
  "start",
  "pause",
  "resume",
  "cancel",
  "rest",
  "continue",
  "configure",
  "configure-settings",
] as const;
const ERROR_OPERATIONS = [
  "register_user_name",
  "register_user_profile",
  "set_analytics_consent",
  "save_settings",
  "get_snapshot",
  "execute_widget",
  "open_launcher",
  "open_widget",
  "open_widgets",
  "open_planner_view",
  "send_message",
  "retry_turn",
] as const;
const ERROR_WINDOW_MS = 60_000;
const MAX_ERRORS_PER_WINDOW = 10;

let initialization: Promise<AnalyticsContext | null> | undefined;
let hasConsent: boolean | undefined;
let consentRevision = 0;
let errorReportingInitialized = false;
let errorWindowStartedAt: number | undefined;
const reportedErrors = new Set<string>();
const TAG_MANAGER_SCRIPT_ID = "comet-google-tag-manager";

function setConsent(consent: boolean): void {
  hasConsent = consent;
  const target = window as Window & { "ga-disable-G-4Z0X58WFVB"?: boolean };
  target["ga-disable-G-4Z0X58WFVB"] = !consent;
  if (!consent) {
    reportedErrors.clear();
    errorWindowStartedAt = undefined;
  }
}

export function updateAnalyticsConsent(consent: boolean): void {
  const granted = consent === true;
  if (hasConsent === granted) {
    return;
  }
  const wasUnknown = hasConsent === undefined;
  setConsent(granted);
  if (!wasUnknown || !granted) {
    consentRevision += 1;
    initialization = undefined;
  }
}

function loadTagManager(): void {
  if (document.getElementById(TAG_MANAGER_SCRIPT_ID)) {
    return;
  }
  const target = window as Window & { dataLayer?: Array<Record<string, unknown>> };
  (target.dataLayer ??= []).push({ "gtm.start": Date.now(), event: "gtm.js" });
  const script = document.createElement("script");
  script.id = TAG_MANAGER_SCRIPT_ID;
  script.async = true;
  script.src = "https://www.googletagmanager.com/gtm.js?id=GTM-TNZRBTGX";
  document.head.append(script);
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function allowed<Value extends string>(value: unknown, values: readonly Value[]): value is Value {
  return typeof value === "string" && values.some((candidate) => candidate === value);
}

function modelFamily(model: unknown): string {
  if (typeof model !== "string" || !model.trim()) {
    return "unspecified";
  }
  const name = model.trim().toLowerCase();
  if (name === "custom") {
    return "custom";
  }
  if (/^o[134](?:-|$)/.test(name)) {
    return "o_series";
  }
  for (const family of ["qwen", "gemma", "ministral", "kanana", "gpt", "claude", "gemini", "glm"]) {
    if (name.startsWith(family)) {
      return family;
    }
  }
  return "other";
}

function push(context: AnalyticsContext, event: AnalyticsEvent): void {
  if (!context.analyticsConsent || !hasConsent) {
    return;
  }
  const payload: AnalyticsEvent = {
    app_version: context.appVersion,
    os: context.os,
    environment: context.environment,
    debug_mode: context.environment === "production" ? null : true,
    ai_provider: null,
    ai_model_family: null,
    ai_model_source: null,
    configuration_source: null,
    feature: null,
    action: null,
    section: null,
    error_source: null,
    error_code: null,
    operation: null,
    error_detail: null,
    ...event,
  };
  try {
    const target = window as Window & { dataLayer?: AnalyticsEvent[] };
    const layer = (target.dataLayer ??= []);
    layer.push({ ...payload });
  } catch {
    // A failed tag must not block the native transport.
  }
  try {
    void invoke<void>("send_analytics_event", {
      event: payload,
      consentRevision: context.consentRevision,
    }).catch(() => {});
  } catch {
    // Analytics cannot interrupt an app operation when the transport is unavailable.
  }
}

export function initializeAnalytics(): Promise<AnalyticsContext | null> {
  if (initialization) {
    return initialization;
  }
  const revision = consentRevision;
  const pending: Promise<AnalyticsContext | null> = (async () => {
    try {
      if (!isTauri()) {
        return null;
      }
      const context = await invoke<AnalyticsContext>("get_analytics_context");
      if (revision !== consentRevision) {
        return null;
      }
      setConsent(context.analyticsConsent === true);
      if (!hasConsent) {
        return null;
      }
      try {
        loadTagManager();
      } catch {
        // A blocked container must not prevent consented native delivery.
      }
      if (context.appStarted) {
        push(context, { event: "comet_app_started" });
        try {
          const snapshot = await invoke<{ settings: unknown }>("get_snapshot");
          if (revision !== consentRevision) {
            return null;
          }
          const event = commandEvent("save_settings", { settings: snapshot.settings });
          if (event) {
            push(context, { ...event, configuration_source: "startup" });
          }
        } catch {
          // A missing initial snapshot must not prevent later command events.
        }
      }
      return context;
    } catch {
      if (revision === consentRevision) {
        setConsent(false);
      }
      return null;
    }
  })().finally(() => {
    if (initialization === pending) {
      initialization = undefined;
    }
  });
  initialization = pending;
  return pending;
}

function commandEvent(name: string, args: Record<string, unknown>): AnalyticsEvent | null {
  switch (name) {
    case "save_settings": {
      if (args.scope != null && args.scope !== "model") {
        return null;
      }
      const settings = record(args.settings);
      const provider = settings.mode === "api" ? settings.apiProvider : settings.mode;
      if (!allowed(provider, AI_PROVIDERS)) {
        return null;
      }
      let model = settings.apiModel;
      let source = "service";
      if (provider === "local") {
        model = settings.localModel;
        source = model === "custom" ? "custom_file" : "catalog";
      } else if (provider === "chatgpt") {
        model = settings.chatgptModel;
      } else if (provider === "apple") {
        source = "os";
      }
      return {
        event: "comet_ai_configured",
        ai_provider: provider,
        ai_model_family: provider === "apple" ? "system_language_model" : modelFamily(model),
        ai_model_source: source,
        configuration_source: "saved",
      };
    }
    case "execute_widget": {
      const request = record(args.request);
      return allowed(request.action, WIDGET_ACTIONS)
        ? { event: "comet_ui_action", feature: "widget", action: request.action }
        : null;
    }
    case "open_launcher":
      return { event: "comet_ui_action", feature: "launcher", action: "open" };
    case "open_widget":
    case "open_widgets":
      return { event: "comet_ui_action", feature: "widget", action: "open" };
    case "open_planner_view":
      return { event: "comet_ui_action", feature: "diary", action: "open" };
    case "send_message":
      return { event: "comet_ui_action", feature: "conversation", action: "send" };
    case "retry_turn":
      return { event: "comet_ui_action", feature: "conversation", action: "retry" };
    default:
      return null;
  }
}

export function trackSuccessfulCommand(name: string, args?: Record<string, unknown>): void {
  try {
    if (name === "register_user_name" || name === "register_user_profile") {
      consentRevision += 1;
      initialization = undefined;
      void initializeAnalytics();
    }
    const event = commandEvent(name, args ?? {});
    if (!event || hasConsent === false) {
      return;
    }
    const revision = consentRevision;
    void initializeAnalytics().then((context) => {
      if (context && revision === consentRevision) {
        push(context, event);
      }
    });
  } catch {
    // Keep telemetry best effort even when command arguments cannot be inspected.
  }
}

export function trackSettingsView(section: string): void {
  if (!allowed(section, SETTINGS_SECTIONS) || hasConsent === false) {
    return;
  }
  const revision = consentRevision;
  void initializeAnalytics().then((context) => {
    if (context && revision === consentRevision) {
      push(context, { event: "comet_settings_view", section });
    }
  });
}

const MAX_ERROR_DETAIL_CHARS = 100;

// Matches the native sanitizer: no paths or email addresses, within GA's 100-character limit.
export function sanitizeErrorDetail(detail: unknown): string | null {
  const text = detail instanceof Error ? detail.message : String(detail ?? "");
  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .map((word) =>
      word.includes("/") || word.includes("\\") ? "<path>" : word.includes("@") ? "<email>" : word,
    );
  const sanitized = Array.from(words.join(" ")).slice(0, MAX_ERROR_DETAIL_CHARS).join("");
  return sanitized || null;
}

function trackError(
  source: "frontend_runtime" | "frontend_promise" | "frontend_command",
  code: "unexpected_error" | "command_failed",
  operation: string | null,
  detail: string | null,
): void {
  if (hasConsent !== true) {
    return;
  }
  const now = Date.now();
  if (
    errorWindowStartedAt === undefined ||
    now < errorWindowStartedAt ||
    now - errorWindowStartedAt >= ERROR_WINDOW_MS
  ) {
    errorWindowStartedAt = now;
    reportedErrors.clear();
  }
  const key = `${source}:${code}:${operation}:${detail}`;
  if (reportedErrors.has(key) || reportedErrors.size >= MAX_ERRORS_PER_WINDOW) {
    return;
  }
  reportedErrors.add(key);
  const revision = consentRevision;
  void initializeAnalytics().then((context) => {
    if (context && revision === consentRevision) {
      push(context, {
        event: "comet_error",
        error_source: source,
        error_code: code,
        operation,
        error_detail: detail,
      });
    }
  });
}

export function trackCommandFailure(name: string, cause?: unknown): void {
  if (
    name === "get_analytics_context" ||
    name === "send_analytics_event" ||
    name === "organizer_touch"
  ) {
    return;
  }
  const known = allowed(name, ERROR_OPERATIONS);
  const message = cause instanceof Error ? cause.message : String(cause ?? "");
  if (name === "login_chatgpt" && message === "ChatGPT 연결을 마치지 못했어요.") {
    return;
  }
  // Unknown commands collapse to "other", so keep their name in the detail.
  const detail = known ? message : message ? `${name}: ${message}` : name;
  trackError("frontend_command", "command_failed", known ? name : "other", sanitizeErrorDetail(detail));
}

export function initializeErrorReporting(): void {
  if (errorReportingInitialized || !isTauri()) {
    return;
  }
  errorReportingInitialized = true;
  window.addEventListener("error", (event) =>
    trackError("frontend_runtime", "unexpected_error", null, sanitizeErrorDetail(event.message)),
  );
  window.addEventListener("unhandledrejection", (event) =>
    trackError("frontend_promise", "unexpected_error", null, sanitizeErrorDetail(event.reason)),
  );
}
