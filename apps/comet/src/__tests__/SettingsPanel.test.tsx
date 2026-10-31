import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { openCharacterPage, selectFriend } from "./characterNavigation";
import { SettingsPanel } from "../components/SettingsPanel/SettingsPanel";
import { PREVIEW_SNAPSHOT, command, isDesktop } from "../hooks/useSnapshot";
import { API_DEFAULTS } from "../aiProviders";
import { listen, type EventCallback } from "@tauri-apps/api/event";
import * as settingsStyles from "../components/SettingsPanel/settings.css";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(() => false),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onFocusChanged: vi.fn().mockResolvedValue(() => {}) }),
}));
const idleUpdate = {
  phase: "idle", version: null, notes: null, downloaded: 0, total: null, message: null,
};
afterEach(() => {
  cleanup();
  vi.mocked(listen).mockReset().mockResolvedValue(() => {});
});
beforeEach(() => {
  vi.mocked(isDesktop).mockReturnValue(false);
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(undefined);
});

it("restores one pending highlight, replaces it on a new request, and clears it on tab change", async () => {
  const listeners = new Map<string, EventCallback<unknown>>();
  vi.mocked(listen).mockImplementation(async (event, callback) => {
    listeners.set(event, callback as EventCallback<unknown>);
    return () => listeners.delete(event);
  });
  let pending: { id: number; value: string } | null = { id: 1, value: "ai.recommended" };
  vi.mocked(isDesktop).mockReturnValue(true);
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_update_status") return idleUpdate;
    if (name === "get_settings_section") return "characters";
    if (name === "take_settings_highlight") {
      const value = pending;
      pending = null;
      return value;
    }
    return undefined;
  });
  render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="characters" />);
  const select = await screen.findByLabelText("대화에 쓸 AI");
  await waitFor(() => expect(select.classList.contains(settingsStyles.tutorialHighlight)).toBe(true));
  expect(pending).toBeNull();
  act(() => listeners.get("story-settings-highlight")?.({ event: "story-settings-highlight", id: 1, payload: { id: 1, value: "ai.recommended" } }));
  await waitFor(() => expect(vi.mocked(command).mock.calls.filter(([name]) => name === "take_settings_highlight")).toHaveLength(2));
  expect(select.classList.contains(settingsStyles.tutorialHighlight)).toBe(true);
  fireEvent.click(screen.getByRole("tab", { name: "일반" }));
  expect(select.classList.contains(settingsStyles.tutorialHighlight)).toBe(false);
  pending = { id: 2, value: "general.guide" };
  act(() => listeners.get("story-settings-highlight")?.({ event: "story-settings-highlight", id: 2, payload: pending }));
  await waitFor(() => {
    const target = document.querySelector('[data-settings-highlight="general.guide"]');
    expect(target?.classList.contains(settingsStyles.tutorialHighlight)).toBe(true);
  });
});

it("consumes a pending guide failure once when settings opens", async () => {
  let pending: { id: number; error: { message: string; path: string } } | null = {
    id: 1,
    error: { message: "브라우저를 열지 못했어요.", path: "/example/first-meeting.html" },
  };
  vi.mocked(isDesktop).mockReturnValue(true);
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_update_status") return idleUpdate;
    if (name === "get_settings_section") return "general";
    if (name === "take_guide_open_error") {
      const value = pending;
      pending = null;
      return value;
    }
    return undefined;
  });
  const view = render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="general" />);
  expect(await screen.findByText("브라우저를 열지 못했어요.")).toBeTruthy();
  expect(screen.getByTitle("/example/first-meeting.html")).toBeTruthy();
  view.unmount();
  render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="general" />);
  await waitFor(() => expect(vi.mocked(command).mock.calls.filter(([name]) => name === "take_guide_open_error")).toHaveLength(2));
  expect(screen.queryByText("브라우저를 열지 못했어요.")).toBeNull();
});

it("ignores a pending guide failure received after a successful open", async () => {
  const listeners = new Map<string, EventCallback<unknown>>();
  vi.mocked(listen).mockImplementation(async (event, callback) => {
    listeners.set(event, callback as EventCallback<unknown>);
    return () => listeners.delete(event);
  });
  let finish: (value: { id: number; error: { message: string; path: string } }) => void = () => {};
  vi.mocked(isDesktop).mockReturnValue(true);
  vi.mocked(command).mockImplementation((name) => {
    if (name === "get_update_status") return Promise.resolve(idleUpdate);
    if (name === "get_settings_section") return Promise.resolve("general");
    if (name === "take_guide_open_error") {
      return new Promise((resolve) => { finish = resolve; });
    }
    return Promise.resolve();
  });
  render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="general" />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("take_guide_open_error"));
  act(() => listeners.get("guide-open-succeeded")?.({ event: "guide-open-succeeded", id: 1, payload: 2 }));
  await act(async () => finish({ id: 1, error: { message: "오래된 오류", path: "/example.html" } }));
  expect(screen.queryByText("오래된 오류")).toBeNull();
});

it("does not apply a delayed highlight after manual navigation", async () => {
  let finish: (value: { id: number; value: string }) => void = () => {};
  vi.mocked(isDesktop).mockReturnValue(true);
  vi.mocked(command).mockImplementation((name) => {
    if (name === "get_update_status") return Promise.resolve(idleUpdate);
    if (name === "get_settings_section") return Promise.resolve("characters");
    if (name === "take_settings_highlight") {
      return new Promise((resolve) => { finish = resolve; });
    }
    return Promise.resolve();
  });
  render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="characters" />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("take_settings_highlight"));
  fireEvent.click(screen.getByRole("tab", { name: "일반" }));
  await act(async () => finish({ id: 1, value: "ai.recommended" }));
  expect(screen.getByRole("tab", { name: "일반" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.queryByLabelText("대화에 쓸 AI")).toBeNull();
});

it("keeps a new highlight when an older pending read returns the same request", async () => {
  const listeners = new Map<string, EventCallback<unknown>>();
  vi.mocked(listen).mockImplementation(async (event, callback) => {
    listeners.set(event, callback as EventCallback<unknown>);
    return () => listeners.delete(event);
  });
  let finish: (value: { id: number; value: string }) => void = () => {};
  let reads = 0;
  vi.mocked(isDesktop).mockReturnValue(true);
  vi.mocked(command).mockImplementation((name) => {
    if (name === "get_update_status") return Promise.resolve(idleUpdate);
    if (name === "get_settings_section") return Promise.resolve("characters");
    if (name === "take_settings_highlight" && reads++ === 0) {
      return new Promise((resolve) => { finish = resolve; });
    }
    return Promise.resolve();
  });
  render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="characters" />);
  await waitFor(() => expect(reads).toBe(1));
  fireEvent.click(screen.getByRole("tab", { name: "일반" }));
  const request = { id: 2, value: "ai.recommended" };
  act(() => listeners.get("story-settings-highlight")?.({ event: "story-settings-highlight", id: 2, payload: request }));
  await act(async () => finish(request));
  const select = await screen.findByLabelText("대화에 쓸 AI");
  await waitFor(() => expect(select.classList.contains(settingsStyles.tutorialHighlight)).toBe(true));
});

it.each([
  ["macos", "Apple 온디바이스 AI · 추천"],
  ["windows", "ChatGPT · 추천"],
] as const)(
  "shows the %s recommendation while preserving the saved API choice",
  (platform, firstOption) => {
    render(
      <SettingsPanel
        initialSection="model"
        snapshot={{
          ...PREVIEW_SNAPSHOT,
          device: { ...PREVIEW_SNAPSHOT.device, platform },
          settings: { ...PREVIEW_SNAPSHOT.settings, mode: "api", apiProvider: "claude" },
        }}
      />,
    );
    const selector = screen.getByLabelText("대화에 쓸 AI");
    expect(within(selector).getAllByRole("option")[0].textContent).toBe(firstOption);
    expect(selector).toHaveProperty("value", "claude");
    expect(command).not.toHaveBeenCalledWith("save_settings", expect.anything());
  },
);

it.each(["claude", "gemini", "glm"] as const)(
  "connects %s with its fixed endpoint and preserves custom API controls",
  async (provider) => {
    render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="model" />);
    const selector = screen.getByLabelText("대화에 쓸 AI");
    expect(
      within(selector)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["이 기기의 모델", "ChatGPT", "Claude", "Gemini", "GLM", "사용자 지정 API"]);
    fireEvent.change(selector, { target: { value: provider } });
    expect(screen.queryByLabelText("API 주소")).toBeNull();
    expect(screen.queryByLabelText("응답 길이 매개변수")).toBeNull();
    expect(screen.getByLabelText("모델 이름")).toHaveProperty("value", "");
    expect(screen.getByRole("switch", { name: "API로 새 잡담 만들기" })).toHaveProperty(
      "checked",
      false,
    );
    expect(screen.getByRole("button", { name: "다시 확인" })).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByLabelText("모델 이름"), { target: { value: "account-model" } });
    fireEvent.change(screen.getByLabelText("API 키"), {
      target: { value: "provider-fixture-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
    await waitFor(() =>
      expect(command).toHaveBeenLastCalledWith("test_connection", {
        settings: {
          ...PREVIEW_SNAPSHOT.settings,
          ...API_DEFAULTS[provider],
          mode: "api",
          apiProvider: provider,
          apiModel: "account-model",
        },
        apiKey: "provider-fixture-key",
      }),
    );
    fireEvent.change(selector, { target: { value: "custom" } });
    expect(screen.getByLabelText("API 주소")).toHaveProperty(
      "value",
      PREVIEW_SNAPSHOT.settings.baseUrl,
    );
    expect(screen.getByLabelText("API 키")).toHaveProperty("value", "");
    expect(screen.getByLabelText("응답 길이 매개변수")).toBeTruthy();
  },
);

it("uses and clears a saved inactive provider key without activating that provider", async () => {
  render(
    <SettingsPanel
      snapshot={{
        ...PREVIEW_SNAPSHOT,
        apiKeyProviders: ["claude"],
        settings: {
          ...PREVIEW_SNAPSHOT.settings,
          apiProfiles: { claude: { ...API_DEFAULTS.claude, apiModel: "saved-claude" } },
        },
      }}
      initialSection="model"
    />,
  );
  fireEvent.change(screen.getByLabelText("대화에 쓸 AI"), { target: { value: "claude" } });
  expect(screen.getByRole("button", { name: "다시 확인" })).toHaveProperty("disabled", false);
  expect(screen.queryByLabelText("API 키")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "지우기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledExactlyOnceWith("clear_api_key", {
      settings: expect.objectContaining({
        mode: "api",
        apiProvider: "claude",
        baseUrl: API_DEFAULTS.claude.baseUrl,
      }),
    }),
  );
});

it("opens the six Figma destinations with keyboard navigation and associated panels", () => {
  render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} />);
  expect(screen.getByRole("tabpanel", { name: "친구들" })).toBeTruthy();
  const tabs = screen.getByRole("tablist", { name: "설정 항목" });
  expect(
    within(tabs)
      .getAllByRole("tab")
      .map((tab) => tab.textContent),
  ).toEqual(["친구들", "대화", "바탕화면", "위젯", "AI 연결", "일반"]);
  fireEvent.keyDown(within(tabs).getByRole("tab", { name: "친구들" }), { key: "ArrowRight" });
  expect(screen.getByRole("heading", { level: 1, name: "자동 잡담" })).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  const general = screen.getByRole("tabpanel", { name: "일반" });
  expect(general.id).toBe(screen.getByRole("tab", { name: "일반" }).getAttribute("aria-controls"));
  expect(within(general).getByRole("heading", { name: "시작과 종료" })).toBeTruthy();
  expect(within(general).getByRole("heading", { name: "사용자" })).toBeTruthy();
  expect(within(general).getByRole("heading", { name: "빠른 실행 단축키" })).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(screen.getByRole("tabpanel", { name: "친구들" })).toBeTruthy();
});

it("lets an unsupported device disable transferred activity awareness but not enable it", async () => {
  vi.mocked(isDesktop).mockReturnValue(true);
  let enabled = true;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_desktop_preferences")
      return {
        charactersVisible: true,
        pranksEnabled: false,
        allowedToys: ["ball"],
        activityEnabled: enabled,
        activityExcludedApps: ["private-app"],
      };
    if (name === "set_activity_preferences") enabled = false;
    return undefined;
  });
  render(
    <SettingsPanel
      snapshot={{
        ...PREVIEW_SNAPSHOT,
        device: { ...PREVIEW_SNAPSHOT.device, platform: "macos" },
      }}
      initialSection="desktop"
    />,
  );
  const toggle = await screen.findByRole("switch", { name: "지금 하는 앱 눈치채기" });
  await waitFor(() => expect(toggle).toHaveProperty("checked", true));
  expect(toggle).toHaveProperty("disabled", false);
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("set_activity_preferences", {
      enabled: false,
      excludedApps: ["private-app"],
    }),
  );
  await waitFor(() => expect(toggle).toHaveProperty("checked", false));
  expect(toggle).toHaveProperty("disabled", true);
});

it("discards user and desktop edits when leaving their settings", () => {
  render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="user" />);
  fireEvent.change(screen.getByLabelText("부를 이름"), { target: { value: "새 이름 초안" } });
  fireEvent.click(screen.getByRole("tab", { name: "바탕화면" }));
  fireEvent.click(screen.getByRole("switch", { name: "장난 모드" }));
  fireEvent.click(screen.getByRole("link", { name: PREVIEW_SNAPSHOT.user!.name }));
  expect(screen.getByLabelText("부를 이름")).toHaveProperty("value", PREVIEW_SNAPSHOT.user!.name);
  fireEvent.click(screen.getByRole("tab", { name: "바탕화면" }));
  expect(screen.getByRole("switch", { name: "장난 모드" })).toHaveProperty("checked", false);
  expect(screen.queryByRole("button", { name: "장난 설정 저장" })).toBeNull();
  expect(command).not.toHaveBeenCalled();
});

it.each([5, 2])(
  "keeps the supplied %i-minute idle interval when saving automatic settings",
  async (idleMinutes) => {
    const snapshot = {
      ...PREVIEW_SNAPSHOT,
      settings: { ...PREVIEW_SNAPSHOT.settings, idleMinutes },
    };
    render(<SettingsPanel snapshot={snapshot} initialSection="automatic" />);
    expect(PREVIEW_SNAPSHOT.settings.idleMinutes).toBe(5);
    expect(screen.getByLabelText(/이야기 간격/)).toHaveProperty("value", String(idleMinutes));
    fireEvent.click(screen.getByRole("switch", { name: "가끔 자리 비우기" }));
    fireEvent.click(screen.getByRole("button", { name: "자동 대화 저장" }));
    await waitFor(() =>
      expect(command).toHaveBeenLastCalledWith("save_settings", {
        settings: { ...snapshot.settings, randomPresenceEnabled: true },
        scope: "automatic",
        apiKey: null,
      }),
    );
  },
);

it("shows when a timed pause ends and resumes without saving automatic drafts", async () => {
  const pausedUntil = new Date(2026, 9, 3, 14, 30).getTime();
  render(
    <SettingsPanel
      snapshot={{
        ...PREVIEW_SNAPSHOT,
        runtime: { ...PREVIEW_SNAPSHOT.runtime, paused: true, pausedUntil },
      }}
      initialSection="automatic"
    />,
  );
  const time = new Date(pausedUntil).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  expect(screen.getByText(`${time}까지 자동 잡담 쉬는 중`)).toBeTruthy();
  fireEvent.change(screen.getByLabelText(/이야기 간격/), { target: { value: "12" } });
  fireEvent.click(screen.getByRole("button", { name: "자동 잡담 다시 시작" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledExactlyOnceWith("set_paused", { paused: false }),
  );
  expect(screen.getByLabelText(/이야기 간격/)).toHaveProperty("value", "12");
});

it.each([
  ["60", { paused: true, minutes: 60 }],
  ["restart", { paused: true }],
])("pauses for %s without saving the automatic draft", async (duration, args) => {
  render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="automatic" />);
  fireEvent.change(screen.getByLabelText(/이야기 간격/), { target: { value: "12" } });
  fireEvent.click(
    screen.getByRole("radio", { name: duration === "60" ? "1시간" : "다시 시작할 때까지" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "자동 잡담 쉬기" }));
  await waitFor(() => expect(command).toHaveBeenCalledExactlyOnceWith("set_paused", args));
  expect(screen.getByLabelText(/이야기 간격/)).toHaveProperty("value", "12");
});

it("discards automatic and failed model drafts when navigating away without saving", async () => {
  render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="automatic" />);
  fireEvent.change(screen.getByLabelText(/이야기 간격/), { target: { value: "12" } });
  fireEvent.click(screen.getByRole("tab", { name: "AI 연결" }));
  expect(screen.getByLabelText("이 기기의 모델")).toBeTruthy();
  fireEvent.click(screen.getByRole("switch", { name: "로컬 추론 모드" }));
  fireEvent.change(screen.getByLabelText("대화에 쓸 AI"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("API 주소"), {
    target: { value: "https://example.com/v1" },
  });
  fireEvent.change(screen.getByLabelText("API 키"), { target: { value: " draft-key " } });
  vi.mocked(command).mockRejectedValueOnce(new Error("저장 실패"));
  fireEvent.click(screen.getByRole("button", { name: "AI 연결 저장" }));
  await screen.findByText("저장 실패");
  expect(screen.getByLabelText("API 키")).toHaveProperty("value", " draft-key ");
  fireEvent.click(screen.getByRole("tab", { name: "대화" }));
  expect(screen.getByLabelText(/이야기 간격/)).toHaveProperty(
    "value",
    String(PREVIEW_SNAPSHOT.settings.idleMinutes),
  );
  expect(screen.queryByRole("button", { name: "자동 대화 저장" })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "AI 연결" }));
  expect(screen.getByLabelText("대화에 쓸 AI")).toHaveProperty("value", "local");
  expect(screen.getByRole("switch", { name: "로컬 추론 모드" })).toHaveProperty("checked", false);
  expect(screen.queryByRole("button", { name: "AI 연결 저장" })).toBeNull();
  fireEvent.change(screen.getByLabelText("대화에 쓸 AI"), { target: { value: "custom" } });
  expect(screen.getByLabelText("API 주소")).toHaveProperty(
    "value",
    PREVIEW_SNAPSHOT.settings.baseUrl,
  );
  expect(screen.getByLabelText("API 키")).toHaveProperty("value", "");
  expect(command).toHaveBeenCalledTimes(1);
});

it("tests and saves the local reasoning draft and restores the saved toggle on cancel", async () => {
  const snapshot = {
    ...PREVIEW_SNAPSHOT,
    settings: {
      ...PREVIEW_SNAPSHOT.settings,
      localModel: "custom" as const,
      localModelPath: "/models/example.gguf",
    },
  };
  vi.mocked(command).mockImplementation(async (name) =>
    name === "test_local_model" ? { elapsedMs: 1500, reply: "안녕" } : undefined,
  );
  const { rerender } = render(<SettingsPanel snapshot={snapshot} initialSection="model" />);
  const toggle = screen.getByRole("switch", { name: "로컬 추론 모드" });
  expect(toggle).toHaveProperty("checked", false);
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: "확인하기" }));
  await screen.findAllByText("1.5초 · 안녕");
  expect(command).toHaveBeenCalledExactlyOnceWith("test_local_model", {
    settings: { ...snapshot.settings, localReasoningEnabled: true },
  });
  fireEvent.click(screen.getByRole("button", { name: "AI 연결 저장" }));
  await screen.findAllByText("AI 연결을 저장했어요.");
  expect(command).toHaveBeenLastCalledWith("save_settings", {
    settings: { ...snapshot.settings, localReasoningEnabled: true },
    scope: "model",
    apiKey: null,
  });
  rerender(
    <SettingsPanel
      snapshot={{
        ...snapshot,
        settings: { ...snapshot.settings, localReasoningEnabled: true },
      }}
    />,
  );
  fireEvent.click(toggle);
  expect(toggle).toHaveProperty("checked", false);
  fireEvent.click(screen.getByRole("button", { name: "변경 취소" }));
  expect(toggle).toHaveProperty("checked", true);
});

it("shows how the chosen model fits this computer and offers the recommended one", () => {
  const snapshot = {
    ...PREVIEW_SNAPSHOT,
    device: { totalMemory: 16 * 2 ** 30, appleSilicon: true, platform: "macos" as const },
    localModels: PREVIEW_SNAPSHOT.localModels.map((model) => ({
      ...model,
      fit: model.id === "gemma-4-12b" ? ("tight" as const) : ("fits" as const),
      recommended: model.id === "qwen3.5-9b",
    })),
  };
  render(<SettingsPanel snapshot={snapshot} initialSection="model" />);
  expect(screen.getByText(/이 컴퓨터에 알맞아요/)).toBeTruthy();
  expect(screen.getByRole("option", { name: /^Qwen3\.5-9B · .* · 이 컴퓨터 추천$/ })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("이 기기의 모델"), { target: { value: "qwen3.5-9b" } });
  expect(screen.getByLabelText("이 기기의 모델")).toHaveProperty("value", "qwen3.5-9b");
});

it.each([
  ["kanana-1.5-2.1b-instruct-2505", "Kanana 1.5 2.1B Instruct", "1.52"],
  ["kanana-1.5-8b-instruct-2505", "Kanana 1.5 8B Instruct", "4.92"],
])(
  "keeps experimental Korean candidate %s selectable without recommending it",
  async (id, name, size) => {
    render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="model" />);
    const select = screen.getByLabelText("이 기기의 모델");
    expect(select).toHaveProperty("value", "qwen3.5-4b");
    const option = screen.getByRole("option", { name: new RegExp(`^${name} ·`) });
    expect(option.textContent).toContain("한국어");
    expect(option.textContent).toContain("실험");
    expect(option.textContent).toContain("실제 대화 미검증");
    expect(option.textContent).not.toContain("이 컴퓨터 추천");
    fireEvent.change(select, { target: { value: id } });
    expect(select).toHaveProperty("value", id);
    expect(screen.getAllByText(new RegExp(`${size}GB`)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/위젯 제작 가능/)).toBeNull();
    expect(command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "변경 취소" }));
    expect(select).toHaveProperty("value", "qwen3.5-4b");
    fireEvent.change(select, { target: { value: id } });
    fireEvent.click(screen.getByRole("button", { name: "AI 연결 저장" }));
    await waitFor(() =>
      expect(command).toHaveBeenLastCalledWith("save_settings", {
        settings: { ...PREVIEW_SNAPSHOT.settings, localModel: id },
        scope: "model",
        apiKey: null,
      }),
    );
  },
);

it.each([
  ["qwen3.5-27b", "Qwen3.5-27B", "Q4_K_M", "16.74"],
  ["ministral-3-14b", "Ministral 3 14B Instruct", "Q4_K_M", "8.24"],
  ["ministral-3-14b-q5-k-m", "Ministral 3 14B Instruct", "Q5_K_M", "9.62"],
])(
  "selects manual experimental model %s with its actual quantization",
  async (id, name, quantization, size) => {
    render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="model" />);
    const select = screen.getByLabelText("이 기기의 모델");
    expect(select).toHaveProperty("value", "qwen3.5-4b");
    const option = screen.getByRole("option", { name: new RegExp(`^${name} · ${quantization} ·`) });
    expect(option.textContent).toContain("수동 선택");
    expect(option.textContent).toContain("실험");
    expect(option.textContent).not.toContain("이 컴퓨터 추천");
    fireEvent.change(select, { target: { value: id } });
    expect(screen.getByText(`${name} · ${quantization}`)).toBeTruthy();
    expect(screen.getByText(`0.00GB / ${size}GB`)).toBeTruthy();
    expect(screen.getByText(/위젯 제작 가능/)).toBeTruthy();
    expect(command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "AI 연결 저장" }));
    await waitFor(() =>
      expect(command).toHaveBeenLastCalledWith("save_settings", {
        settings: { ...PREVIEW_SNAPSHOT.settings, localModel: id },
        scope: "model",
        apiKey: null,
      }),
    );
  },
);

it("asks before downloading a model that this computer's memory cannot hold", async () => {
  const snapshot = {
    ...PREVIEW_SNAPSHOT,
    device: { totalMemory: 8 * 2 ** 30, appleSilicon: true, platform: "macos" as const },
    localModels: PREVIEW_SNAPSHOT.localModels.map((model) => ({
      ...model,
      fit: "insufficient" as const,
    })),
  };
  render(<SettingsPanel snapshot={snapshot} initialSection="model" />);
  fireEvent.click(screen.getByRole("button", { name: "내려받기" }));
  expect(command).not.toHaveBeenCalled();
  const dialog = screen.getByRole("dialog");
  expect(dialog.textContent).toContain("메모리로는 실행되지 않거나 매우 느릴 수 있어요");
  fireEvent.click(within(dialog).getByRole("button", { name: "내려받기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("download_model", { model: "qwen3.5-4b" }),
  );
});

it("allows keyless loopback API tests but requires a key for remote or spoofed addresses", async () => {
  render(
    <SettingsPanel snapshot={{ ...PREVIEW_SNAPSHOT, hasApiKey: false }} initialSection="model" />,
  );
  fireEvent.change(screen.getByLabelText("대화에 쓸 AI"), { target: { value: "custom" } });
  const address = screen.getByLabelText("API 주소");
  const testButton = screen.getByRole("button", { name: "다시 확인" });
  fireEvent.change(screen.getByLabelText("모델 이름"), { target: { value: "local-model" } });
  for (const baseUrl of [
    "http://localhost:11434/v1",
    "http://127.0.0.1:1234/v1",
    "http://[::1]:1234/v1",
  ]) {
    fireEvent.change(address, { target: { value: baseUrl } });
    expect(testButton).toHaveProperty("disabled", false);
  }
  fireEvent.click(testButton);
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("test_connection", {
      settings: {
        ...PREVIEW_SNAPSHOT.settings,
        baseUrl: "http://[::1]:1234/v1",
        apiModel: "local-model",
        mode: "api",
      },
      apiKey: null,
    }),
  );
  for (const baseUrl of [
    "https://example.com/v1",
    "https://192.168.1.2/v1",
    "https://localhost.example.com/v1",
    "http://evil.example@localhost/v1",
    "http://localhost/v1?",
    "http://localhost/v1#",
  ]) {
    fireEvent.change(address, { target: { value: baseUrl } });
    expect(testButton).toHaveProperty("disabled", true);
  }
});

it("does not reuse a saved API key for a different draft address", () => {
  render(
    <SettingsPanel
      snapshot={{
        ...PREVIEW_SNAPSHOT,
        hasApiKey: true,
        settings: {
          ...PREVIEW_SNAPSHOT.settings,
          baseUrl: "https://saved.example/v1",
          apiModel: "remote-model",
        },
      }}
      initialSection="model"
    />,
  );
  fireEvent.change(screen.getByLabelText("대화에 쓸 AI"), { target: { value: "custom" } });
  const testButton = screen.getByRole("button", { name: "다시 확인" });
  expect(testButton).toHaveProperty("disabled", false);
  fireEvent.change(screen.getByLabelText("API 주소"), {
    target: { value: "https://other.example/v1" },
  });
  expect(testButton).toHaveProperty("disabled", true);
});

it("discards an invalid interval and uses the latest saved values on returning", () => {
  const { rerender } = render(
    <SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="automatic" />,
  );
  fireEvent.change(screen.getByLabelText(/이야기 간격/), { target: { value: "0" } });
  expect(screen.getByRole("button", { name: "자동 대화 저장" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("tab", { name: "AI 연결" }));
  fireEvent.change(screen.getByLabelText("대화에 쓸 AI"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("모델 이름"), { target: { value: "other-model" } });
  expect(screen.getByRole("button", { name: "AI 연결 저장" })).toHaveProperty("disabled", false);
  rerender(
    <SettingsPanel
      snapshot={{ ...PREVIEW_SNAPSHOT, settings: { ...PREVIEW_SNAPSHOT.settings, idleMinutes: 7 } }}
    />,
  );
  fireEvent.click(screen.getByRole("tab", { name: "대화" }));
  expect(screen.queryByRole("button", { name: "변경 취소" })).toBeNull();
  expect(screen.getByLabelText(/이야기 간격/)).toHaveProperty("value", "7");
});

it("shows only the selected connection editor and retains both drafts without changing actual use", () => {
  render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="model" />);
  expect(screen.queryByRole("button", { name: "연결 테스트" })).toBeNull();
  fireEvent.change(screen.getByLabelText("대화에 쓸 AI"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("API 주소"), {
    target: { value: "http://localhost:1234/v1" },
  });
  fireEvent.change(screen.getByLabelText("API 키"), { target: { value: "unsaved-key" } });
  expect(screen.queryByRole("button", { name: "테스트하기" })).toBeNull();
  expect(screen.getByText("저장 후 전환")).toBeTruthy();
  expect(screen.getByText(/현재 사용 · 이 기기의 모델/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText("대화에 쓸 AI"), { target: { value: "local" } });
  expect(screen.queryByRole("button", { name: "연결 테스트" })).toBeNull();
  fireEvent.change(screen.getByLabelText("대화에 쓸 AI"), { target: { value: "custom" } });
  expect(screen.getByLabelText("API 주소")).toHaveProperty("value", "http://localhost:1234/v1");
  expect(screen.getByLabelText("API 키")).toHaveProperty("value", "unsaved-key");
  expect(command).not.toHaveBeenCalled();
});

it("locks automatic and model save actions while an update is being checked", async () => {
  vi.mocked(isDesktop).mockReturnValue(true);
  const idle = {
    phase: "idle",
    version: null,
    notes: null,
    downloaded: 0,
    total: null,
    message: null,
  };
  let finishCheck: (value: typeof idle) => void = () => {};
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_update_status") return idle;
    if (name === "get_autostart_enabled") return false;
    if (name === "get_desktop_preferences")
      return { charactersVisible: true, pranksEnabled: false, allowedToys: ["ball"] };
    if (name === "check_app_update")
      return new Promise((resolve) => {
        finishCheck = resolve;
      });
    return undefined;
  });
  render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="automatic" />);
  fireEvent.change(screen.getByLabelText(/이야기 간격/), { target: { value: "12" } });
  fireEvent.click(screen.getByRole("tab", { name: "AI 연결" }));
  fireEvent.change(screen.getByLabelText("대화에 쓸 AI"), { target: { value: "custom" } });
  fireEvent.change(screen.getByLabelText("API 주소"), {
    target: { value: "http://localhost:1234/v1" },
  });
  fireEvent.click(screen.getByRole("tab", { name: "일반" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_update_status"));
  fireEvent.click(screen.getByRole("button", { name: "지금 확인" }));
  fireEvent.click(screen.getByRole("tab", { name: "대화" }));
  expect(screen.getByRole("group", { name: "설정 내용" })).toHaveProperty("disabled", true);
  expect(screen.getByLabelText(/이야기 간격/)).toHaveProperty(
    "value",
    String(PREVIEW_SNAPSHOT.settings.idleMinutes),
  );
  fireEvent.click(screen.getByRole("tab", { name: "AI 연결" }));
  expect(screen.getByRole("group", { name: "설정 내용" })).toHaveProperty("disabled", true);
  expect(screen.queryByRole("button", { name: "AI 연결 저장" })).toBeNull();
  await act(async () => finishCheck(idle));
  await waitFor(() =>
    expect(screen.getByRole("group", { name: "설정 내용" })).toHaveProperty("disabled", false),
  );
  expect(screen.getByLabelText("대화에 쓸 AI")).toHaveProperty("value", "local");
});

it("discards personal wordbook and memory drafts across management tabs", async () => {
  vi.mocked(isDesktop).mockReturnValue(true);
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "list_memories") {
      return {
        items: [{ id: "memory", content: "기존 기억", sourceMessageId: "source", updatedAt: 1 }],
        total: 1,
        offset: 0,
        nextOffset: null,
        revision: 1,
      };
    }
    if (name === "count_character_memories") {
      return 0;
    }
    if (name === "get_talk_packs") {
      return [];
    }
  });
  const snapshot = {
    ...PREVIEW_SNAPSHOT,
    wordbook: [
      {
        id: "entry",
        title: "인사",
        keywords: ["안녕"],
        enabled: true,
        useForIdle: false,
        lines: [{ persona: "a" as const, expression: "평온", text: "안녕" }],
      },
    ],
    memoryCount: 1,
    memoryRevision: 1,
  };
  const { rerender } = render(<SettingsPanel snapshot={snapshot} initialSection="wordbook" />);
  const matching = screen.getByText("입력으로 매칭 확인");
  expect(matching.closest("details")).toHaveProperty("open", true);
  fireEvent.change(screen.getByRole("textbox", { name: "테스트할 말" }), {
    target: { value: "나중에 확인할 말" },
  });
  fireEvent.click(matching);
  fireEvent.change(screen.getByLabelText("대사 1"), {
    target: { value: "  쓰던 말\n\n다음 줄  " },
  });
  fireEvent.click(screen.getByRole("tab", { name: "친구들" }));
  selectFriend(/^A /);
  openCharacterPage("기억");
  fireEvent.change(await screen.findByLabelText("기억 내용"), { target: { value: "쓰던 기억" } });
  fireEvent.click(screen.getByRole("tab", { name: "위젯" }));
  rerender(<SettingsPanel snapshot={{ ...snapshot, wordbook: [...snapshot.wordbook] }} />);
  fireEvent.click(screen.getByRole("tab", { name: "대화" }));
  fireEvent.click(screen.getByRole("button", { name: /단어장/ }));
  expect(screen.getByLabelText("대사 1")).toHaveProperty("value", "안녕");
  fireEvent.click(screen.getByText("입력으로 매칭 확인"));
  expect(screen.getByRole("textbox", { name: "테스트할 말" })).toHaveProperty("value", "");
  fireEvent.click(screen.getByRole("tab", { name: "친구들" }));
  selectFriend(/^A /);
  openCharacterPage("기억");
  expect(await screen.findByLabelText("기억 내용")).toHaveProperty("value", "기존 기억");
}, 15_000);

it("saves opt-in local quiet hours with starting weekdays", async () => {
  render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="automatic" />);
  const enabled = screen.getByRole("switch", { name: "정해진 시간에 자동 잡담 쉬기" });
  expect(enabled).toHaveProperty("checked", false);
  expect(screen.getByLabelText("조용한 시간 시작").closest("fieldset")).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(enabled);
  fireEvent.change(screen.getByLabelText("조용한 시간 시작"), { target: { value: "23:30" } });
  fireEvent.change(screen.getByLabelText("조용한 시간 종료"), { target: { value: "07:00" } });
  fireEvent.click(screen.getByRole("button", { name: "일요일" }));
  expect(screen.getByText(/자정을 넘기면 시작한 요일/)).toBeTruthy();
  expect(screen.getByLabelText("조용한 시간 시작")).toHaveProperty("value", "23:30");
  fireEvent.click(screen.getByRole("button", { name: "자동 대화 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("save_settings", {
      settings: {
        ...PREVIEW_SNAPSHOT.settings,
        quietHours: { enabled: true, start: "23:30", end: "07:00", weekdays: [0, 1, 2, 3, 4, 5] },
      },
      scope: "automatic",
      apiKey: null,
    }),
  );
});

it("validates active quiet hours and cancel restores the latest saved schedule", () => {
  const { rerender } = render(
    <SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="automatic" />,
  );
  fireEvent.click(screen.getByRole("switch", { name: "정해진 시간에 자동 잡담 쉬기" }));
  fireEvent.change(screen.getByLabelText("조용한 시간 종료"), { target: { value: "22:00" } });
  expect(screen.getByRole("alert").textContent).toContain("시작과 종료 시각을 다르게");
  expect(screen.getByRole("button", { name: "자동 대화 저장" })).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("조용한 시간 종료"), { target: { value: "08:00" } });
  for (const name of ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"]) {
    fireEvent.click(screen.getByRole("button", { name }));
  }
  expect(screen.getByRole("alert").textContent).toContain("요일을 하나 이상");
  expect(screen.getByRole("button", { name: "자동 대화 저장" })).toHaveProperty("disabled", true);
  const latest = {
    ...PREVIEW_SNAPSHOT,
    settings: {
      ...PREVIEW_SNAPSHOT.settings,
      quietHours: { enabled: true, start: "21:00", end: "06:00", weekdays: [4] },
    },
  };
  rerender(<SettingsPanel snapshot={latest} />);
  fireEvent.click(screen.getByRole("button", { name: "변경 취소" }));
  expect(screen.getByLabelText("조용한 시간 시작")).toHaveProperty("value", "21:00");
  expect(screen.getByRole("button", { name: "금요일" }).getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByRole("button", { name: "월요일" }).getAttribute("aria-pressed")).toBe("false");
  expect(screen.queryByRole("alert")).toBeNull();
});
