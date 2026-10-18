import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Balloon } from "../components/Balloon/Balloon";
import { ConversationResponse } from "../components/Balloon/ConversationResponse";
import { PREVIEW_SNAPSHOT, command } from "../hooks/useSnapshot";
import type { Snapshot } from "../types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(() => false),
}));

beforeEach(() => {
  vi.mocked(command).mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function conversationSnapshot(draft = ""): Snapshot {
  return {
    ...PREVIEW_SNAPSHOT,
    panel: { persona: "builtin-a", mode: "input" },
    conversation: {
      session: {
        id: "surface-session",
        userId: "preview-user",
        participants: ["builtin-a"],
        status: "active",
        title: "하던 이야기",
        createdAt: 1,
        updatedAt: 2,
        continuedFrom: null,
        draft,
      },
      messages: [
        {
          id: "reply-one",
          role: "assistant",
          persona: "builtin-a",
          content: "  적어 둔 대답\n다음 줄  ",
          expression: "평온",
          createdAt: 2,
          status: "complete",
        },
      ],
      characterNames: { "reply-one": "기록에 남은 친구 이름" },
      messageSources: { "reply-one": "wordbook" },
      nextBefore: null,
    },
  };
}

it("keeps the desktop input compact and exposes existing options through more", () => {
  render(<Balloon snapshot={conversationSnapshot()} surface="input" preview />);
  const input = screen.getByRole("textbox", { name: /에게 할 말/ });
  expect(input.getAttribute("rows")).toBe("1");
  expect(input.getAttribute("maxlength")).toBe("2000");
  expect(screen.queryByRole("button", { name: "메뉴로" })).toBeNull();
  const options = screen.getByText("더보기").closest("details");
  expect(options).toHaveProperty("open", false);
  expect(screen.queryByText("  적어 둔 대답\n다음 줄  ", { exact: true })).toBeNull();
  expect(screen.getByRole("button", { name: "지난 대화" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "이어서 하기" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "함께 이야기해 봐" })).toBeTruthy();
  fireEvent.click(screen.getByText("더보기"));
  expect(options).toHaveProperty("open", true);
  expect(screen.getByRole("button", { name: "대화 접어 두기" })).toBeTruthy();
  expect(screen.getByRole("combobox", { name: /받는 친구/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: "AI 연결 설정" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "대화 끝내기" })).toBeTruthy();
  expect(screen.getByText("이번 대화")).toBeTruthy();
});

it("saves the current draft before resuming a paused conversation from the shortcut", async () => {
  const snapshot = conversationSnapshot();
  const prior = {
    ...snapshot.conversation!,
    session: { ...snapshot.conversation!.session, id: "paused-session", status: "paused" as const },
  };
  render(<Balloon snapshot={snapshot} surface="input" preview previewConversations={[prior]} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "돌아와서 쓸 초안" } });
  fireEvent.click(screen.getByRole("button", { name: "이어서 하기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("resume_chat", { sessionId: "paused-session" }),
  );
  expect(vi.mocked(command).mock.calls).toEqual([
    [
      "save_conversation_draft",
      { sessionId: "surface-session", draft: "돌아와서 쓸 초안", inputOwner: "desktop" },
    ],
    ["resume_chat", { sessionId: "paused-session" }],
  ]);
});

it("opens past chats when there is no paused chat and saves the pending draft first", async () => {
  render(<Balloon snapshot={conversationSnapshot()} surface="input" preview />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "지난 대화를 열기 전 초안" } });
  fireEvent.click(screen.getByRole("button", { name: "이어서 하기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_panel", { persona: "builtin-a", mode: "history" }),
  );
  expect(vi.mocked(command).mock.calls[0]).toEqual([
    "save_conversation_draft",
    { sessionId: "surface-session", draft: "지난 대화를 열기 전 초안", inputOwner: "desktop" },
  ]);
  expect(command).not.toHaveBeenCalledWith("get_conversation_notes");
  expect(command).not.toHaveBeenCalledWith("resume_chat", expect.anything());
});

it("saves the draft before asking the characters to talk together", async () => {
  render(<Balloon snapshot={conversationSnapshot()} surface="input" preview />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "잠깐 남겨 둘 초안" } });
  fireEvent.click(screen.getByRole("button", { name: "함께 이야기해 봐" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("talk_now", undefined));
  expect(vi.mocked(command).mock.calls).toEqual([
    [
      "save_conversation_draft",
      { sessionId: "surface-session", draft: "잠깐 남겨 둘 초안", inputOwner: "desktop" },
    ],
    ["talk_now", undefined],
  ]);
});

it("preserves IME, Shift+Enter and a failed raw draft through the capsule", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "send_message") throw new Error("연결을 확인해 주세요");
  });
  render(<Balloon snapshot={conversationSnapshot()} surface="input" preview />);
  const input = screen.getByRole("textbox");
  const original = "  다시 쓸 말\n원문 그대로  ";
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: original } });
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(command).not.toHaveBeenCalledWith("send_message", expect.anything());
  fireEvent.keyDown(input, { key: "Enter" });
  expect((await screen.findByRole("alert")).textContent).toBe("연결을 확인해 주세요");
  expect(input).toHaveProperty("value", original);
  expect(command).toHaveBeenCalledWith("save_conversation_draft", {
    sessionId: "surface-session",
    draft: original,
    inputOwner: "desktop",
  });
  expect(command).toHaveBeenCalledWith(
    "send_message",
    expect.objectContaining({ content: original.trim(), sessionId: "surface-session" }),
  );
});

it("flushes the desktop draft before opening the separate history window", async () => {
  render(<Balloon snapshot={conversationSnapshot()} surface="input" preview />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "아직 보내지 않은 말" } });
  fireEvent.click(screen.getByRole("button", { name: "지난 대화" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_panel", {
      persona: "builtin-a",
      mode: "history",
    }),
  );
  expect(vi.mocked(command).mock.calls).toEqual([
    [
      "save_conversation_draft",
      {
        sessionId: "surface-session",
        draft: "아직 보내지 않은 말",
        inputOwner: "desktop",
      },
    ],
    ["open_panel", { persona: "builtin-a", mode: "history" }],
  ]);
});

it("allows the next draft during generation while blocking submission", async () => {
  const snapshot = conversationSnapshot();
  render(
    <Balloon
      surface="input"
      preview
      snapshot={{
        ...snapshot,
        runtime: { ...snapshot.runtime, phase: "generating" },
      }}
    />,
  );
  const input = screen.getByRole("textbox");
  expect(input).toHaveProperty("disabled", false);
  fireEvent.change(input, { target: { value: "새 초안" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByRole("button", { name: "보내기" })).toHaveProperty("disabled", true);
  expect(command).not.toHaveBeenCalledWith("send_message", expect.anything());
  expect(input).toHaveProperty("value", "새 초안");
});

it("waits while more is open and resumes the empty-input idle timeout after closing it", async () => {
  vi.useFakeTimers();
  render(<Balloon snapshot={conversationSnapshot()} surface="input" preview />);
  const summary = screen.getByText("더보기");
  const options = summary.closest("details");
  if (!options) throw new Error("More options are missing");
  fireEvent.click(summary);
  fireEvent(options, new Event("toggle"));
  await act(async () => {
    vi.advanceTimersByTime(95_000);
  });
  expect(command).not.toHaveBeenCalledWith("close_panel", expect.anything());
  fireEvent.click(summary);
  fireEvent(options, new Event("toggle"));
  await act(async () => {
    vi.advanceTimersByTime(95_000);
  });
  expect(command).toHaveBeenCalledWith("close_panel", { idle: true, sessionId: "surface-session" });
});

it("shows recorded responses in a read-only surface without autosave or idle controls", async () => {
  vi.useFakeTimers();
  render(<ConversationResponse snapshot={conversationSnapshot("저장된 초안")} preview />);
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("기록에 남은 친구 이름")).toBeTruthy();
  expect(screen.getByText("등록 대사 · 단어장")).toBeTruthy();
  expect(screen.getByTitle("등록 대사 · 단어장").getAttribute("aria-describedby")).toBe(
    screen.getByText("등록 대사 · 단어장").id,
  );
  expect(screen.getByLabelText(/적어 둔 대답/).textContent).toBe("  적어 둔 대답\n다음 줄  ");
  await act(async () => {
    vi.advanceTimersByTime(95_000);
  });
  expect(command).not.toHaveBeenCalled();
});

it("uses the Figma text default only when a character has no saved style", () => {
  const snapshot = conversationSnapshot();
  const { rerender } = render(<ConversationResponse snapshot={snapshot} preview />);
  expect(screen.getByLabelText(/적어 둔 대답/).style.fontSize).toBe("16px");
  for (const fontSize of [19, 28]) {
    rerender(
      <ConversationResponse
        preview
        snapshot={{
          ...snapshot,
          characters: {
            ...snapshot.characters,
            installed: snapshot.characters.installed.map((character) => ({
              ...character,
              definition: {
                ...character.definition,
                balloonStyle: { fontSize, fontFamily: "My font", textColor: "#123456" },
              },
            })),
          },
        }}
      />,
    );
    const speech = screen.getByLabelText(/적어 둔 대답/);
    expect(speech.style.fontSize).toBe(`${fontSize}px`);
    expect(speech.style.fontFamily).toContain("My font");
    expect(speech.style.color).toBe("rgb(18, 52, 86)");
  }
});

it("switches the response to waiting and live playback while history owns input", () => {
  const snapshot = conversationSnapshot();
  const { rerender } = render(
    <ConversationResponse
      preview
      snapshot={{
        ...snapshot,
        panel: { persona: "builtin-a", mode: "history-input" },
        runtime: { ...snapshot.runtime, phase: "generating" },
      }}
    />,
  );
  expect(screen.getByRole("status", { name: "답변 준비 중" })).toBeTruthy();
  expect(screen.queryByText("등록 대사 · 단어장")).toBeNull();
  rerender(
    <ConversationResponse
      preview
      snapshot={{
        ...snapshot,
        panel: { persona: "builtin-a", mode: "history-input" },
        playback: {
          id: "live-line",
          persona: "builtin-a",
          text: "  지금 하는 말\n그대로  ",
          expression: "평온",
          source: "script",
          endsAt: 1,
          lineIndex: 0,
          lineCount: 1,
        },
      }}
    />,
  );
  expect(screen.getByLabelText(/지금 하는 말/).textContent).toBe("  지금 하는 말\n그대로  ");
  expect(screen.getByText("등록 대사")).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
});
