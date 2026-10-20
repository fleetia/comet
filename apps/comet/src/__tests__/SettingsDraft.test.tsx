import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useSettingsDraft } from "../hooks/useSettingsDraft";
import { command, PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
}));
afterEach(cleanup);
beforeEach(() => vi.mocked(command).mockReset().mockResolvedValue(undefined));

it("keeps the model draft and API key after a failed scoped save and prevents duplicate saves", async () => {
  let fail: (error: Error) => void = () => {};
  vi.mocked(command).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  const { result } = renderHook(() => useSettingsDraft(PREVIEW_SNAPSHOT.settings, "model"));
  act(() => {
    result.current.change("apiModel", "draft-model");
    result.current.setApiKey("  draft-secret  ");
  });
  let save: Promise<void>;
  act(() => {
    save = result.current.run("save_settings");
  });
  await act(async () => result.current.run("save_settings"));
  expect(command).toHaveBeenCalledExactlyOnceWith("save_settings", {
    settings: { ...PREVIEW_SNAPSHOT.settings, apiModel: "draft-model" },
    scope: "model",
    apiKey: "draft-secret",
  });
  expect(result.current.pending).toBe("save_settings");
  await act(async () => {
    fail(new Error("저장할 수 없어요"));
    await save;
  });
  expect(result.current.error).toBe("저장할 수 없어요");
  expect(result.current.pending).toBeNull();
  expect(result.current.settings.apiModel).toBe("draft-model");
  expect(result.current.apiKey).toBe("  draft-secret  ");
  expect(result.current.hasChanges).toBe(true);
});

it("tests each connection using its own mode without changing the selected mode or saving", async () => {
  vi.mocked(command).mockImplementation(async (name) =>
    name === "test_local_model" ? { elapsedMs: 1250, reply: "반가워" } : undefined,
  );
  const { result } = renderHook(() => useSettingsDraft(PREVIEW_SNAPSHOT.settings, "model"));
  act(() => result.current.change("mode", "api"));
  await act(async () => result.current.run("test_local_model"));
  expect(command).toHaveBeenLastCalledWith("test_local_model", {
    settings: { ...result.current.settings, mode: "local" },
  });
  expect(result.current.settings.mode).toBe("api");
  expect(result.current.notice).toBe("1.3초 · 반가워");
  act(() => {
    result.current.change("mode", "local");
    result.current.setApiKey(" api-secret ");
  });
  await act(async () => result.current.run("test_connection"));
  expect(command).toHaveBeenLastCalledWith("test_connection", {
    settings: { ...result.current.settings, mode: "api" },
    apiKey: "api-secret",
  });
  expect(result.current.settings.mode).toBe("local");
  expect(result.current.apiKey).toBe(" api-secret ");
  expect(command).toHaveBeenCalledTimes(2);
});

it("preserves edited fields across incoming snapshots and resets to the latest saved settings", () => {
  const { result, rerender } = renderHook((settings) => useSettingsDraft(settings, "model"), {
    initialProps: PREVIEW_SNAPSHOT.settings,
  });
  act(() => {
    result.current.change("apiModel", "draft-model");
    result.current.setApiKey("draft-secret");
  });
  const latest = {
    ...PREVIEW_SNAPSHOT.settings,
    apiModel: "latest-saved-model",
    baseUrl: "https://latest.example/v1",
    idleMinutes: 19,
  };
  rerender(latest);
  expect(result.current.settings).toEqual({ ...latest, apiModel: "draft-model" });
  expect(result.current.apiKey).toBe("");
  act(() => result.current.change("baseUrl", PREVIEW_SNAPSHOT.settings.baseUrl));
  expect(result.current.apiKey).toBe("draft-secret");
  act(() => result.current.reset());
  expect(result.current.settings).toEqual(latest);
  expect(result.current.apiKey).toBe("");
  expect(result.current.hasChanges).toBe(false);
});

it("tests Apple explicitly without changing or saving the selected provider", async () => {
  vi.mocked(command).mockResolvedValue({ elapsedMs: 250, reply: "안녕!" });
  const { result } = renderHook(() => useSettingsDraft(PREVIEW_SNAPSHOT.settings, "model"));
  await act(async () => result.current.run("test_apple_model"));
  expect(command).toHaveBeenCalledExactlyOnceWith("test_apple_model", undefined);
  expect(result.current.settings.mode).toBe("local");
  expect(result.current.hasChanges).toBe(false);
  expect(result.current.notice).toBe("0.3초 · 안녕!");
});

it("keeps provider models and keys separate across switches and a failed save", async () => {
  const { result } = renderHook(() => useSettingsDraft(PREVIEW_SNAPSHOT.settings, "model"));
  act(() => result.current.selectProvider("claude"));
  act(() => {
    result.current.change("apiModel", "my-claude-model");
    result.current.setApiKey(" claude-fixture-key ");
  });
  act(() => result.current.selectProvider("gemini"));
  expect(result.current.apiKey).toBe("");
  act(() => {
    result.current.change("apiModel", "my-gemini-model");
    result.current.setApiKey("gemini-fixture-key");
  });
  act(() => result.current.selectProvider("chatgpt"));
  expect(result.current.settings.mode).toBe("chatgpt");
  act(() => result.current.selectProvider("claude"));
  expect(result.current.settings.apiModel).toBe("my-claude-model");
  expect(result.current.apiKey).toBe(" claude-fixture-key ");
  vi.mocked(command).mockRejectedValueOnce(new Error("보안 저장소를 열 수 없어요"));
  await act(async () => result.current.run("save_settings"));
  expect(result.current.hasChanges).toBe(true);
  expect(result.current.apiKey).toBe(" claude-fixture-key ");
  expect(command).toHaveBeenLastCalledWith(
    "save_settings",
    expect.objectContaining({
      apiKeys: {
        claude: { baseUrl: "https://api.anthropic.com/v1", key: "claude-fixture-key" },
        gemini: {
          baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
          key: "gemini-fixture-key",
        },
      },
      settings: expect.objectContaining({
        mode: "api",
        apiProvider: "claude",
        apiModel: "my-claude-model",
        apiProfiles: expect.objectContaining({
          gemini: expect.objectContaining({ apiModel: "my-gemini-model" }),
        }),
      }),
    }),
  );
  await act(async () => result.current.run("save_settings"));
  expect(result.current.hasChanges).toBe(false);
  act(() => result.current.selectProvider("gemini"));
  expect(result.current.settings.apiModel).toBe("my-gemini-model");
  expect(result.current.apiKey).toBe("");
});

it("does not send a key entered for another endpoint and invalidates a tested connection after key edits", async () => {
  const { result } = renderHook(() => useSettingsDraft(PREVIEW_SNAPSHOT.settings, "model"));
  act(() => result.current.selectProvider("custom"));
  act(() => result.current.setApiKey("original-fixture-key"));
  await act(async () => result.current.run("test_connection"));
  expect(result.current.notice).toBe("연결을 확인했어요.");
  act(() => result.current.setApiKey("changed-fixture-key"));
  expect(result.current.notice).toBeNull();
  act(() => result.current.change("baseUrl", "https://another.example/v1"));
  expect(result.current.apiKey).toBe("");
  await act(async () => result.current.run("test_connection"));
  expect(command).toHaveBeenLastCalledWith("test_connection", {
    settings: result.current.settings,
    apiKey: null,
  });
  await act(async () => result.current.run("save_settings"));
  expect(command).toHaveBeenLastCalledWith("save_settings", {
    settings: result.current.settings,
    scope: "model",
    apiKey: null,
  });
});
