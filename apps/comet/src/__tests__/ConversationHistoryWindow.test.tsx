import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { ConversationHistoryWindow } from "../components/Balloon/ConversationHistoryWindow";
import { command, isDesktop, PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";
import type {
  ConversationMessages,
  ConversationSession,
  ConversationView,
  Snapshot,
} from "../types";

const native = vi.hoisted(() => ({
  onCloseRequested: vi.fn(),
  startDragging: vi.fn(),
  minimize: vi.fn(),
  toggleMaximize: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(() => true),
}));

const FIRST: ConversationSession = {
  id: "first",
  userId: "preview-user",
  participants: ["builtin-a"],
  status: "paused",
  title: "구름 이야기",
  createdAt: 1760000000000,
  updatedAt: 1760000001000,
  draft: "  이어 쓸 말\n그대로. 다음 문장은 숨겨요.  ",
  continuedFrom: null,
};
const SECOND: ConversationSession = {
  ...FIRST,
  id: "second",
  title: "다음 이야기",
  draft: "두 번째 초안",
};
const MESSAGE = {
  id: "first-message",
  role: "assistant",
  persona: "builtin-a",
  content: "첫 대화 원문\n그대로",
  expression: null,
  createdAt: FIRST.createdAt,
  status: "complete",
};
const FIRST_VIEW: ConversationView = { session: FIRST, messages: [MESSAGE], nextBefore: null };
const SECOND_VIEW: ConversationView = {
  session: SECOND,
  messages: [{ ...MESSAGE, id: "second-message", content: "다음 대화 원문" }],
  nextBefore: null,
};
const SNAPSHOT: Snapshot = {
  ...PREVIEW_SNAPSHOT,
  playback: null,
  panel: null,
  conversation: null,
  user: { ...PREVIEW_SNAPSHOT.user!, id: FIRST.userId },
};

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function (): void {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (): void {
    this.removeAttribute("open");
  };
  vi.mocked(listen).mockClear();
  vi.mocked(isDesktop).mockReturnValue(true);
  native.onCloseRequested.mockReset().mockResolvedValue(() => {});
  vi.mocked(command)
    .mockReset()
    .mockImplementation(async (name, args) => {
      if (name === "get_conversations") return [FIRST, SECOND];
      if (name === "get_conversation_messages" || name === "resume_chat")
        return args?.sessionId === SECOND.id ? SECOND_VIEW : FIRST_VIEW;
    });
});
afterEach(cleanup);

async function begin(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByRole("log", { name: "대화 내용" }).textContent).toContain(MESSAGE.content),
  );
  fireEvent.click(screen.getByRole("button", { name: "이어서 말하기" }));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
}

it("shows two columns, preserves message text and starts browsing without resuming a conversation", async () => {
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  const log = await screen.findByRole("log", { name: "대화 내용" });
  await waitFor(() => expect(log.textContent).toContain(MESSAGE.content));
  expect(screen.getByRole("complementary", { name: "대화 목록" })).toBeTruthy();
  expect(
    within(screen.getByRole("button", { name: /이어 쓸 말/ })).getByText(/오전|오후/, {
      selector: "time",
    }),
  ).toHaveProperty("dateTime", new Date(FIRST.createdAt).toISOString());
  expect(within(log).getByText(/오전|오후/, { selector: "time" })).toHaveProperty("dateTime");
  expect(command).not.toHaveBeenCalledWith("resume_chat", expect.anything());
  expect(screen.getByRole("button", { name: /이어 쓸 말/ }).textContent).not.toContain(
    "다음 문장은 숨겨요",
  );
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty(
    "value",
    FIRST.draft,
  );
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty("disabled", true);
});

it("waits for the exact session draft to save before changing selection", async () => {
  const save = deferred<void>();
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "save_conversation_draft") return save.promise;
    if (name === "resume_chat" || name === "get_conversation_messages")
      return args?.sessionId === SECOND.id ? SECOND_VIEW : FIRST_VIEW;
  });
  fireEvent.change(screen.getByRole("textbox", { name: "이어서 말하기" }), {
    target: { value: "  새 초안\n그대로  " },
  });
  fireEvent.click(screen.getByRole("button", { name: /두 번째 초안/ }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_conversation_draft", {
      sessionId: FIRST.id,
      draft: "  새 초안\n그대로  ",
      inputOwner: "history",
    }),
  );
  expect(command).not.toHaveBeenCalledWith("resume_chat", {
    sessionId: SECOND.id,
    surface: "history",
  });
  await act(async () => save.resolve());
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("resume_chat", {
      sessionId: SECOND.id,
      surface: "history",
    }),
  );
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty(
    "value",
    SECOND.draft,
  );
});

it("keeps the draft and current selection when its save fails", async () => {
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  vi.mocked(command).mockRejectedValue(new Error("저장 실패"));
  fireEvent.change(screen.getByRole("textbox", { name: "이어서 말하기" }), {
    target: { value: "지우면 안 되는 초안" },
  });
  fireEvent.click(screen.getByRole("button", { name: /두 번째 초안/ }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "저장 실패");
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty(
    "value",
    "지우면 안 되는 초안",
  );
  expect(command).not.toHaveBeenCalledWith("resume_chat", {
    sessionId: SECOND.id,
    surface: "history",
  });
});

it("flushes before returning input ownership on a native close request", async () => {
  const save = deferred<void>();
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "save_conversation_draft") return save.promise;
  });
  fireEvent.change(screen.getByRole("textbox", { name: "이어서 말하기" }), {
    target: { value: "닫기 전에 저장" },
  });
  const event = { preventDefault: vi.fn() };
  act(() => native.onCloseRequested.mock.calls[0][0](event));
  expect(event.preventDefault).toHaveBeenCalled();
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "save_conversation_draft",
      expect.objectContaining({ draft: "닫기 전에 저장" }),
    ),
  );
  expect(command).not.toHaveBeenCalledWith("release_conversation_history", expect.anything());
  await act(async () => save.resolve());
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("release_conversation_history", { sessionId: FIRST.id }),
  );
});

it("preserves a rejected send and does not send while composing Korean text", async () => {
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "send_message") throw new Error("모델 준비 실패");
  });
  const input = screen.getByRole("textbox", { name: "이어서 말하기" });
  fireEvent.change(input, { target: { value: "  새로 보낼 말\n둘째 줄  " } });
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
  expect(command).not.toHaveBeenCalledWith("send_message", expect.anything());
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter" });
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "모델 준비 실패");
  expect(input).toHaveProperty("value", "  새로 보낼 말\n둘째 줄  ");
  expect(command).toHaveBeenCalledWith(
    "send_message",
    expect.objectContaining({
      sessionId: FIRST.id,
      content: "새로 보낼 말\n둘째 줄",
      target: "builtin-a",
    }),
  );
});

it("uses the newly created continuation session returned when an ended conversation resumes", async () => {
  const ended = { ...FIRST, status: "ended" as const, draft: "" };
  const continuation = {
    ...FIRST_VIEW,
    session: {
      ...FIRST,
      id: "continuation",
      status: "active" as const,
      draft: "",
      continuedFrom: FIRST.id,
    },
  };
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_conversations") return [ended];
    if (name === "get_conversation_messages") return FIRST_VIEW;
    if (name === "resume_chat") return continuation;
  });
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  fireEvent.change(screen.getByRole("textbox", { name: "이어서 말하기" }), {
    target: { value: "새로 이어갈 말" },
  });
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "send_message",
      expect.objectContaining({ sessionId: "continuation" }),
    ),
  );
  expect(command).not.toHaveBeenCalledWith(
    "send_message",
    expect.objectContaining({ sessionId: FIRST.id }),
  );
});

it("discards a late message response after another conversation is selected", async () => {
  const firstPage = deferred<ConversationMessages>();
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_conversations") return [FIRST, SECOND];
    if (name === "get_conversation_messages")
      return args?.sessionId === FIRST.id ? firstPage.promise : SECOND_VIEW;
    if (name === "resume_chat") return SECOND_VIEW;
  });
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  fireEvent.click(await screen.findByRole("button", { name: /두 번째 초안/ }));
  await screen.findByText("다음 대화 원문");
  await act(async () => firstPage.resolve(FIRST_VIEW));
  expect(screen.queryByText(MESSAGE.content)).toBeNull();
  expect(screen.getByText("다음 대화 원문")).toBeTruthy();
});

it("locks the history editor and cancels its pending autosave when desktop input takes ownership", async () => {
  const { rerender } = render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  fireEvent.change(screen.getByRole("textbox", { name: "이어서 말하기" }), {
    target: { value: "새 초안" },
  });
  vi.mocked(command).mockClear();
  rerender(
    <ConversationHistoryWindow
      snapshot={{
        ...SNAPSHOT,
        panel: { persona: "builtin-a", mode: "input" },
        conversation: FIRST_VIEW,
      }}
    />,
  );
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty("disabled", true);
  await new Promise((resolve) => setTimeout(resolve, 450));
  expect(command).not.toHaveBeenCalledWith("save_conversation_draft", expect.anything());
});

it("flushes a pending draft when a noncompeting hide or pause removes the input panel", async () => {
  const { rerender } = render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  fireEvent.change(screen.getByRole("textbox", { name: "이어서 말하기" }), {
    target: { value: "숨기기 전에 쓴 말" },
  });
  rerender(<ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: FIRST_VIEW }} />);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_conversation_draft", {
      sessionId: FIRST.id,
      draft: "숨기기 전에 쓴 말",
      inputOwner: "history",
    }),
  );
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty("disabled", true);
});

it("restores an asynchronously failed submission without overwriting a newer draft", async () => {
  const { rerender } = render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  fireEvent.change(screen.getByRole("textbox", { name: "이어서 말하기" }), {
    target: { value: "준비 실패 입력" },
  });
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty("value", ""),
  );
  const messageId = vi.mocked(command).mock.calls.find(([name]) => name === "send_message")?.[1]
    ?.clientMessageId as string;
  const failed: Snapshot = {
    ...SNAPSHOT,
    panel: { persona: "builtin-a", mode: "history-input" },
    conversation: { ...FIRST_VIEW, recovery: { messageId, reason: "incomplete" } },
  };
  rerender(<ConversationHistoryWindow snapshot={failed} />);
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty(
    "value",
    "준비 실패 입력",
  );
  fireEvent.change(screen.getByRole("textbox", { name: "이어서 말하기" }), {
    target: { value: "새로 적은 초안" },
  });
  rerender(<ConversationHistoryWindow snapshot={{ ...failed }} />);
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty(
    "value",
    "새로 적은 초안",
  );
});

it("filters group conversations and sends a text search to the complete history query", async () => {
  const together = { ...SECOND, participants: ["builtin-a", "builtin-b"], draft: "함께 쓴 계획" };
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_conversations") return args?.query ? [together] : [FIRST, together];
    if (name === "get_conversation_messages") return FIRST_VIEW;
  });
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  const list = screen.getByRole("complementary", { name: "대화 목록" });
  await within(list).findByRole("button", { name: /함께 쓴 계획/ });
  fireEvent.click(screen.getByRole("radio", { name: "함께" }));
  await waitFor(() =>
    expect(within(list).queryByRole("button", { name: /이어 쓸 말/ })).toBeNull(),
  );
  expect(within(list).getByRole("button", { name: /함께 쓴 계획/ })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "대화 찾기" }), {
    target: { value: "본문 검색" },
  });
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("get_conversations", { query: "본문 검색" }),
  );
});

it("reloads the selected transcript when a hidden history window is opened again", async () => {
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await waitFor(() =>
    expect(screen.getByRole("log", { name: "대화 내용" }).textContent).toContain(MESSAGE.content),
  );
  fireEvent.click(screen.getByRole("button", { name: "지난 대화 닫기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("release_conversation_history", {}));
  const updated = {
    ...FIRST_VIEW,
    messages: [
      ...FIRST_VIEW.messages,
      { ...MESSAGE, id: "new-desktop-message", content: "바탕화면에서 더 나눈 이야기" },
    ],
  };
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_conversations") return [FIRST, SECOND];
    if (name === "get_conversation_messages") return updated;
  });
  const reopen = vi
    .mocked(listen)
    .mock.calls.find(([event]) => event === "conversation-history-persona")?.[1];
  expect(reopen).toBeTypeOf("function");
  await act(async () =>
    reopen?.({ event: "conversation-history-persona", id: 1, payload: "builtin-a" }),
  );
  expect(await screen.findByText("바탕화면에서 더 나눈 이야기")).toBeTruthy();
});

it("focuses the resumed editor and saves a new draft before stopping the identified generation", async () => {
  const { rerender } = render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "이어서 말하기" }));
  const activeRequest = { epoch: 42, sessionId: FIRST.id, messageId: "generating-input" };
  rerender(
    <ConversationHistoryWindow
      snapshot={{
        ...SNAPSHOT,
        panel: { persona: "builtin-a", mode: "history-input" },
        conversation: FIRST_VIEW,
        runtime: { ...SNAPSHOT.runtime, phase: "generating" },
        activeRequest,
      }}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "이어서 말하기" }), {
    target: { value: "생성 중 적던 다음 말" },
  });
  vi.mocked(command).mockClear();
  fireEvent.click(screen.getByRole("button", { name: "생성 멈추기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("cancel_generation", { request: activeRequest }),
  );
  expect(vi.mocked(command).mock.calls.map(([name]) => name)).toEqual([
    "save_conversation_draft",
    "cancel_generation",
  ]);
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty(
    "value",
    "생성 중 적던 다음 말",
  );
});

it("confirms replacing another draft with a cancelled input and flushes before opening AI settings", async () => {
  const { rerender } = render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  const failedInput = {
    ...MESSAGE,
    id: "cancelled-input",
    role: "user",
    content: "  원래 입력\n보존  ",
  };
  const failed: Snapshot = {
    ...SNAPSHOT,
    panel: { persona: "builtin-a", mode: "history-input" },
    conversation: {
      ...FIRST_VIEW,
      messages: [failedInput],
      recovery: { messageId: failedInput.id, reason: "cancelled" },
    },
  };
  rerender(<ConversationHistoryWindow snapshot={failed} />);
  expect(screen.getByText("생성을 멈췄어요.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "입력 수정" }));
  expect(screen.getByRole("dialog", { name: "작성 중인 초안을 바꿀까요?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "계속 작성" }));
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty(
    "value",
    FIRST.draft,
  );
  fireEvent.click(screen.getByRole("button", { name: "입력 수정" }));
  fireEvent.click(screen.getByRole("button", { name: "초안 바꾸기" }));
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty(
    "value",
    failedInput.content,
  );
  vi.mocked(command).mockClear();
  fireEvent.click(screen.getByRole("button", { name: "AI 연결 확인" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("open_settings"));
  expect(vi.mocked(command).mock.calls.map(([name]) => name)).toEqual([
    "save_conversation_draft",
    "set_settings_section",
    "open_settings",
  ]);
  expect(command).not.toHaveBeenCalledWith("send_message", expect.anything());
  expect(failedInput.content).toBe("  원래 입력\n보존  ");
});
