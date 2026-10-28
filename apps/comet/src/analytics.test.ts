import { beforeEach, describe, expect, it, vi } from "vitest";

const core = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => core);

const context = {
  appVersion: "0.13.2",
  os: "macos",
  environment: "qa",
  appStarted: false,
  analyticsConsent: true,
  consentRevision: 0,
};
let currentContext = { ...context };
const target = window as Window & {
  dataLayer?: Array<Record<string, unknown>>;
  "ga-disable-G-4Z0X58WFVB"?: boolean;
};
let analytics: typeof import("./analytics");
let command: (typeof import("./hooks/useSnapshot"))["command"];

function events(): Array<Record<string, unknown>> {
  return target.dataLayer?.filter((event) => String(event.event).startsWith("comet_")) ?? [];
}

beforeEach(async () => {
  vi.resetModules();
  currentContext = { ...context };
  document.getElementById("comet-google-tag-manager")?.remove();
  delete target["ga-disable-G-4Z0X58WFVB"];
  core.isTauri.mockReset().mockReturnValue(true);
  core.invoke.mockReset().mockImplementation(async (name: string) => {
    if (name === "get_analytics_context") {
      const value = { ...currentContext };
      currentContext.appStarted = false;
      return value;
    }
    if (name === "get_snapshot") {
      return { settings: { mode: "local", localModel: "qwen3.5-4b" } };
    }
    return { saved: true };
  });
  delete target.dataLayer;
  analytics = await import("./analytics");
  ({ command } = await import("./hooks/useSnapshot"));
});

describe("desktop analytics", () => {
  it("shares concurrent context requests and only the native start claimant reports startup configuration", async () => {
    core.invoke.mockResolvedValueOnce({ ...context, appStarted: true });
    await Promise.all([analytics.initializeAnalytics(), analytics.initializeAnalytics()]);
    expect(core.invoke.mock.calls.map(([name]) => name)).toEqual([
      "get_analytics_context",
      "send_analytics_event",
      "get_snapshot",
      "send_analytics_event",
    ]);
    expect(events().map((event) => event.event)).toEqual([
      "comet_app_started",
      "comet_ai_configured",
    ]);
    expect(events()[1]).toMatchObject({
      ai_provider: "local",
      ai_model_family: "qwen",
      ai_model_source: "catalog",
      configuration_source: "startup",
      environment: "qa",
      debug_mode: true,
    });
    expect(
      core.invoke.mock.calls
        .filter(([name]) => name === "send_analytics_event")
        .map(([, args]) => args.event),
    ).toEqual(events());
  });

  it("does not report another startup from a secondary WebView or browser preview", async () => {
    await analytics.initializeAnalytics();
    expect(events()).toEqual([]);
    expect(core.invoke).toHaveBeenCalledExactlyOnceWith("get_analytics_context");

    vi.resetModules();
    core.invoke.mockClear();
    core.isTauri.mockReturnValue(false);
    const previewAnalytics = await import("./analytics");
    await previewAnalytics.initializeAnalytics();
    expect(core.invoke).not.toHaveBeenCalled();
    expect(events()).toEqual([]);
  });

  it("tracks saved AI selection without exporting keys, arbitrary models, endpoints or source text", async () => {
    const result = await command("save_settings", {
      scope: "model",
      settings: {
        mode: "api",
        apiProvider: "custom",
        apiModel: "private-project-model-8273",
        baseUrl: "https://private-company.example/v1",
        localModelPath: "/Users/private/models/personal.gguf",
      },
      apiKey: "secret-key-123",
      apiKeys: { custom: { key: "another-secret" } },
    });
    expect(result).toEqual({ saved: true });
    await vi.waitFor(() => expect(events()).toHaveLength(1));
    expect(events()[0]).toMatchObject({
      event: "comet_ai_configured",
      ai_provider: "custom",
      ai_model_family: "other",
      ai_model_source: "service",
      configuration_source: "saved",
    });
    const payload = JSON.stringify(events());
    for (const sensitive of ["private", "8273", "secret", "baseUrl", "apiKey", "gguf"]) {
      expect(payload).not.toContain(sensitive);
    }

    await command("save_settings", {
      scope: "automatic",
      settings: { mode: "api", apiProvider: "claude", apiModel: "claude-example" },
    });
    expect(events()).toHaveLength(1);
  });

  it.each([
    [{ mode: "local", localModel: "gemma-4-e4b" }, "local", "gemma", "catalog"],
    [{ mode: "local", localModel: "custom" }, "local", "custom", "custom_file"],
    [{ mode: "chatgpt", chatgptModel: "gpt-5.4" }, "chatgpt", "gpt", "service"],
    [{ mode: "chatgpt", chatgptModel: "o3" }, "chatgpt", "o_series", "service"],
    [{ mode: "apple", apiModel: "private-unused-model" }, "apple", "system_language_model", "os"],
    [
      { mode: "api", apiProvider: "claude", apiModel: "claude-opus-test" },
      "claude",
      "claude",
      "service",
    ],
    [
      { mode: "api", apiProvider: "gemini", apiModel: "gemini-test" },
      "gemini",
      "gemini",
      "service",
    ],
    [{ mode: "api", apiProvider: "glm", apiModel: "glm-test" }, "glm", "glm", "service"],
  ])("classifies AI selection into fixed values", async (settings, provider, family, source) => {
    await analytics.initializeAnalytics();
    await command("save_settings", { scope: "model", settings });
    await vi.waitFor(() => expect(events()).toHaveLength(1));
    expect(events()[0]).toMatchObject({
      ai_provider: provider,
      ai_model_family: family,
      ai_model_source: source,
    });
  });

  it("clears optional fields between events and only accepts fixed commands and parameter values", async () => {
    currentContext.environment = "production";
    await analytics.initializeAnalytics();
    await command("save_settings", { settings: { mode: "local", localModel: "custom" } });
    analytics.trackSettingsView("model");
    await command("set_settings_section", { section: "model" });
    await command("execute_widget", {
      request: {
        instanceId: "private-widget-id",
        action: "start",
        input: { title: "private task" },
      },
    });
    await command("get_snapshot");
    await command("save_conversation_draft", { draft: "private draft" });
    await command("set_settings_section", { section: "private section" });
    analytics.trackSettingsView("private section");
    await command("execute_widget", { request: { action: "private action" } });
    await vi.waitFor(() => expect(events()).toHaveLength(3));
    expect(events()[1]).toMatchObject({
      event: "comet_settings_view",
      section: "model",
      ai_provider: null,
      ai_model_family: null,
      ai_model_source: null,
      configuration_source: null,
      debug_mode: null,
    });
    expect(events()[2]).toMatchObject({
      event: "comet_ui_action",
      feature: "widget",
      action: "start",
      section: null,
    });
    expect(JSON.stringify(events())).not.toContain("private");
  });

  it("leaves command failures and results unchanged even when analytics initialization or push fails", async () => {
    await analytics.initializeAnalytics();
    core.invoke.mockRejectedValueOnce(new Error("save rejected"));
    await expect(command("save_settings", { settings: { mode: "local" } })).rejects.toThrow(
      "save rejected",
    );
    await vi.waitFor(() => expect(events()).toHaveLength(1));
    expect(events()[0]).toMatchObject({
      event: "comet_error",
      error_source: "frontend_command",
      error_code: "command_failed",
      operation: "save_settings",
    });

    target.dataLayer = [];
    vi.spyOn(target.dataLayer, "push").mockImplementation(() => {
      throw new Error("tag failed");
    });
    await expect(command("open_widget", { id: "private-widget-id" })).resolves.toEqual({
      saved: true,
    });
    await vi.waitFor(() =>
      expect(core.invoke).toHaveBeenCalledWith("send_analytics_event", {
        consentRevision: 0,
        event: expect.objectContaining({
          event: "comet_ui_action",
          feature: "widget",
          action: "open",
        }),
      }),
    );

    vi.resetModules();
    core.invoke.mockRejectedValueOnce(new Error("context unavailable"));
    const unavailableAnalytics = await import("./analytics");
    await expect(unavailableAnalytics.initializeAnalytics()).resolves.toBeNull();
    expect(() => unavailableAnalytics.trackSuccessfulCommand("open_launcher")).not.toThrow();
  });

  it("keeps command results and the data layer when native delivery rejects", async () => {
    await analytics.initializeAnalytics();
    core.invoke.mockImplementation(async (name: string) => {
      if (name === "get_analytics_context") {
        return currentContext;
      }
      if (name === "send_analytics_event") {
        throw new Error("analytics unavailable");
      }
      return { saved: true };
    });

    await expect(command("open_launcher")).resolves.toEqual({ saved: true });
    await vi.waitFor(() => expect(events()).toHaveLength(1));
    expect(events()[0]).toMatchObject({
      event: "comet_ui_action",
      feature: "launcher",
      action: "open",
    });
    expect(core.invoke).toHaveBeenCalledWith("send_analytics_event", {
      consentRevision: 0,
      event: events()[0],
    });
  });

  it("keeps tag-added fields out of the native payload", async () => {
    await analytics.initializeAnalytics();
    const layer: Array<Record<string, unknown>> = [];
    target.dataLayer = layer;
    vi.spyOn(layer, "push").mockImplementation((event) => {
      event["gtm.uniqueEventId"] = 123;
      return Array.prototype.push.call(layer, event);
    });

    analytics.trackSettingsView("model");
    await vi.waitFor(() => expect(layer).toHaveLength(1));
    expect(layer[0]).toHaveProperty("gtm.uniqueEventId", 123);
    const nativeEvent = core.invoke.mock.calls.find(
      ([name]) => name === "send_analytics_event",
    )?.[1].event;
    expect(nativeEvent).toMatchObject({ event: "comet_settings_view", section: "model" });
    expect(nativeEvent).not.toHaveProperty("gtm.uniqueEventId");
  });

  it("binds native delivery to the backend consent revision without adding it to analytics parameters", async () => {
    currentContext.consentRevision = 7;
    analytics.trackSettingsView("model");
    await vi.waitFor(() => expect(events()).toHaveLength(1));
    analytics.updateAnalyticsConsent(false);
    currentContext.consentRevision = 9;
    analytics.updateAnalyticsConsent(true);
    analytics.trackSettingsView("general");
    await vi.waitFor(() => expect(events()).toHaveLength(2));

    const deliveries = core.invoke.mock.calls
      .filter(([name]) => name === "send_analytics_event")
      .map(([, args]) => args);
    expect(deliveries.map((args) => args.consentRevision)).toEqual([7, 9]);
    expect(deliveries[0].event.section).toBe("model");
    expect(deliveries[1].event.section).toBe("general");
    expect(events().every((event) => !("consentRevision" in event))).toBe(true);
  });

  it("makes no GTM request or event delivery before consent", async () => {
    currentContext.analyticsConsent = false;
    await expect(analytics.initializeAnalytics()).resolves.toBeNull();
    await command("open_launcher");
    analytics.trackSettingsView("model");
    await analytics.initializeAnalytics();

    expect(document.getElementById("comet-google-tag-manager")).toBeNull();
    expect(target.dataLayer).toBeUndefined();
    expect(target["ga-disable-G-4Z0X58WFVB"]).toBe(true);
    expect(core.invoke.mock.calls.filter(([name]) => name === "send_analytics_event")).toEqual([]);
  });

  it("loads GTM and reports startup after consent without exporting the registered name", async () => {
    currentContext.analyticsConsent = false;
    await analytics.initializeAnalytics();
    currentContext.analyticsConsent = true;
    currentContext.appStarted = true;

    await command("register_user_name", { name: "민수", analyticsConsent: true });
    await vi.waitFor(() => expect(events()).toHaveLength(2));
    await analytics.initializeAnalytics();

    expect(events().map((event) => event.event)).toEqual([
      "comet_app_started",
      "comet_ai_configured",
    ]);
    expect(document.querySelectorAll("#comet-google-tag-manager")).toHaveLength(1);
    expect(document.getElementById("comet-google-tag-manager")).toHaveProperty(
      "src",
      "https://www.googletagmanager.com/gtm.js?id=GTM-TNZRBTGX",
    );
    expect(target["ga-disable-G-4Z0X58WFVB"]).toBe(false);
    expect(JSON.stringify(target.dataLayer)).not.toContain("민수");
  });

  it("ignores an older context response after consent was withdrawn", async () => {
    let resolveContext: (value: typeof context) => void = () => {};
    core.invoke.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveContext = resolve;
        }),
    );
    const pending = analytics.initializeAnalytics();
    currentContext.analyticsConsent = false;
    analytics.updateAnalyticsConsent(false);
    resolveContext(context);
    await pending;
    await analytics.initializeAnalytics();

    expect(events()).toEqual([]);
    expect(document.getElementById("comet-google-tag-manager")).toBeNull();
    expect(target["ga-disable-G-4Z0X58WFVB"]).toBe(true);
  });

  it("drops startup configuration when another window withdraws consent while the snapshot is pending", async () => {
    let resolveSnapshot: (value: { settings: Record<string, unknown> }) => void = () => {};
    core.invoke.mockImplementation(async (name: string) => {
      if (name === "get_analytics_context") {
        return { ...context, appStarted: true };
      }
      if (name === "get_snapshot") {
        return new Promise((resolve) => {
          resolveSnapshot = resolve;
        });
      }
      return { saved: true };
    });
    const pending = analytics.initializeAnalytics();
    await vi.waitFor(() => expect(events()).toHaveLength(1));
    analytics.updateAnalyticsConsent(false);
    analytics.updateAnalyticsConsent(false);
    resolveSnapshot({ settings: { mode: "local", localModel: "qwen3.5-4b" } });
    await expect(pending).resolves.toBeNull();

    expect(events().map((event) => event.event)).toEqual(["comet_app_started"]);
    expect(core.invoke.mock.calls.filter(([name]) => name === "send_analytics_event")).toHaveLength(
      1,
    );
    expect(target["ga-disable-G-4Z0X58WFVB"]).toBe(true);
  });

  it("reports runtime and promise error messages without paths, with one listener per source", async () => {
    const listeners = new Map<string, EventListener>();
    vi.spyOn(window, "addEventListener").mockImplementation((name, listener) => {
      if (typeof listener === "function") {
        listeners.set(name, listener);
      }
    });
    await analytics.initializeAnalytics();
    analytics.initializeErrorReporting();
    analytics.initializeErrorReporting();
    expect([...listeners.keys()]).toEqual(["error", "unhandledrejection"]);
    expect(window.addEventListener).toHaveBeenCalledTimes(2);

    const privateError = new ErrorEvent("error", {
      message: "load failed at /Users/me/app.js for me@example.com",
      filename: "https://private.example/file.js",
      error: new Error("private stack"),
    });
    listeners.get("error")?.(privateError);
    listeners.get("error")?.(privateError);
    listeners.get("unhandledrejection")?.(
      Object.assign(new Event("unhandledrejection"), { reason: new Error("request timed out") }),
    );
    await vi.waitFor(() => expect(events()).toHaveLength(2));
    expect(events()).toEqual([
      expect.objectContaining({
        event: "comet_error",
        error_source: "frontend_runtime",
        error_code: "unexpected_error",
        operation: null,
        error_detail: "load failed at <path> for <email>",
      }),
      expect.objectContaining({
        event: "comet_error",
        error_source: "frontend_promise",
        error_code: "unexpected_error",
        operation: null,
        error_detail: "request timed out",
      }),
    ]);
    expect(JSON.stringify(events())).not.toMatch(/Users|example\.com|stack|filename/);
  });

  it("bounds distinct errors, normalizes unknown commands and allows a new report after one minute", async () => {
    let now = 100_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    await analytics.initializeAnalytics();
    for (const name of [
      "private-custom-command",
      "register_user_name",
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
    ]) {
      analytics.trackCommandFailure(name);
    }
    analytics.trackCommandFailure("save_settings");
    await vi.waitFor(() => expect(events()).toHaveLength(10));
    expect(events()[0]).toMatchObject({
      operation: "other",
      error_detail: "private-custom-command",
    });

    now += 60_001;
    analytics.trackCommandFailure("save_settings");
    await vi.waitFor(() => expect(events()).toHaveLength(11));
    expect(events()[10]).toMatchObject({ operation: "save_settings" });
  });

  it("does not replay errors that occurred before consent or report analytics transport failures", async () => {
    analytics.trackCommandFailure("open_launcher");
    expect(core.invoke).not.toHaveBeenCalled();
    await analytics.initializeAnalytics();
    for (const name of ["get_analytics_context", "send_analytics_event", "organizer_touch"]) {
      const failure = new Error("private transport detail");
      core.invoke.mockRejectedValueOnce(failure);
      await expect(command(name)).rejects.toBe(failure);
    }
    expect(events()).toEqual([]);

    analytics.updateAnalyticsConsent(false);
    analytics.trackCommandFailure("save_settings");
    analytics.updateAnalyticsConsent(true);
    await analytics.initializeAnalytics();
    expect(events()).toEqual([]);
  });
});
