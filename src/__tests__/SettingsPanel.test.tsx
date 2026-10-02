import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SettingsPanel } from "../components/SettingsPanel/SettingsPanel";
import { PREVIEW_SNAPSHOT, command, isDesktop } from "../hooks/useSnapshot";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(() => false),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(isDesktop).mockReturnValue(false);
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(undefined);
});

it("opens all eight destinations directly with keyboard navigation", () => {
  render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} />);
  expect(screen.getByRole("heading", { level: 1, name: "캐릭터" })).toBeTruthy();
  expect(screen.getAllByRole("main")).toHaveLength(1);
  const tabs = screen.getByRole("tablist", { name: "설정 항목" });
  expect(within(tabs).getAllByRole("tab")).toHaveLength(8);
  fireEvent.keyDown(within(tabs).getByRole("tab", { name: "캐릭터" }), { key: "ArrowDown" });
  expect(screen.getByRole("heading", { level: 1, name: "위젯" })).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "End" });
  expect(screen.getByRole("heading", { level: 1, name: "일반" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "앱 업데이트" })).toBeTruthy();
  fireEvent.keyDown(document.activeElement!, { key: "Home" });
  expect(screen.getByRole("heading", { level: 1, name: "캐릭터" })).toBeTruthy();
});

it("retains separate model and automatic drafts and only saves the chosen scope", async () => {
  const { rerender } = render(
    <SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="automatic" />,
  );
  fireEvent.change(screen.getByLabelText(/이야기 간격/), { target: { value: "12" } });
  fireEvent.click(screen.getByRole("tab", { name: "AI 연결" }));
  expect(screen.getByLabelText("로컬 모델")).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: "로컬 추론 모드" }));
  fireEvent.change(screen.getByLabelText("API 주소"), {
    target: { value: "https://example.com/v1" },
  });
  fireEvent.change(screen.getByLabelText("API 키"), { target: { value: " draft-key " } });
  vi.mocked(command).mockRejectedValueOnce(new Error("저장 실패"));
  fireEvent.click(screen.getByRole("button", { name: "AI 연결 저장" }));
  await screen.findByText("저장 실패");
  expect(command).toHaveBeenLastCalledWith("save_settings", {
    settings: {
      ...PREVIEW_SNAPSHOT.settings,
      baseUrl: "https://example.com/v1",
      localReasoningEnabled: true,
    },
    scope: "model",
    apiKey: "draft-key",
  });
  fireEvent.click(screen.getByRole("tab", { name: /자동 대화/ }));
  expect(screen.getByLabelText(/이야기 간격/)).toHaveProperty("value", "12");
  fireEvent.click(screen.getByRole("button", { name: "자동 대화 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("save_settings", {
      settings: { ...PREVIEW_SNAPSHOT.settings, idleMinutes: 12 },
      scope: "automatic",
      apiKey: null,
    }),
  );
  rerender(
    <SettingsPanel
      snapshot={{
        ...PREVIEW_SNAPSHOT,
        settings: { ...PREVIEW_SNAPSHOT.settings, idleMinutes: 12 },
      }}
    />,
  );
  fireEvent.click(screen.getByRole("tab", { name: /AI 연결/ }));
  expect(screen.getByLabelText("API 키")).toHaveProperty("value", " draft-key ");
  expect(screen.getByLabelText("API 주소")).toHaveProperty("value", "https://example.com/v1");
  expect(screen.getByRole("checkbox", { name: "로컬 추론 모드" })).toHaveProperty("checked", true);
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
  const toggle = screen.getByRole("checkbox", { name: "로컬 추론 모드" });
  expect(toggle).toHaveProperty("checked", false);
  fireEvent.click(toggle);
  fireEvent.click(screen.getByRole("button", { name: "테스트하기" }));
  await screen.findByText("1.5초 · 안녕");
  expect(command).toHaveBeenCalledExactlyOnceWith("test_local_model", {
    settings: { ...snapshot.settings, localReasoningEnabled: true },
  });
  fireEvent.click(screen.getByRole("button", { name: "AI 연결 저장" }));
  await screen.findByText("AI 연결을 저장했어요.");
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
    device: { totalMemory: 16 * 2 ** 30, appleSilicon: true },
    localModels: PREVIEW_SNAPSHOT.localModels.map((model) => ({
      ...model,
      fit: model.id === "gemma-4-12b" ? ("tight" as const) : ("fits" as const),
      recommended: model.id === "qwen3.5-9b",
    })),
  };
  render(<SettingsPanel snapshot={snapshot} initialSection="model" />);
  expect(screen.getByText("이 컴퓨터에 알맞아요 · 메모리 16GB, Apple Silicon 기준 추정")).toBeTruthy();
  expect(screen.getByRole("option", { name: /^Qwen3\.5-9B · .* · 이 컴퓨터 추천$/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "추천 모델 선택" }));
  expect(screen.getByLabelText("로컬 모델")).toHaveProperty("value", "qwen3.5-9b");
  expect(screen.queryByRole("button", { name: "추천 모델 선택" })).toBeNull();
});

it.each([
  ["kanana-1.5-2.1b-instruct-2505", "Kanana 1.5 2.1B Instruct", "1.52"],
  ["kanana-1.5-8b-instruct-2505", "Kanana 1.5 8B Instruct", "4.92"],
])(
  "keeps experimental Korean candidate %s selectable without recommending it",
  async (id, name, size) => {
    render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="model" />);
    const select = screen.getByLabelText("로컬 모델");
    expect(select).toHaveProperty("value", "qwen3.5-4b");
    const option = screen.getByRole("option", { name: new RegExp(`^${name} ·`) });
    expect(option.textContent).toContain("한국어");
    expect(option.textContent).toContain("실험");
    expect(option.textContent).toContain("실제 대화 미검증");
    expect(option.textContent).not.toContain("이 컴퓨터 추천");
    fireEvent.change(select, { target: { value: id } });
    expect(select).toHaveProperty("value", id);
    expect(screen.getByText(`${name} Q4_K_M · 다운로드 ${size} GB`)).toBeTruthy();
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

it("asks before downloading a model that this computer's memory cannot hold", async () => {
  const snapshot = {
    ...PREVIEW_SNAPSHOT,
    device: { totalMemory: 8 * 2 ** 30, appleSilicon: true },
    localModels: PREVIEW_SNAPSHOT.localModels.map((model) => ({
      ...model,
      fit: "insufficient" as const,
    })),
  };
  render(<SettingsPanel snapshot={snapshot} initialSection="model" />);
  fireEvent.click(screen.getByRole("button", { name: "모델 내려받기" }));
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
  const address = screen.getByLabelText("API 주소");
  const testButton = screen.getByRole("button", { name: "연결 테스트" });
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
  const testButton = screen.getByRole("button", { name: "연결 테스트" });
  expect(testButton).toHaveProperty("disabled", false);
  fireEvent.change(screen.getByLabelText("API 주소"), {
    target: { value: "https://other.example/v1" },
  });
  expect(testButton).toHaveProperty("disabled", true);
});

it("invalid automatic interval does not block AI edits and cancel restores latest saved values", () => {
  const { rerender } = render(
    <SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="automatic" />,
  );
  fireEvent.change(screen.getByLabelText(/이야기 간격/), { target: { value: "0" } });
  expect(screen.getByRole("button", { name: "자동 대화 저장" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("tab", { name: "AI 연결" }));
  fireEvent.change(screen.getByLabelText("모델 이름"), { target: { value: "other-model" } });
  expect(screen.getByRole("button", { name: "AI 연결 저장" })).toHaveProperty("disabled", false);
  rerender(
    <SettingsPanel
      snapshot={{ ...PREVIEW_SNAPSHOT, settings: { ...PREVIEW_SNAPSHOT.settings, idleMinutes: 7 } }}
    />,
  );
  fireEvent.click(screen.getByRole("tab", { name: /자동 대화/ }));
  fireEvent.click(screen.getByRole("button", { name: "변경 취소" }));
  expect(screen.getByLabelText(/이야기 간격/)).toHaveProperty("value", "7");
});

it("preserves personal wordbook whitespace and memory drafts across management tabs", async () => {
  vi.mocked(isDesktop).mockReturnValue(true);
  vi.mocked(command).mockImplementation(async (name) =>
    name === "list_memories"
      ? {
          items: [{ id: "memory", content: "기존 기억", sourceMessageId: "source", updatedAt: 1 }],
          total: 1,
          offset: 0,
          nextOffset: null,
          revision: 1,
        }
      : name === "count_character_memories"
        ? 0
        : undefined,
  );
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
  fireEvent.change(screen.getByLabelText("대사 1"), {
    target: { value: "  쓰던 말\n\n다음 줄  " },
  });
  fireEvent.click(screen.getByRole("tab", { name: /캐릭터/ }));
  fireEvent.click(screen.getByRole("tab", { name: "기억" }));
  fireEvent.change(await screen.findByLabelText("기억 내용"), { target: { value: "쓰던 기억" } });
  fireEvent.click(screen.getByRole("tab", { name: "위젯" }));
  rerender(<SettingsPanel snapshot={{ ...snapshot, wordbook: [...snapshot.wordbook] }} />);
  fireEvent.click(screen.getByRole("tab", { name: /개인 단어장/ }));
  expect(screen.getByLabelText("대사 1")).toHaveProperty("value", "  쓰던 말\n\n다음 줄  ");
  fireEvent.click(screen.getByRole("tab", { name: /캐릭터/ }));
  fireEvent.click(screen.getByRole("tab", { name: "기억" }));
  expect(screen.getByLabelText("기억 내용")).toHaveProperty("value", "쓰던 기억");
});

it("saves opt-in local quiet hours with starting weekdays and retains the draft across tabs", async () => {
  render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="automatic" />);
  const enabled = screen.getByRole("checkbox", { name: "정해진 시간에 자동 잡담 쉬기" });
  expect(enabled).toHaveProperty("checked", false);
  expect(screen.getByLabelText("조용한 시간 시작").closest("fieldset")).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(enabled);
  fireEvent.change(screen.getByLabelText("조용한 시간 시작"), { target: { value: "23:30" } });
  fireEvent.change(screen.getByLabelText("조용한 시간 종료"), { target: { value: "07:00" } });
  fireEvent.click(screen.getByRole("checkbox", { name: "일요일" }));
  expect(screen.getByText(/기기 지역 시각/)).toBeTruthy();
  expect(screen.getByText(/월요일 22:00~08:00은 화요일 아침까지/)).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "AI 연결" }));
  fireEvent.click(screen.getByRole("tab", { name: /자동 대화/ }));
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
  fireEvent.click(screen.getByRole("checkbox", { name: "정해진 시간에 자동 잡담 쉬기" }));
  fireEvent.change(screen.getByLabelText("조용한 시간 종료"), { target: { value: "22:00" } });
  expect(screen.getByRole("alert").textContent).toContain("시작과 종료 시각을 다르게");
  expect(screen.getByRole("button", { name: "자동 대화 저장" })).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("조용한 시간 종료"), { target: { value: "08:00" } });
  for (const name of ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"]) {
    fireEvent.click(screen.getByRole("checkbox", { name }));
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
  expect(screen.getByRole("checkbox", { name: "금요일" })).toHaveProperty("checked", true);
  expect(screen.getByRole("checkbox", { name: "월요일" })).toHaveProperty("checked", false);
  expect(screen.queryByRole("alert")).toBeNull();
});
