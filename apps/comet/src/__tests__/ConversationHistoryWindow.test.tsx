import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
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

it("shows verified start and focus events between the original messages", async () => {
  const next = {
    ...MESSAGE,
    id: "after-focus",
    content: "집중 뒤의 원문\n그대로",
    createdAt: MESSAGE.createdAt + 2000,
  };
  const view: ConversationView = {
    ...FIRST_VIEW,
    messages: [MESSAGE, next],
    timelineEvents: [
      {
        id: "start",
        kind: "started",
        source: "automatic",
        messageId: MESSAGE.id,
        createdAt: MESSAGE.createdAt,
      },
      { id: "focus", kind: "focus-paused", createdAt: MESSAGE.createdAt + 1000 },
    ],
  };
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_conversations") return [FIRST];
    if (name === "get_conversation_messages") return view;
  });
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  const log = await screen.findByRole("log", { name: "대화 내용" });
  await waitFor(() => expect(log.textContent).toContain(next.content));
  const content = log.textContent ?? "";
  expect(content.indexOf("바탕화면에서 먼저 말을 걸었어요")).toBeLessThan(
    content.indexOf(MESSAGE.content),
  );
  expect(content.indexOf(MESSAGE.content)).toBeLessThan(
    content.indexOf("집중을 시작해서 대화를 멈췄어요"),
  );
  expect(content.indexOf("집중을 시작해서 대화를 멈췄어요")).toBeLessThan(
    content.indexOf(next.content),
  );
  expect(within(log).getByText(/첫 대화 원문/).textContent).toBe(MESSAGE.content);
});

it("does not describe an unknown or manually answered origin as automatic speech", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_conversations") return [FIRST];
    if (name === "get_conversation_messages")
      return {
        ...FIRST_VIEW,
        timelineEvents: [
          { id: "start", kind: "started", source: "reply", createdAt: FIRST.createdAt },
        ],
      };
  });
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  expect(await screen.findByText(/이 말에 답장하며 대화를 시작했어요/)).toBeTruthy();
  expect(screen.queryByText(/먼저 말을 걸었어요/)).toBeNull();
});

it("reveals earlier events once when loading more messages without changing their order", async () => {
  const latest = {
    ...MESSAGE,
    id: "latest-message",
    content: "나중 원문",
    createdAt: MESSAGE.createdAt + 2000,
  };
  const events: ConversationMessages["timelineEvents"] = [
    { id: "start", kind: "started", createdAt: MESSAGE.createdAt },
    { id: "focus", kind: "focus-paused", createdAt: MESSAGE.createdAt + 1000 },
  ];
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_conversations") return [FIRST];
    if (name === "get_conversation_messages")
      return args?.before
        ? { messages: [MESSAGE], nextBefore: null, timelineEvents: events }
        : { messages: [latest], nextBefore: 5, timelineEvents: events };
  });
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  expect(await screen.findByText(latest.content)).toBeTruthy();
  expect(screen.queryByText(/집중을 시작해서/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "앞선 내용 더 보기" }));
  await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
  expect(screen.getAllByText(/집중을 시작해서/)).toHaveLength(1);
  const content = screen.getByRole("log", { name: "대화 내용" }).textContent ?? "";
  expect(content.indexOf(MESSAGE.content)).toBeLessThan(content.indexOf("집중을 시작해서"));
  expect(content.indexOf("집중을 시작해서")).toBeLessThan(content.indexOf(latest.content));
});

it("opens the memory owner's settings from a receipt in a group conversation", async () => {
  const session: ConversationSession = { ...FIRST, participants: ["builtin-a", "builtin-b"] };
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_conversations") return [session];
    if (name === "get_conversation_messages")
      return {
        ...FIRST_VIEW,
        session,
        memoryReceipts: [
          {
            id: "memory",
            sourceMessageId: MESSAGE.id,
            characterId: "builtin-b",
            content: "  구름\n그대로",
            updatedAt: MESSAGE.createdAt,
          },
        ],
      };
  });
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  const receipt = await screen.findByRole("button", { name: /기억했어요:/ });
  expect(receipt.textContent).toContain("  구름\n그대로");
  fireEvent.click(receipt);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_characters", {
      characterId: "builtin-b",
      showMemories: true,
    }),
  );
  expect(command).not.toHaveBeenCalledWith("resume_chat", expect.anything());
});

it("refreshes removed memories in a read-only conversation when the memory revision changes", async () => {
  let receipts = [
    {
      id: "memory",
      sourceMessageId: MESSAGE.id,
      characterId: "builtin-a",
      content: "기억 원문",
      updatedAt: MESSAGE.createdAt,
    },
  ];
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_conversations") return [FIRST];
    if (name === "get_conversation_messages") return { ...FIRST_VIEW, memoryReceipts: receipts };
  });
  const { rerender } = render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  expect(await screen.findByRole("button", { name: /기억했어요: 기억 원문/ })).toBeTruthy();
  receipts = [];
  rerender(<ConversationHistoryWindow snapshot={{ ...SNAPSHOT, memoryRevision: 1 }} />);
  await waitFor(() => expect(screen.queryByRole("button", { name: /기억했어요:/ })).toBeNull());
  await waitFor(() => expect(screen.getByRole("article").textContent).toContain(MESSAGE.content));
  expect(command).not.toHaveBeenCalledWith("resume_chat", expect.anything());
});

it("keeps a newer read-only snapshot when an earlier page request finishes late", async () => {
  const page = deferred<ConversationMessages>();
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_conversations") return [FIRST];
    if (name === "get_conversation_messages") return page.promise;
  });
  const { rerender } = render(
    <ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: FIRST_VIEW }} />,
  );
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("get_conversation_messages", { sessionId: FIRST.id }),
  );
  const latest: ConversationView = {
    ...FIRST_VIEW,
    messages: [
      MESSAGE,
      {
        ...MESSAGE,
        id: "newer",
        content: "늦은 조회보다 새로운 답장",
        createdAt: MESSAGE.createdAt + 1000,
      },
    ],
    memoryReceipts: [
      {
        id: "newer-memory",
        sourceMessageId: MESSAGE.id,
        characterId: "builtin-a",
        content: "최신 기억",
        updatedAt: MESSAGE.createdAt + 1000,
      },
    ],
  };
  rerender(<ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: latest }} />);
  expect(await screen.findByText("늦은 조회보다 새로운 답장")).toBeTruthy();
  await act(async () => page.resolve(FIRST_VIEW));
  expect(screen.getByText("늦은 조회보다 새로운 답장")).toBeTruthy();
  expect(screen.getByRole("button", { name: /기억했어요: 최신 기억/ })).toBeTruthy();
  expect(command).not.toHaveBeenCalledWith("resume_chat", expect.anything());
});

it("discards an older page from before a memory revision instead of restoring its deleted receipt", async () => {
  const older = deferred<ConversationMessages>();
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_conversations") return [FIRST];
    if (name === "get_conversation_messages")
      return args?.before ? older.promise : { ...FIRST_VIEW, nextBefore: 5, memoryReceipts: [] };
  });
  const { rerender } = render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  fireEvent.click(await screen.findByRole("button", { name: "앞선 내용 더 보기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("get_conversation_messages", {
      sessionId: FIRST.id,
      before: 5,
    }),
  );
  rerender(<ConversationHistoryWindow snapshot={{ ...SNAPSHOT, memoryRevision: 1 }} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "앞선 내용 더 보기" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  await act(async () =>
    older.resolve({
      messages: [{ ...MESSAGE, id: "older", content: "이전 페이지" }],
      nextBefore: null,
      memoryReceipts: [
        {
          id: "deleted-memory",
          sourceMessageId: "older",
          characterId: "builtin-a",
          content: "삭제된 기억",
          updatedAt: MESSAGE.createdAt,
        },
      ],
    }),
  );
  expect(screen.queryByText("이전 페이지")).toBeNull();
  expect(screen.queryByRole("button", { name: /삭제된 기억/ })).toBeNull();
  expect(screen.getByRole("button", { name: "앞선 내용 더 보기" })).toBeTruthy();
});

it("hides a former friend's memory receipt as soon as the active roster changes", async () => {
  let active = true;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_conversations") return [FIRST];
    if (name === "get_conversation_messages")
      return {
        ...FIRST_VIEW,
        memoryReceipts: active
          ? [
              {
                id: "memory",
                sourceMessageId: MESSAGE.id,
                characterId: "builtin-a",
                content: "현재 친구 기억",
                updatedAt: MESSAGE.createdAt,
              },
            ]
          : [],
      };
  });
  const { rerender } = render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  expect(await screen.findByRole("button", { name: /현재 친구 기억/ })).toBeTruthy();
  active = false;
  rerender(
    <ConversationHistoryWindow
      snapshot={{ ...SNAPSHOT, characters: { ...SNAPSHOT.characters, active: ["builtin-b"] } }}
    />,
  );
  expect(screen.queryByRole("button", { name: /현재 친구 기억/ })).toBeNull();
  await waitFor(() => expect(screen.getByRole("article").textContent).toContain(MESSAGE.content));
});

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

it("keeps the detail empty when the requested friend's history is empty", async () => {
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} initialPersona="builtin-b" />);
  await screen.findByText("아직 나눈 대화가 없어요.");
  expect(screen.getByText("왼쪽에서 지난 대화를 골라 주세요.")).toBeTruthy();
  expect(screen.queryByRole("log")).toBeNull();
  expect(command).not.toHaveBeenCalledWith("get_conversation_messages", expect.anything());
  fireEvent.click(screen.getByRole("radio", { name: "모두" }));
  await screen.findByText(/첫 대화 원문/);
});

it.each([true, false])(
  "scopes a reopened window to the requested friend with matching history: %s",
  async (hasMatch) => {
    const other = { ...SECOND, participants: ["builtin-b"] };
    const fallback = vi.mocked(command).getMockImplementation()!;
    vi.mocked(command).mockImplementation(async (name, args) => {
      if (name === "get_conversations") return hasMatch ? [FIRST, other] : [FIRST];
      if (name === "get_conversation_messages" && args?.sessionId === other.id)
        return { ...SECOND_VIEW, session: other };
      return fallback(name, args);
    });
    render(<ConversationHistoryWindow snapshot={SNAPSHOT} initialPersona="builtin-a" />);
    await screen.findByText(/첫 대화 원문/);
    fireEvent.click(screen.getByRole("button", { name: "지난 대화 닫기" }));
    await waitFor(() => expect(command).toHaveBeenCalledWith("release_conversation_history", {}));
    const reopen = vi
      .mocked(listen)
      .mock.calls.find(([event]) => event === "conversation-history-persona")?.[1];
    await act(async () =>
      reopen?.({ event: "conversation-history-persona", id: 2, payload: "builtin-b" }),
    );
    if (hasMatch) {
      await screen.findByText("다음 대화 원문");
      expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty(
        "disabled",
        true,
      );
    } else {
      await screen.findByText("아직 나눈 대화가 없어요.");
      expect(screen.queryByRole("log")).toBeNull();
    }
    expect(screen.queryByText(/첫 대화 원문/)).toBeNull();
    expect(command).not.toHaveBeenCalledWith("resume_chat", expect.anything());
  },
);

it("preserves an owned draft across an explicit friend filter change without resuming another conversation", async () => {
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  const content = "  필터를 바꿔도\n새 초안 그대로  ";
  fireEvent.change(screen.getByRole("textbox", { name: "이어서 말하기" }), {
    target: { value: content },
  });
  fireEvent.click(screen.getByRole("radio", { name: "함께" }));
  await screen.findByText("아직 나눈 대화가 없어요.");
  expect(screen.queryByRole("textbox", { name: "이어서 말하기" })).toBeNull();
  expect(command).toHaveBeenCalledWith("save_conversation_draft", {
    sessionId: FIRST.id,
    draft: content,
    inputOwner: "history",
  });
  fireEvent.click(screen.getByRole("radio", { name: "모두" }));
  const restored = await screen.findByRole("textbox", { name: "이어서 말하기" });
  expect(restored).toHaveProperty("value", content);
  expect(restored).toHaveProperty("disabled", false);
  expect(vi.mocked(command).mock.calls.filter(([name]) => name === "resume_chat")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "지난 대화 닫기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("release_conversation_history", { sessionId: FIRST.id }),
  );
});

it("does not apply a pending filter transition after the user writes a newer draft", async () => {
  const saved = deferred<void>();
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) =>
    name === "save_conversation_draft" ? saved.promise : fallback(name, args),
  );
  const input = screen.getByRole("textbox", { name: "이어서 말하기" });
  fireEvent.change(input, { target: { value: "저장 중인 초안" } });
  fireEvent.click(screen.getByRole("radio", { name: "함께" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "save_conversation_draft",
      expect.objectContaining({ draft: "저장 중인 초안" }),
    ),
  );
  fireEvent.change(input, { target: { value: "저장 기다리며 새로 쓴 원문" } });
  await act(async () => saved.resolve());
  expect(screen.getByRole("radio", { name: "모두" })).toHaveProperty("checked", true);
  expect(input).toHaveProperty("value", "저장 기다리며 새로 쓴 원문");
  expect(input).toHaveProperty("disabled", false);
});

it("does not apply a pending filter while another conversation is being selected", async () => {
  const saved = deferred<void>();
  const resumed = deferred<ConversationView>();
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "save_conversation_draft") return saved.promise;
    if (name === "resume_chat") return resumed.promise;
    return fallback(name, args);
  });
  fireEvent.change(screen.getByRole("textbox", { name: "이어서 말하기" }), {
    target: { value: "다른 대화를 고르기 전에 저장" },
  });
  fireEvent.click(screen.getByRole("radio", { name: "함께" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_conversation_draft", expect.anything()),
  );
  fireEvent.click(screen.getByRole("button", { name: /두 번째 초안/ }));
  await act(async () => saved.resolve());
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("resume_chat", {
      sessionId: SECOND.id,
      surface: "history",
    }),
  );
  expect(screen.getByRole("radio", { name: "모두" })).toHaveProperty("checked", true);
  await act(async () => resumed.resolve(SECOND_VIEW));
  await screen.findByText("다음 대화 원문");
  expect(screen.getByRole("radio", { name: "모두" })).toHaveProperty("checked", true);
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty(
    "value",
    SECOND.draft,
  );
});

it("keeps the selected transcript when a text search only changes the matching list", async () => {
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_conversations" && args?.query) return [SECOND];
    return fallback(name, args);
  });
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await screen.findByText(/첫 대화 원문/);
  fireEvent.change(screen.getByRole("searchbox", { name: "대화 찾기" }), {
    target: { value: "다음 이야기" },
  });
  const list = screen.getByRole("complementary", { name: "대화 목록" });
  await waitFor(() =>
    expect(within(list).queryByRole("button", { name: /이어 쓸 말/ })).toBeNull(),
  );
  expect(within(list).getByRole("button", { name: /두 번째 초안/ })).toBeTruthy();
  expect(screen.getByRole("log").textContent).toContain(MESSAGE.content);
  expect(command).not.toHaveBeenCalledWith("get_conversation_messages", { sessionId: SECOND.id });
});

it("requires a fresh editor adoption after browsing an ended session discarded the local draft", async () => {
  const ended = { ...SECOND, status: "ended" as const };
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) =>
    name === "get_conversations" ? [FIRST, ended] : fallback(name, args),
  );
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  fireEvent.click(screen.getByRole("button", { name: /두 번째 초안/ }));
  await screen.findByText("다음 대화 원문");
  fireEvent.click(screen.getByRole("radio", { name: "함께" }));
  await screen.findByText("아직 나눈 대화가 없어요.");
  fireEvent.click(screen.getByRole("radio", { name: "모두" }));
  await screen.findByText(/첫 대화 원문/);
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "이어서 말하기" }));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  expect(vi.mocked(command).mock.calls.filter(([name]) => name === "resume_chat")).toHaveLength(2);
});

it("persists a failed hidden draft without replacing the other friend's visible draft", async () => {
  const other = { ...SECOND, participants: ["builtin-b"] };
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_conversations") return [FIRST, other];
    if (name === "get_conversation_messages" && args?.sessionId === other.id)
      return { ...SECOND_VIEW, session: other };
    return fallback(name, args);
  });
  const { rerender } = render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  const content = "  복구할 원문\n그대로  ";
  fireEvent.change(screen.getByRole("textbox", { name: "이어서 말하기" }), {
    target: { value: content },
  });
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty("value", ""),
  );
  const messageId = vi.mocked(command).mock.calls.find(([name]) => name === "send_message")?.[1]
    ?.clientMessageId as string;
  fireEvent.click(screen.getByRole("radio", { name: "B" }));
  await screen.findByText("다음 대화 원문");
  vi.mocked(command).mockClear();
  rerender(
    <ConversationHistoryWindow
      snapshot={{
        ...SNAPSHOT,
        panel: { persona: "builtin-a", mode: "history-input" },
        runtime: { ...SNAPSHOT.runtime, phase: "error", error: "연결 실패" },
        conversation: { ...FIRST_VIEW, recovery: { messageId, reason: "incomplete" } },
      }}
    />,
  );
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_conversation_draft", {
      sessionId: FIRST.id,
      draft: content,
      inputOwner: "history",
    }),
  );
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty(
    "value",
    SECOND.draft,
  );
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("radio", { name: "A" }));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty("value", content),
  );
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty("disabled", false);
});

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
  expect(within(log).getByText(/^\d{1,2}:\d{2}$/, { selector: "time" })).toHaveProperty("dateTime");
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

it("uses the full stored message count even while only one page is loaded", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_conversations") return [{ ...FIRST, messageCount: 105 }];
    if (name === "get_conversation_messages") return { ...FIRST_VIEW, nextBefore: 123 };
  });
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  expect(await screen.findByText(/메시지 105개$/)).toBeTruthy();
  expect(await screen.findByRole("button", { name: "앞선 내용 더 보기" })).toBeTruthy();
  expect(screen.getAllByRole("article")).toHaveLength(1);
});

it("preserves provenance and keeps save controls keyboard accessible without altering the original", async () => {
  const user = userEvent.setup();
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_conversations") return [FIRST];
    if (name === "get_conversation_messages")
      return {
        ...FIRST_VIEW,
        characterNames: { [MESSAGE.id]: "그때 친구" },
        messageSources: { [MESSAGE.id]: "wordbook" },
      };
    if (name === "get_conversation_notes") return [];
  });
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  const article = await screen.findByRole("article", { name: "그때 친구의 메시지" });
  const bubble = within(article).getByText(/첫 대화 원문/);
  expect(bubble.getAttribute("title")).toBe("그때 친구 · 등록 대사 · 단어장");
  expect(document.getElementById(bubble.getAttribute("aria-describedby") ?? "")?.textContent).toBe(
    "그때 친구 · 등록 대사 · 단어장",
  );
  const summary = within(article).getByText("남기기", { selector: "summary" });
  await user.click(summary);
  expect(summary.parentElement?.hasAttribute("open")).toBe(true);
  await user.tab();
  expect(document.activeElement).toBe(
    within(article).getByRole("button", { name: "메모에 남기기" }),
  );
  await user.keyboard("{Enter}");
  expect(await screen.findByRole("textbox", { name: "저장할 내용" })).toHaveProperty(
    "value",
    MESSAGE.content,
  );
});

it("locks competing selection and close operations until the draft is saved for character settings", async () => {
  const save = deferred<void>();
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "save_conversation_draft") return save.promise;
  });
  fireEvent.change(screen.getByRole("textbox", { name: "이어서 말하기" }), {
    target: { value: "설정 전에 저장" },
  });
  fireEvent.click(screen.getByRole("button", { name: /설정$/ }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "save_conversation_draft",
      expect.objectContaining({ draft: "설정 전에 저장" }),
    ),
  );
  const settings = screen.getByRole("button", { name: /설정$/ });
  const otherSession = screen.getByRole("button", { name: /두 번째 초안/ });
  expect(settings).toHaveProperty("disabled", true);
  expect(otherSession).toHaveProperty("disabled", true);
  fireEvent.click(settings);
  fireEvent.click(otherSession);
  const closeEvent = { preventDefault: vi.fn() };
  act(() => native.onCloseRequested.mock.calls[0][0](closeEvent));
  expect(closeEvent.preventDefault).toHaveBeenCalled();
  expect(command).not.toHaveBeenCalledWith("open_characters", expect.anything());
  expect(command).not.toHaveBeenCalledWith("release_conversation_history", expect.anything());
  expect(command).not.toHaveBeenCalledWith("resume_chat", {
    sessionId: SECOND.id,
    surface: "history",
  });
  await act(async () => save.resolve());
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_characters", { characterId: FIRST.participants[0] }),
  );
  expect(vi.mocked(command).mock.calls.filter(([name]) => name === "open_characters")).toHaveLength(
    1,
  );
});

it.each(["user", "owner"] as const)(
  "does not open stale character settings when the %s changes while saving",
  async (changed) => {
    const save = deferred<void>();
    const { rerender } = render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
    await begin();
    vi.mocked(command).mockImplementation(async (name) => {
      if (name === "save_conversation_draft") return save.promise;
      if (name === "get_conversations") return [];
      if (name === "get_conversation_messages") return FIRST_VIEW;
    });
    fireEvent.change(screen.getByRole("textbox", { name: "이어서 말하기" }), {
      target: { value: "저장이 늦는 이전 초안" },
    });
    fireEvent.click(screen.getByRole("button", { name: /설정$/ }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith(
        "save_conversation_draft",
        expect.objectContaining({ draft: "저장이 늦는 이전 초안" }),
      ),
    );
    const next: Snapshot =
      changed === "user"
        ? { ...SNAPSHOT, user: { ...SNAPSHOT.user!, id: "another-user" } }
        : {
            ...SNAPSHOT,
            panel: { persona: "builtin-a", mode: "input" },
            conversation: SECOND_VIEW,
          };
    rerender(<ConversationHistoryWindow snapshot={next} />);
    await act(async () => save.resolve());
    expect(command).not.toHaveBeenCalledWith("open_characters", expect.anything());
  },
);

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

it.each(["before", "after"])(
  "keeps a sent draft empty when pending wordbook recovery arrives %s send acceptance",
  async (arrival) => {
    const accepted = deferred<void>();
    const { rerender } = render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
    await begin();
    let storedDraft = FIRST.draft;
    const fallback = vi.mocked(command).getMockImplementation()!;
    vi.mocked(command).mockImplementation(async (name, args) => {
      if (name === "save_conversation_draft") storedDraft = args?.draft as string;
      if (name === "send_message") {
        storedDraft = "";
        return accepted.promise;
      }
      return fallback(name, args);
    });
    const input = screen.getByRole("textbox", { name: "이어서 말하기" });
    fireEvent.change(input, { target: { value: "안녕" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(command).toHaveBeenCalledWith("send_message", expect.anything()));
    const messageId = vi.mocked(command).mock.calls.find(([name]) => name === "send_message")?.[1]
      ?.clientMessageId as string;
    const userMessage = { ...MESSAGE, id: messageId, role: "user", content: "안녕" };
    const pending: Snapshot = {
      ...SNAPSHOT,
      panel: { persona: "builtin-a", mode: "history-input" },
      runtime: { ...SNAPSHOT.runtime, phase: "playing" },
      conversation: {
        ...FIRST_VIEW,
        session: { ...FIRST, status: "active", draft: "" },
        messages: [...FIRST_VIEW.messages, userMessage],
        recovery: { messageId, reason: "incomplete" },
      },
      playback: {
        id: "wordbook-reply",
        persona: "builtin-a",
        text: "안녕, 여행자!",
        expression: "평온",
        source: "wordbook",
        endsAt: FIRST.createdAt + 5000,
        displayStartedAt: null,
        lineIndex: 0,
        lineCount: 1,
      },
    };
    if (arrival === "before") rerender(<ConversationHistoryWindow snapshot={pending} />);
    await act(async () => accepted.resolve());
    if (arrival === "after") rerender(<ConversationHistoryWindow snapshot={pending} />);
    expect(input).toHaveProperty("value", "");
    expect(screen.queryByText("답변을 마치지 못했어요. 보낸 내용은 남아 있어요.")).toBeNull();
    expect(screen.queryByRole("button", { name: "다시 이야기하기" })).toBeNull();
    rerender(
      <ConversationHistoryWindow
        snapshot={{
          ...pending,
          runtime: { ...pending.runtime, phase: "idle" },
          playback: null,
          conversation: {
            ...pending.conversation!,
            recovery: undefined,
            messages: [
              ...pending.conversation!.messages,
              { ...MESSAGE, id: "wordbook-reply", content: "안녕, 여행자!" },
            ],
          },
        }}
      />,
    );
    expect(input).toHaveProperty("value", "");
    const savesBeforeClose = vi
      .mocked(command)
      .mock.calls.filter(([name]) => name === "save_conversation_draft").length;
    act(() => native.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("release_conversation_history", { sessionId: FIRST.id }),
    );
    expect(storedDraft).toBe("");
    expect(
      vi.mocked(command).mock.calls.filter(([name]) => name === "save_conversation_draft"),
    ).toHaveLength(savesBeforeClose);
  },
);

it.each(["before", "after"])(
  "preserves the original failed submission when error arrives %s send acceptance without replacing a newer draft",
  async (arrival) => {
    const accepted = deferred<void>();
    const { rerender } = render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
    await begin();
    const fallback = vi.mocked(command).getMockImplementation()!;
    vi.mocked(command).mockImplementation(async (name, args) =>
      name === "send_message" ? accepted.promise : fallback(name, args),
    );
    const content = "  준비 실패 입력\n둘째 줄 그대로  ";
    fireEvent.change(screen.getByRole("textbox", { name: "이어서 말하기" }), {
      target: { value: content },
    });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(command).toHaveBeenCalledWith("send_message", expect.anything()));
    const messageId = vi.mocked(command).mock.calls.find(([name]) => name === "send_message")?.[1]
      ?.clientMessageId as string;
    const failed: Snapshot = {
      ...SNAPSHOT,
      runtime: { ...SNAPSHOT.runtime, phase: "error", error: "모델 준비 실패" },
      panel: { persona: "builtin-a", mode: "history-input" },
      conversation: { ...FIRST_VIEW, recovery: { messageId, reason: "incomplete" } },
    };
    if (arrival === "before") rerender(<ConversationHistoryWindow snapshot={failed} />);
    await act(async () => accepted.resolve());
    if (arrival === "after") rerender(<ConversationHistoryWindow snapshot={failed} />);
    expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty("value", content);
    expect(screen.getByText("답변을 마치지 못했어요. 보낸 내용은 남아 있어요.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "다시 이야기하기" })).toHaveProperty(
      "disabled",
      false,
    );
    fireEvent.change(screen.getByRole("textbox", { name: "이어서 말하기" }), {
      target: { value: "새로 적은 초안" },
    });
    rerender(<ConversationHistoryWindow snapshot={{ ...failed }} />);
    expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty(
      "value",
      "새로 적은 초안",
    );
  },
);

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
  // Enabling the editor commits before its passive effect moves focus.
  await waitFor(() =>
    expect(document.activeElement).toBe(screen.getByRole("textbox", { name: "이어서 말하기" })),
  );
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
