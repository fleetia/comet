import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { SettingsPanel } from "../components/SettingsPanel/SettingsPanel";
import { PREVIEW_SNAPSHOT, command } from "../hooks/useSnapshot";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
}));
afterEach(cleanup);
beforeEach(() => {
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
  fireEvent.change(screen.getByLabelText("API 주소"), {
    target: { value: "https://example.com/v1" },
  });
  fireEvent.change(screen.getByLabelText("API 키"), { target: { value: " draft-key " } });
  vi.mocked(command).mockRejectedValueOnce(new Error("저장 실패"));
  fireEvent.click(screen.getByRole("button", { name: "AI 연결 저장" }));
  await screen.findByText("저장 실패");
  expect(command).toHaveBeenLastCalledWith("save_settings", {
    settings: { ...PREVIEW_SNAPSHOT.settings, baseUrl: "https://example.com/v1" },
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

it("preserves personal wordbook whitespace and memory drafts across management tabs", () => {
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
    memories: [{ id: "memory", content: "기존 기억", sourceMessageId: "source", updatedAt: 1 }],
  };
  const { rerender } = render(<SettingsPanel snapshot={snapshot} initialSection="wordbook" />);
  fireEvent.change(screen.getByLabelText("대사 1"), {
    target: { value: "  쓰던 말\n\n다음 줄  " },
  });
  fireEvent.click(screen.getByRole("tab", { name: /기억/ }));
  fireEvent.change(screen.getByLabelText("기억 내용"), { target: { value: "쓰던 기억" } });
  fireEvent.click(screen.getByRole("tab", { name: "위젯" }));
  rerender(
    <SettingsPanel
      snapshot={{ ...snapshot, wordbook: [...snapshot.wordbook], memories: [...snapshot.memories] }}
    />,
  );
  fireEvent.click(screen.getByRole("tab", { name: /개인 단어장/ }));
  expect(screen.getByLabelText("대사 1")).toHaveProperty("value", "  쓰던 말\n\n다음 줄  ");
  fireEvent.click(screen.getByRole("tab", { name: /기억/ }));
  expect(screen.getByLabelText("기억 내용")).toHaveProperty("value", "쓰던 기억");
});
