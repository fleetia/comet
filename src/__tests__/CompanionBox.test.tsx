import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CompanionBox } from "../components/CompanionBox/CompanionBox";
import { Balloon } from "../components/Balloon/Balloon";
import { PREVIEW_SNAPSHOT, command, isDesktop } from "../hooks/useSnapshot";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(() => false),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ listen: vi.fn().mockResolvedValue(() => {}) }),
}));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => {
  vi.mocked(command)
    .mockReset()
    .mockImplementation(async (name) =>
      name === "get_character_gesture_settings" ? { doubleClickMs: 500 } : undefined,
    );
  vi.mocked(isDesktop).mockReturnValue(false);
});

it("hides the characters from the internal X without opening their menu", async () => {
  vi.mocked(isDesktop).mockReturnValue(true);
  render(<CompanionBox id="builtin-a" snapshot={PREVIEW_SNAPSHOT} />);
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 숨기기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("hide_boxes"));
  expect(command).not.toHaveBeenCalledWith("open_panel", expect.anything());
  expect(command).not.toHaveBeenCalledWith("trigger_character_reaction");
});

it("waits to confirm a click reaction and routes right click to menu and double click to input", async () => {
  vi.useFakeTimers();
  vi.mocked(isDesktop).mockReturnValue(true);
  render(<CompanionBox id="builtin-a" snapshot={PREVIEW_SNAPSHOT} />);
  await act(async () => {});
  const body = screen.getByRole("button", { name: / 반응$/ });
  fireEvent.click(body, { detail: 1 });
  act(() => vi.advanceTimersByTime(499));
  expect(command).not.toHaveBeenCalledWith("trigger_character_reaction");
  act(() => vi.advanceTimersByTime(1));
  expect(command).toHaveBeenCalledWith("trigger_character_reaction");
  expect(command).not.toHaveBeenCalledWith("open_panel", expect.anything());

  fireEvent.contextMenu(body);
  expect(command).toHaveBeenCalledWith("open_panel", { persona: "builtin-a", mode: "menu" });
  fireEvent.click(body, { detail: 1 });
  fireEvent.click(body, { detail: 2 });
  fireEvent.doubleClick(body, { detail: 2 });
  act(() => vi.advanceTimersByTime(500));
  expect(command).toHaveBeenCalledWith("open_panel", { persona: "builtin-a", mode: "input" });
  expect(
    vi.mocked(command).mock.calls.filter(([name]) => name === "trigger_character_reaction"),
  ).toHaveLength(1);
});
function compose(): HTMLTextAreaElement {
  render(<Balloon snapshot={{ ...PREVIEW_SNAPSHOT, panel: { persona: "a", mode: "input" } }} />);
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "안녕하세요" } });
  return input;
}
describe("message composer", () => {
  it("does not send on Korean IME confirmation; sends after composition ends", async () => {
    vi.mocked(command).mockResolvedValue(undefined);
    const input = compose();
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(command).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input);
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(command).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(input.value).toBe(""));
    expect(command).toHaveBeenCalledWith("send_message", {
      content: "안녕하세요",
      target: "builtin-a",
      clientMessageId: expect.any(String),
    });
  });
  it("keeps draft after failed send and prevents duplicate submissions while pending", async () => {
    let rejectRequest: (error: Error) => void = () => {};
    vi.mocked(command).mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectRequest = reject;
        }),
    );
    const input = compose();
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(command).toHaveBeenCalledTimes(1);
    rejectRequest(new Error("연결에 실패했어요"));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "연결에 실패했어요");
    expect(input.value).toBe("안녕하세요");
  });
});

it("retries the latest user turn with its original both target after generation fails", async () => {
  vi.mocked(command).mockResolvedValue(undefined);
  render(
    <Balloon
      snapshot={{
        ...PREVIEW_SNAPSHOT,
        runtime: { ...PREVIEW_SNAPSHOT.runtime, phase: "error", error: "연결이 끊겼어요" },
        messages: [
          {
            id: "user-turn",
            role: "user",
            persona: "both",
            content: "안녕",
            expression: null,
            createdAt: 1,
            status: "complete",
          },
        ],
      }}
    />,
  );
  fireEvent.click(screen.getByText("다시 이야기하기"));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("retry_turn", { messageId: "user-turn", target: "both" }),
  );
});

it("shows foreground generation while automatic conversation is paused", () => {
  render(
    <Balloon
      snapshot={{
        ...PREVIEW_SNAPSHOT,
        panel: { persona: "a", mode: "input" },
        runtime: { ...PREVIEW_SNAPSHOT.runtime, phase: "generating", persona: "a", paused: true },
      }}
    />,
  );
  expect(screen.getByRole("status").textContent).toBe("답변 준비 중...");
  expect(screen.getByRole("status").querySelector('[aria-hidden="true"]')?.textContent).toBe("...");
});

it("shows waiting dots until dialogue arrives and clears them when generation stops", () => {
  const snapshot = { ...PREVIEW_SNAPSHOT, panel: null, playback: null };
  const { rerender } = render(
    <Balloon snapshot={{ ...snapshot, runtime: { ...snapshot.runtime, phase: "loading" } }} />,
  );
  expect(screen.getByText("답변 준비 중")).toBeTruthy();
  rerender(
    <Balloon snapshot={{ ...snapshot, runtime: { ...snapshot.runtime, phase: "generating" } }} />,
  );
  expect(screen.getByText("답변 준비 중")).toBeTruthy();
  rerender(
    <Balloon
      snapshot={{
        ...snapshot,
        runtime: { ...snapshot.runtime, phase: "generating" },
        playback: {
          id: "reply",
          persona: "a",
          expression: "기쁨",
          text: "안녕!",
          source: "llm",
          endsAt: 100,
          lineIndex: 0,
          lineCount: 1,
        },
      }}
    />,
  );
  expect(screen.getByText("안녕!")).toBeTruthy();
  expect(screen.queryByText("답변 준비 중")).toBeNull();
  for (const phase of ["idle", "error"] as const) {
    rerender(<Balloon snapshot={{ ...snapshot, runtime: { ...snapshot.runtime, phase } }} />);
    expect(screen.queryByText("답변 준비 중")).toBeNull();
  }
});

it("keeps resting bodies free of old dialogue and changes only the active actor expression", () => {
  const snapshot = {
    ...PREVIEW_SNAPSHOT,
    messages: [
      {
        id: "old",
        role: "assistant",
        persona: "b",
        content: "오래된 대사",
        expression: "장난",
        createdAt: 1,
        status: "complete",
      },
    ],
  };
  const { rerender } = render(<CompanionBox id="builtin-b" snapshot={snapshot} />);
  expect(
    screen.getByText(`[${PREVIEW_SNAPSHOT.characters.installed[1].definition.expressions.평온}]`),
  ).toBeTruthy();
  expect(screen.queryByText("오래된 대사")).toBeNull();
  expect(screen.queryByText(/친밀도/)).toBeNull();
  rerender(
    <CompanionBox
      id="builtin-b"
      snapshot={{
        ...snapshot,
        playback: {
          id: "now",
          persona: "a",
          expression: "기쁨",
          text: "지금 대사",
          source: "script",
          endsAt: 100,
          lineIndex: 0,
          lineCount: 2,
        },
      }}
    />,
  );
  expect(
    screen.getByText(`[${PREVIEW_SNAPSHOT.characters.installed[1].definition.expressions.평온}]`),
  ).toBeTruthy();
  fireEvent.contextMenu(screen.getByRole("button", { name: / 반응$/ }));
  expect(command).toHaveBeenCalledWith("open_panel", { persona: "builtin-b", mode: "menu" });
});

it("prioritizes the input panel over playback and keeps shared history chronological", () => {
  const snapshot = {
    ...PREVIEW_SNAPSHOT,
    playback: {
      id: "talk",
      persona: "a" as const,
      expression: "기쁨",
      text: "자동 대사",
      source: "script" as const,
      endsAt: 100,
      lineIndex: 0,
      lineCount: 2,
    },
    panel: { persona: "b" as const, mode: "input" as const },
  };
  const { rerender } = render(<Balloon snapshot={snapshot} />);
  expect(screen.queryByText("자동 대사")).toBeNull();
  expect(screen.getByRole("textbox")).toBeTruthy();
  rerender(
    <Balloon
      snapshot={{
        ...snapshot,
        panel: { persona: "b", mode: "history" },
        messages: [
          {
            id: "second",
            role: "assistant",
            persona: "b",
            content: "나중",
            expression: null,
            createdAt: 2,
            status: "complete",
          },
          {
            id: "first",
            role: "assistant",
            persona: "a",
            content: "먼저",
            expression: null,
            createdAt: 1,
            status: "complete",
          },
        ],
      }}
    />,
  );
  expect(
    screen.getByText("먼저").compareDocumentPosition(screen.getByText("나중")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.queryByText("자동 대사")).toBeNull();
});

it("switches from panel to current playback preserving wordbook whitespace and dismisses only the active view", async () => {
  vi.mocked(command).mockResolvedValue(undefined);
  const playback = {
    id: "wordbook-line",
    persona: "b" as const,
    expression: "평온",
    text: "  첫 줄\n\n둘째 줄  ",
    source: "wordbook" as const,
    endsAt: 100,
    lineIndex: 1,
    lineCount: 3,
  };
  const { rerender } = render(
    <Balloon snapshot={{ ...PREVIEW_SNAPSHOT, panel: { persona: "a", mode: "menu" }, playback }} />,
  );
  expect(screen.queryByLabelText("말풍선")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "패널 닫기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("close_panel", undefined));
  rerender(<Balloon snapshot={{ ...PREVIEW_SNAPSHOT, panel: null, playback }} />);
  expect(screen.getByLabelText("말풍선").querySelector('[aria-live="polite"]')?.textContent).toBe(
    playback.text,
  );
  fireEvent.click(screen.getByRole("button", { name: "이야기 닫기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("skip_talk", undefined));
  rerender(<Balloon snapshot={{ ...PREVIEW_SNAPSHOT, panel: null, playback: null }} />);
  expect(screen.getByLabelText("말풍선").querySelector('[aria-live="polite"]')?.textContent).toBe(
    "",
  );
});

it("routes grouped menu actions and retains an input draft through a menu round trip", async () => {
  vi.mocked(command).mockResolvedValue(undefined);
  const snapshot = {
    ...PREVIEW_SNAPSHOT,
    panel: { persona: "b" as const, mode: "input" as const },
  };
  const { rerender } = render(<Balloon snapshot={snapshot} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "  아직 쓰던 말\n다음 줄" } });
  fireEvent.click(screen.getByRole("button", { name: "메뉴로" }));
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("open_panel", { persona: "builtin-b", mode: "menu" }),
  );
  rerender(<Balloon snapshot={{ ...snapshot, panel: { persona: "b", mode: "menu" } }} />);
  for (const group of ["대화", "관리", "자동 잡담과 표시"]) {
    expect(screen.getByLabelText(group)).toBeTruthy();
  }
  for (const [label, name, args] of [
    ["캐릭터 관리", "open_characters", undefined],
    ["설정", "open_settings", undefined],
    ["자동 잡담 잠시 쉬기", "set_paused", { paused: true }],
    ["말 걸기", "open_panel", { persona: "builtin-b", mode: "input" }],
  ] as const) {
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(command).toHaveBeenLastCalledWith(name, args));
  }
  rerender(<Balloon snapshot={snapshot} />);
  expect(screen.getByRole("textbox")).toHaveProperty("value", "  아직 쓰던 말\n다음 줄");
});

it("opens the third character by identity and can address the full roster", async () => {
  const third = {
    ...PREVIEW_SNAPSHOT.characters.installed[0],
    id: "third-friend",
    definition: { ...PREVIEW_SNAPSHOT.characters.installed[0].definition, name: "셋째" },
  };
  const snapshot = {
    ...PREVIEW_SNAPSHOT,
    characters: {
      installed: [...PREVIEW_SNAPSHOT.characters.installed, third],
      active: [...PREVIEW_SNAPSHOT.characters.active, third.id],
    },
  };
  const body = render(<CompanionBox id={third.id} snapshot={snapshot} />);
  fireEvent.contextMenu(screen.getByRole("button", { name: "셋째 반응" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_panel", { persona: third.id, mode: "menu" }),
  );
  body.unmount();
  render(<Balloon snapshot={{ ...snapshot, panel: { persona: third.id, mode: "input" } }} />);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "all" } });
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "모두 안녕" } });
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("send_message", {
      content: "모두 안녕",
      target: "all",
      clientMessageId: expect.any(String),
    }),
  );
});
