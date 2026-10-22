import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { listen } from "@tauri-apps/api/event";
import { ConversationHistoryWindow } from "../components/Balloon/ConversationHistoryWindow";
import { useHistoryScroll } from "../components/Balloon/useHistoryScroll";
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
      if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
      if (name === "release_conversation_history") return true;
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
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
      if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
      if (name === "release_conversation_history") return true;
      if (name === "get_conversations") return hasMatch ? [FIRST, other] : [FIRST];
      if (name === "get_conversation_messages" && args?.sessionId === other.id)
        return { ...SECOND_VIEW, session: other };
      return fallback(name, args);
    });
    render(<ConversationHistoryWindow snapshot={SNAPSHOT} initialPersona="builtin-a" />);
    await screen.findByText(/첫 대화 원문/);
    fireEvent.click(screen.getByRole("button", { name: "지난 대화 닫기" }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith(
        "release_conversation_history",
        expect.objectContaining({ generation: 1 }),
      ),
    );
    const reopen = vi
      .mocked(listen)
      .mock.calls.find(([event]) => event === "conversation-history-open")?.[1];
    await act(async () =>
      reopen?.({
        event: "conversation-history-open",
        id: 2,
        payload: { generation: 2, persona: "builtin-b" },
      }),
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
    expect(command).toHaveBeenCalledWith(
      "release_conversation_history",
      expect.objectContaining({ sessionId: FIRST.id, generation: 1 }),
    ),
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
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
      if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
      if (name === "release_conversation_history") return true;
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
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
    expect(command).toHaveBeenCalledWith(
      "release_conversation_history",
      expect.objectContaining({ sessionId: FIRST.id, generation: 1 }),
    ),
  );
});

it("ignores input while the closing draft save and release are pending", async () => {
  const save = deferred<void>();
  const release = deferred<boolean>();
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "save_conversation_draft") return save.promise;
    if (name === "release_conversation_history") return release.promise;
    return fallback(name, args);
  });
  const input = screen.getByRole("textbox", { name: "이어서 말하기" });
  const content = "  닫기 전 초안\n그대로 보존  ";
  fireEvent.change(input, { target: { value: content } });
  act(() => native.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_conversation_draft", {
      sessionId: FIRST.id,
      draft: content,
      inputOwner: "history",
    }),
  );
  fireEvent.change(input, { target: { value: "저장 응답 대기 중 입력" } });
  expect(input).toHaveProperty("value", content);
  expect(command).not.toHaveBeenCalledWith("release_conversation_history", expect.anything());

  await act(async () => save.resolve());
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("release_conversation_history", expect.anything()),
  );
  fireEvent.change(input, { target: { value: "닫기 응답 대기 중 입력" } });
  expect(input).toHaveProperty("value", content);
  expect(vi.mocked(command).mock.calls.filter(([name]) => name === "save_conversation_draft"))
    .toHaveLength(1);
  await act(async () => release.resolve(true));
});

it("preserves a rejected send and does not send while composing Korean text", async () => {
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
      if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
      if (name === "release_conversation_history") return true;
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
      expect(command).toHaveBeenCalledWith(
        "release_conversation_history",
        expect.objectContaining({ sessionId: FIRST.id, generation: 1 }),
      ),
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
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
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
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "release_conversation_history",
      expect.objectContaining({ generation: 1 }),
    ),
  );
  const updated = {
    ...FIRST_VIEW,
    messages: [
      ...FIRST_VIEW.messages,
      { ...MESSAGE, id: "new-desktop-message", content: "바탕화면에서 더 나눈 이야기" },
    ],
  };
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
    if (name === "get_conversations") return [FIRST, SECOND];
    if (name === "get_conversation_messages") return updated;
  });
  const reopen = vi
    .mocked(listen)
    .mock.calls.find(([event]) => event === "conversation-history-open")?.[1];
  expect(reopen).toBeTypeOf("function");
  await act(async () =>
    reopen?.({
      event: "conversation-history-open",
      id: 1,
      payload: { generation: 2, persona: "builtin-a" },
    }),
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

// jsdom has no layout. Model the bounded transcript's geometry and scroll clamping,
// keeping these assertions separate from native WebKit visual acceptance.
function historyGeometry(viewport = 400) {
  let logTop = 80;
  const tops = new WeakMap<HTMLElement, number>();
  const writes = vi.fn();
  const isLog = (element: HTMLElement) => element.getAttribute("role") === "log";
  const messages = (element: HTMLElement) =>
    Array.from(element.querySelectorAll("article"), (article) => article.parentElement!);
  const events = (element: HTMLElement) =>
    Array.from(element.querySelectorAll(":scope > p:not([role])")).slice(1);
  const above = (element: HTMLElement) =>
    40 +
    (Array.from(element.querySelectorAll("button")).some(
      (button) => button.textContent === "앞선 내용 더 보기",
    )
      ? 30
      : 0) +
    (element.textContent?.includes("대화 기록을 불러오고 있어요.") ? 20 : 0);
  const height = (element: HTMLElement) =>
    above(element) + messages(element).length * 100 + events(element).length * 30;
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return isLog(this) ? viewport : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return isLog(this) ? Math.max(viewport, height(this)) : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollTop", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return isLog(this) ? Math.min(tops.get(this) ?? 0, Math.max(0, height(this) - viewport)) : 0;
  });
  vi.spyOn(HTMLElement.prototype, "scrollTop", "set").mockImplementation(function (
    this: HTMLElement,
    value,
  ) {
    if (!isLog(this)) return;
    tops.set(this, Math.max(0, Math.min(value, height(this) - viewport)));
    writes(value);
  });
  vi.spyOn(HTMLElement.prototype, "offsetTop", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    if (isLog(this)) return logTop;
    const log = this.closest('[role="log"]') as HTMLElement | null;
    return log && this.hasAttribute("data-history-message")
      ? logTop +
          above(log) +
          Array.from(messages(log)).indexOf(this) * 100 +
          events(log).filter(
            (event) => event.compareDocumentPosition(this) & Node.DOCUMENT_POSITION_FOLLOWING,
          ).length *
            30
      : 0;
  });
  return {
    writes,
    moveLog: (top: number): void => {
      logTop = top;
    },
    resizeViewport: (height: number): void => {
      viewport = height;
    },
  };
}

function scrollHistory(log: HTMLElement, top: number): void {
  log.scrollTop = top;
  fireEvent.scroll(log);
}

function longHistory(count = 8, session = FIRST): ConversationView {
  return {
    session,
    messages: Array.from({ length: count }, (_, index) => ({
      ...MESSAGE,
      id: index === 0 && session === FIRST ? MESSAGE.id : `${session.id}-${index}`,
      content: index === 0 && session === FIRST ? MESSAGE.content : `${session.id} 원문 ${index}`,
    })),
    nextBefore: null,
  };
}

function mockHistory(first: ConversationView, second = longHistory(10, SECOND)): void {
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_conversation_history_state") return { generation: 1, restoration: null };
    if (name === "release_conversation_history") return true;
    if (name === "get_conversations") return [first.session, second.session];
    if (name === "get_conversation_messages" || name === "resume_chat")
      return args?.sessionId === second.session.id ? second : first;
  });
}

function appendHistory(view: ConversationView, id = "reply"): ConversationView {
  return { ...view, messages: [...view.messages, { ...MESSAGE, id, content: `새 답장 ${id}` }] };
}

it("follows a pinned history tail after a reply, without jumping on initial load or snapshot churn", async () => {
  const { writes } = historyGeometry();
  const view = longHistory();
  mockHistory(view);
  const { rerender } = render(
    <ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: view }} />,
  );
  await screen.findByText("first 원문 7");
  const log = screen.getByRole("log", { name: "대화 내용" });
  expect(log.scrollTop).toBe(0);
  scrollHistory(log, log.scrollHeight);
  const next = { ...SNAPSHOT, conversation: appendHistory(view) };
  rerender(<ConversationHistoryWindow snapshot={next} />);
  await screen.findByText("새 답장 reply");
  expect(log.scrollTop).toBe(log.scrollHeight - log.clientHeight);
  writes.mockClear();
  rerender(<ConversationHistoryWindow snapshot={{ ...next }} />);
  expect(writes).not.toHaveBeenCalled();
});

it.each([0, 200])(
  "preserves a reader's history position at %i when replies arrive",
  async (top) => {
    historyGeometry();
    const view = longHistory();
    mockHistory(view);
    const { rerender } = render(
      <ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: view }} />,
    );
    await screen.findByText("first 원문 7");
    const log = screen.getByRole("log", { name: "대화 내용" });
    scrollHistory(log, top);
    rerender(
      <ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: appendHistory(view) }} />,
    );
    await screen.findByText("새 답장 reply");
    expect(log.scrollTop).toBe(top);
  },
);

it.each([
  [24, true],
  [25, false],
] as const)(
  "follows only within the small bottom margin (%ipx away: %s)",
  async (distance, follows) => {
    historyGeometry();
    const view = longHistory();
    mockHistory(view);
    const { rerender } = render(
      <ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: view }} />,
    );
    await screen.findByText("first 원문 7");
    const log = screen.getByRole("log", { name: "대화 내용" });
    const top = log.scrollHeight - log.clientHeight - distance;
    scrollHistory(log, top);
    rerender(
      <ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: appendHistory(view) }} />,
    );
    await screen.findByText("새 답장 reply");
    expect(log.scrollTop).toBe(follows ? log.scrollHeight - log.clientHeight : top);
  },
);

it("keeps the reading position when the header moves the transcript within its offset parent", async () => {
  const { moveLog } = historyGeometry();
  const view = longHistory();
  mockHistory(view);
  const snapshot = { ...SNAPSHOT, conversation: view };
  const { rerender } = render(<ConversationHistoryWindow snapshot={snapshot} />);
  await screen.findByText("first 원문 7");
  const log = screen.getByRole("log", { name: "대화 내용" });
  scrollHistory(log, 200);
  moveLog(120);
  rerender(<ConversationHistoryWindow snapshot={{ ...snapshot }} />);
  expect(log.scrollTop).toBe(200);
});

it("preserves the reading position when a timeline event appears before the first message", async () => {
  historyGeometry();
  const view = longHistory();
  mockHistory(view);
  const { rerender } = render(
    <ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: view }} />,
  );
  await screen.findByText("first 원문 7");
  const log = screen.getByRole("log", { name: "대화 내용" });
  scrollHistory(log, 200);
  rerender(
    <ConversationHistoryWindow
      snapshot={{
        ...SNAPSHOT,
        conversation: {
          ...view,
          timelineEvents: [
            { id: "before-first", kind: "focus-paused", createdAt: MESSAGE.createdAt - 1 },
          ],
        },
      }}
    />,
  );
  await screen.findByText(/집중을 시작해서 대화를 멈췄어요/);
  expect(log.scrollTop).toBe(230);
});

it("follows when a previously fitting history first becomes scrollable", async () => {
  historyGeometry();
  const view = longHistory(3);
  mockHistory(view);
  const { rerender } = render(
    <ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: view }} />,
  );
  await screen.findByText("first 원문 2");
  const log = screen.getByRole("log", { name: "대화 내용" });
  expect(log.scrollTop).toBe(0);
  rerender(
    <ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: appendHistory(view) }} />,
  );
  await screen.findByText("새 답장 reply");
  expect(log.scrollTop).toBe(40);
});

it("returns to the tail for an own send, but lets the reader scroll up before its reply", async () => {
  historyGeometry();
  const view = longHistory();
  mockHistory(view);
  const { rerender } = render(
    <ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: view }} />,
  );
  await begin();
  const log = screen.getByRole("log", { name: "대화 내용" });
  scrollHistory(log, 200);
  const input = screen.getByRole("textbox", { name: "이어서 말하기" });
  fireEvent.change(input, { target: { value: "안녕" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(command).toHaveBeenCalledWith("send_message", expect.anything()));
  expect(log.scrollTop).toBe(log.scrollHeight - log.clientHeight);
  const sent = appendHistory(view, "sent");
  sent.messages[sent.messages.length - 1].role = "user";
  const live = { ...SNAPSHOT, panel: { persona: "builtin-a", mode: "history-input" as const } };
  rerender(<ConversationHistoryWindow snapshot={{ ...live, conversation: sent }} />);
  await screen.findByText("새 답장 sent");
  expect(log.scrollTop).toBe(log.scrollHeight - log.clientHeight);
  scrollHistory(log, 100);
  rerender(<ConversationHistoryWindow snapshot={{ ...live, conversation: appendHistory(sent) }} />);
  await screen.findByText("새 답장 reply");
  expect(log.scrollTop).toBe(100);
});

it("returns to the tail when retrying an incomplete turn and follows its reply", async () => {
  historyGeometry();
  const view: ConversationView = {
    ...longHistory(),
    recovery: { messageId: MESSAGE.id, reason: "cancelled" },
  };
  mockHistory(view);
  const { rerender } = render(
    <ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: view }} />,
  );
  await begin();
  const log = screen.getByRole("log", { name: "대화 내용" });
  scrollHistory(log, 100);
  fireEvent.click(screen.getByRole("button", { name: "다시 이야기하기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("retry_turn", {
      messageId: MESSAGE.id,
      target: MESSAGE.persona,
    }),
  );
  expect(log.scrollTop).toBe(log.scrollHeight - log.clientHeight);
  rerender(
    <ConversationHistoryWindow
      snapshot={{
        ...SNAPSHOT,
        panel: { persona: "builtin-a", mode: "history-input" },
        conversation: appendHistory(view),
      }}
    />,
  );
  await screen.findByText("새 답장 reply");
  expect(log.scrollTop).toBe(log.scrollHeight - log.clientHeight);
});

it("does not carry tail following into another session or react to the old session's reply", async () => {
  historyGeometry();
  const first = longHistory();
  const second = longHistory(10, SECOND);
  mockHistory(first, second);
  const { rerender } = render(
    <ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: first }} />,
  );
  await screen.findByText("first 원문 7");
  const log = screen.getByRole("log", { name: "대화 내용" });
  scrollHistory(log, log.scrollHeight);
  fireEvent.click(screen.getByRole("button", { name: /두 번째 초안/ }));
  await screen.findByText("second 원문 9");
  expect(log.scrollTop).toBe(0);
  rerender(
    <ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: appendHistory(first) }} />,
  );
  await waitFor(() => expect(log.textContent).toContain("second 원문 9"));
  expect(log.scrollTop).toBe(0);
  expect(screen.queryByText("새 답장 reply")).toBeNull();
});

it.each([false, true])(
  "handles older-page prepends and simultaneous replies (pinned: %s)",
  async (pinned) => {
    historyGeometry();
    const older = deferred<ConversationMessages>();
    const view = { ...longHistory(), nextBefore: 5 };
    mockHistory(view);
    const fallback = vi.mocked(command).getMockImplementation()!;
    vi.mocked(command).mockImplementation(async (name, args) =>
      name === "get_conversation_messages" && args?.before ? older.promise : fallback(name, args),
    );
    const { rerender } = render(
      <ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: view }} />,
    );
    await screen.findByText("first 원문 7");
    const log = screen.getByRole("log", { name: "대화 내용" });
    scrollHistory(log, 100);
    fireEvent.click(screen.getByRole("button", { name: "앞선 내용 더 보기" }));
    if (pinned) scrollHistory(log, log.scrollHeight);
    await act(async () => {
      rerender(
        <ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: appendHistory(view) }} />,
      );
      older.resolve({
        messages: [
          { ...MESSAGE, id: "earlier-1", content: "앞선 원문 1" },
          { ...MESSAGE, id: "earlier-2", content: "앞선 원문 2" },
        ],
        nextBefore: 3,
      });
    });
    await screen.findByText("앞선 원문 1");
    expect(screen.getByText("새 답장 reply")).toBeTruthy();
    expect(log.scrollTop).toBe(pinned ? log.scrollHeight - log.clientHeight : 300);
  },
);

it("restores an older reading position after a same-session history refresh", async () => {
  historyGeometry();
  const view = longHistory();
  mockHistory(view);
  const { rerender } = render(
    <ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: view }} />,
  );
  await screen.findByText("first 원문 7");
  const log = screen.getByRole("log", { name: "대화 내용" });
  scrollHistory(log, 200);
  rerender(
    <ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: view, memoryRevision: 1 }} />,
  );
  await screen.findByText("first 원문 7");
  expect(log.scrollTop).toBe(200);
});

it("opens a long ended history at the top after a short pinned session", async () => {
  historyGeometry();
  const ended = deferred<ConversationMessages>();
  const first = longHistory(2);
  const second = longHistory(10, { ...SECOND, status: "ended" });
  mockHistory(first, second);
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) =>
    name === "get_conversation_messages" && args?.sessionId === SECOND.id
      ? ended.promise
      : fallback(name, args),
  );
  render(<ConversationHistoryWindow snapshot={{ ...SNAPSHOT, conversation: first }} />);
  await screen.findByText("first 원문 1");
  const log = screen.getByRole("log", { name: "대화 내용" });
  expect(log.scrollTop).toBe(0);
  fireEvent.click(screen.getByRole("button", { name: /두 번째 초안/ }));
  await act(async () => ended.resolve(second));
  await screen.findByText("second 원문 9");
  expect(log.scrollTop).toBe(0);
});

it("retains explicit send-follow intent while the same history is reloading", () => {
  historyGeometry();
  const view = longHistory();
  function ReloadingHistory({ page }: { page: ConversationMessages | null }) {
    const transcript = useHistoryScroll(FIRST.id, page);
    return (
      <>
        <div role="log" ref={transcript.log} onScroll={transcript.onScroll}>
          {page?.messages.map((message) => (
            <div key={message.id} data-history-message={message.id}>
              <article>{message.content}</article>
            </div>
          ))}
        </div>
        <button onClick={transcript.followTail}>Follow sent message</button>
      </>
    );
  }
  const { rerender } = render(<ReloadingHistory page={view} />);
  const log = screen.getByRole("log");
  scrollHistory(log, 200);
  rerender(<ReloadingHistory page={null} />);
  fireEvent.click(screen.getByRole("button", { name: "Follow sent message" }));
  rerender(<ReloadingHistory page={appendHistory(view)} />);
  expect(log.scrollTop).toBe(log.scrollHeight - log.clientHeight);
});

it("restores selection, filter and search from identifiers but reads the current database draft", async () => {
  const fresh = { ...SECOND, draft: "다른 창에서 고친 최신 초안" };
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_conversation_history_state")
      return {
        generation: 7,
        restoration: {
          userId: FIRST.userId,
          selectedId: SECOND.id,
          filter: "builtin-a",
          query: "이야기",
          anchor: null,
          followingTail: true,
        },
      };
    if (name === "get_conversations") return [FIRST, fresh];
    if (name === "resume_chat") return { ...SECOND_VIEW, session: fresh };
    return fallback(name, args);
  });
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} initialPersona="all" />);
  await screen.findByText("다음 대화 원문");
  expect(command).toHaveBeenCalledWith("get_conversations", { query: "이야기" });
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty(
    "value",
    fresh.draft,
  );
  fireEvent.click(screen.getByRole("button", { name: "이어서 말하기" }));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "지난 대화 닫기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("release_conversation_history", {
      sessionId: SECOND.id,
      generation: 7,
      restoration: {
        userId: FIRST.userId,
        selectedId: SECOND.id,
        filter: "builtin-a",
        query: "이야기",
        anchor: null,
        followingTail: true,
      },
    }),
  );
});

it.each(["another-user", FIRST.userId])(
  "does not restore a missing or foreign selection (%s)",
  async (userId) => {
    const fallback = vi.mocked(command).getMockImplementation()!;
    vi.mocked(command).mockImplementation(async (name, args) =>
      name === "get_conversation_history_state"
        ? {
            generation: 2,
            restoration: {
              userId,
              selectedId: "deleted-session",
              filter: "all",
              query: "",
              anchor: { messageId: "deleted-message", offset: 10 },
              followingTail: false,
            },
          }
        : fallback(name, args),
    );
    render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
    await screen.findByText(/첫 대화 원문/);
    expect(command).not.toHaveBeenCalledWith(
      "get_conversation_messages",
      expect.objectContaining({ sessionId: "deleted-session" }),
    );
  },
);

it("requeries older pages beyond the newest 100 messages to restore the reading anchor", async () => {
  historyGeometry();
  const history = longHistory(205);
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_conversation_history_state")
      return {
        generation: 3,
        restoration: {
          userId: FIRST.userId,
          selectedId: FIRST.id,
          filter: "all",
          query: "",
          anchor: { messageId: "first-3", offset: -15 },
          followingTail: false,
        },
      };
    if (name === "get_conversation_messages") {
      const end = typeof args?.before === "number" ? args.before : 205;
      return {
        messages: history.messages.slice(Math.max(0, end - 100), end),
        nextBefore: end > 100 ? end - 100 : null,
      };
    }
    return fallback(name, args);
  });
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await screen.findByText("first 원문 204");
  const log = screen.getByRole("log");
  expect(command).toHaveBeenCalledWith("get_conversation_messages", {
    sessionId: FIRST.id,
    before: 105,
  });
  expect(command).toHaveBeenCalledWith("get_conversation_messages", {
    sessionId: FIRST.id,
    before: 5,
  });
  expect(log.scrollTop).toBe(355);
  fireEvent.click(screen.getByRole("button", { name: "지난 대화 닫기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "release_conversation_history",
      expect.objectContaining({
        restoration: expect.objectContaining({
          followingTail: false,
          anchor: expect.objectContaining({ messageId: "first-4", offset: 85 }),
        }),
      }),
    ),
  );
});

it.each(["reopen", "memoryRevision", "hidden-reopen"])(
  "requeries a paginated reading anchor while refreshing latest messages on %s",
  async (refresh) => {
    const geometry = historyGeometry();
    let history = longHistory(104);
    const fallback = vi.mocked(command).getMockImplementation()!;
    vi.mocked(command).mockImplementation(async (name, args) => {
      if (name === "get_conversation_messages") {
        const end = typeof args?.before === "number" ? args.before : history.messages.length;
        return {
          messages: history.messages.slice(Math.max(0, end - 100), end),
          nextBefore: end > 100 ? end - 100 : null,
        };
      }
      return fallback(name, args);
    });
    const { rerender } = render(
      <ConversationHistoryWindow snapshot={SNAPSHOT} initialPersona="builtin-a" />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "앞선 내용 더 보기" }));
    await screen.findByText("first 원문 2");
    const log = screen.getByRole("log");
    scrollHistory(log, 155);
    const anchorOffset = (): number => {
      const anchor = log.querySelector<HTMLElement>('[data-history-message="first-2"]');
      expect(anchor).not.toBeNull();
      return anchor!.offsetTop - log.offsetTop - log.scrollTop;
    };
    const beforeOffset = anchorOffset();
    expect(screen.queryByRole("button", { name: "앞선 내용 더 보기" })).toBeNull();
    if (refresh !== "memoryRevision") {
      fireEvent.click(screen.getByRole("button", { name: "지난 대화 닫기" }));
      await waitFor(() =>
        expect(command).toHaveBeenCalledWith(
          "release_conversation_history",
          expect.objectContaining({ generation: 1 }),
        ),
      );
    }
    history = longHistory(105);
    if (refresh === "hidden-reopen") {
      geometry.resizeViewport(0);
      rerender(
        <ConversationHistoryWindow
          snapshot={{ ...SNAPSHOT, memoryRevision: SNAPSHOT.memoryRevision + 1 }}
          initialPersona="builtin-a"
        />,
      );
      await screen.findByText("first 원문 104");
      // Hidden GTK views can report a reset scroll position and dispatch scroll.
      scrollHistory(log, 0);
      geometry.resizeViewport(400);
    }
    if (refresh !== "memoryRevision") {
      const reopen = vi
        .mocked(listen)
        .mock.calls.find(([event]) => event === "conversation-history-open")?.[1];
      expect(reopen).toBeTypeOf("function");
      await act(async () =>
        reopen?.({
          event: "conversation-history-open",
          id: 12,
          payload: { generation: 2, persona: refresh === "hidden-reopen" ? "all" : "builtin-a" },
        }),
      );
    } else {
      rerender(
        <ConversationHistoryWindow
          snapshot={{ ...SNAPSHOT, memoryRevision: SNAPSHOT.memoryRevision + 1 }}
          initialPersona="builtin-a"
        />,
      );
    }
    await screen.findByText("first 원문 104");
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("get_conversation_messages", {
        sessionId: FIRST.id,
        before: 5,
      }),
    );
    expect(screen.getByText("first 원문 2")).toBeTruthy();
    expect(anchorOffset()).toBe(beforeOffset);
    expect(screen.queryByRole("button", { name: "앞선 내용 더 보기" })).toBeNull();
  },
);

it("keeps loaded older pages and the reading anchor when reacquiring the same history editor", async () => {
  historyGeometry();
  const history = longHistory(104);
  let draft = "History draft A";
  const latest = (): ConversationView => ({
    ...history,
    session: { ...FIRST, draft },
    messages: history.messages.slice(4).map((message) =>
      message.id === "first-103" ? { ...message, content: "최신 원문" } : message,
    ),
    nextBefore: 4,
  });
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_conversations") return [{ ...FIRST, draft }];
    if (name === "resume_chat") return latest();
    if (name === "get_conversation_messages")
      return args?.before === 4
        ? { messages: history.messages.slice(0, 4), nextBefore: null }
        : latest();
    return fallback(name, args);
  });
  const { rerender } = render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await screen.findByText("최신 원문");
  fireEvent.click(screen.getByRole("button", { name: "이어서 말하기" }));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty("disabled", false),
  );
  fireEvent.click(screen.getByRole("button", { name: "앞선 내용 더 보기" }));
  await screen.findByText("first 원문 2");
  const log = screen.getByRole("log");
  scrollHistory(log, 155);
  fireEvent.click(screen.getByRole("button", { name: "지난 대화 닫기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("release_conversation_history", expect.anything()),
  );
  draft = "Desktop draft B";
  rerender(
    <ConversationHistoryWindow
      snapshot={{ ...SNAPSHOT, panel: { persona: "builtin-a", mode: "input" }, conversation: latest() }}
    />,
  );
  const reopen = vi.mocked(listen).mock.calls.find(([event]) => event === "conversation-history-open")?.[1];
  await act(async () =>
    reopen?.({ event: "conversation-history-open", id: 13, payload: { generation: 2, persona: "all" } }),
  );
  await screen.findByText("first 원문 2");
  fireEvent.click(screen.getByRole("button", { name: "이어서 말하기" }));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty("disabled", false),
  );
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty("value", draft);
  expect(screen.getByText("최신 원문")).toBeTruthy();
  expect(screen.getByText("first 원문 2")).toBeTruthy();
  const anchor = log.querySelector<HTMLElement>('[data-history-message="first-2"]')!;
  expect(anchor.offsetTop - log.offsetTop - log.scrollTop).toBe(85);
  expect(screen.queryByRole("button", { name: "앞선 내용 더 보기" })).toBeNull();
});

it("replaces older loaded pages when adopting another session", async () => {
  historyGeometry();
  const first = longHistory(104);
  const second = longHistory(10, SECOND);
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_conversation_messages") {
      if (args?.sessionId === SECOND.id) return second;
      return args?.before === 4
        ? { messages: first.messages.slice(0, 4), nextBefore: null }
        : { messages: first.messages.slice(4), nextBefore: 4 };
    }
    if (name === "resume_chat") return second;
    return fallback(name, args);
  });
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  fireEvent.click(await screen.findByRole("button", { name: "앞선 내용 더 보기" }));
  await screen.findByText("first 원문 2");
  fireEvent.click(screen.getByRole("button", { name: /두 번째 초안/ }));
  await screen.findByText("second 원문 9");
  expect(screen.queryByText("first 원문 2")).toBeNull();
  expect(screen.queryByText("first 원문 103")).toBeNull();
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty("value", SECOND.draft);
});

it("does not merge a late editor adoption into another user's same-id transcript", async () => {
  historyGeometry();
  const first = longHistory(104);
  const pending = deferred<ConversationView>();
  const foreignSession = { ...FIRST, userId: "other-user", draft: "Other user draft" };
  const foreign = {
    ...longHistory(10, foreignSession),
    messages: [{ ...MESSAGE, id: "foreign-message", content: "Other user transcript" }],
  };
  let changedUser = false;
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_conversations") return [changedUser ? foreignSession : FIRST];
    if (name === "get_conversation_messages") {
      if (changedUser) return foreign;
      return args?.before === 4
        ? { messages: first.messages.slice(0, 4), nextBefore: null }
        : { messages: first.messages.slice(4), nextBefore: 4 };
    }
    if (name === "resume_chat") return changedUser ? foreign : pending.promise;
    return fallback(name, args);
  });
  const { rerender } = render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  fireEvent.click(await screen.findByRole("button", { name: "앞선 내용 더 보기" }));
  await screen.findByText("first 원문 2");
  fireEvent.click(screen.getByRole("button", { name: "이어서 말하기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("resume_chat", expect.anything()));
  changedUser = true;
  rerender(<ConversationHistoryWindow snapshot={{ ...SNAPSHOT, user: { ...SNAPSHOT.user!, id: foreignSession.userId } }} />);
  await screen.findByText("Other user transcript");
  await act(async () => pending.resolve({ ...first, messages: first.messages.slice(4), nextBefore: 4 }));
  fireEvent.click(screen.getByRole("button", { name: "이어서 말하기" }));
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty("disabled", false),
  );
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty("value", foreignSession.draft);
  expect(screen.getByText("Other user transcript")).toBeTruthy();
  expect(screen.queryByText("first 원문 2")).toBeNull();
  expect(screen.queryByText("first 원문 103")).toBeNull();
});

it("keeps the restoration anchor when a memory refresh supersedes older-page hydration", async () => {
  historyGeometry();
  const staleOlder = deferred<ConversationMessages>();
  let history = longHistory(104);
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_conversation_history_state")
      return {
        generation: 3,
        restoration: {
          userId: FIRST.userId,
          selectedId: FIRST.id,
          filter: "all",
          query: "",
          anchor: { messageId: "first-2", offset: 85 },
          followingTail: false,
        },
      };
    if (name === "get_conversation_messages") {
      if (args?.before === 4) return staleOlder.promise;
      const end = typeof args?.before === "number" ? args.before : history.messages.length;
      return {
        messages: history.messages.slice(Math.max(0, end - 100), end),
        nextBefore: end > 100 ? end - 100 : null,
      };
    }
    return fallback(name, args);
  });
  const { rerender } = render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("get_conversation_messages", {
      sessionId: FIRST.id,
      before: 4,
    }),
  );
  history = longHistory(105);
  rerender(
    <ConversationHistoryWindow
      snapshot={{ ...SNAPSHOT, memoryRevision: SNAPSHOT.memoryRevision + 1 }}
    />,
  );
  await screen.findByText("first 원문 104");
  expect(screen.getByText("first 원문 2")).toBeTruthy();
  expect(screen.getByRole("log").scrollTop).toBe(155);
  await act(async () =>
    staleOlder.resolve({
      messages: [{ ...MESSAGE, id: "first-2", content: "오래된 복원 응답" }],
      nextBefore: null,
    }),
  );
  expect(screen.queryByText("오래된 복원 응답")).toBeNull();
  expect(screen.getByRole("log").scrollTop).toBe(155);
});

it.each(["session", "user"])(
  "does not apply an old reading anchor after the %s changes during hydration",
  async (change) => {
    historyGeometry();
    const older = deferred<ConversationMessages>();
    const first = longHistory(104);
    let target = longHistory(10, SECOND);
    let changedUser = false;
    const fallback = vi.mocked(command).getMockImplementation()!;
    vi.mocked(command).mockImplementation(async (name, args) => {
      if (name === "get_conversation_history_state")
        return {
          generation: 3,
          restoration: changedUser
            ? null
            : {
                userId: FIRST.userId,
                selectedId: FIRST.id,
                filter: "all",
                query: "",
                anchor: { messageId: "first-2", offset: 85 },
                followingTail: false,
              },
        };
      if (name === "get_conversations") return changedUser ? [target.session] : [FIRST, SECOND];
      if (name === "get_conversation_messages" || name === "resume_chat") {
        if (args?.sessionId === target.session.id) return target;
        if (args?.before === 4) return older.promise;
        return { messages: first.messages.slice(4), nextBefore: 4 };
      }
      return fallback(name, args);
    });
    const { rerender } = render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("get_conversation_messages", {
        sessionId: FIRST.id,
        before: 4,
      }),
    );
    if (change === "user") {
      changedUser = true;
      target = longHistory(10, { ...SECOND, id: "foreign", userId: "other-user" });
      rerender(
        <ConversationHistoryWindow
          snapshot={{ ...SNAPSHOT, user: { ...SNAPSHOT.user!, id: "other-user" } }}
        />,
      );
    } else {
      fireEvent.click(screen.getByRole("button", { name: /두 번째 초안/ }));
    }
    await screen.findByText(`${target.session.id} 원문 9`);
    const log = screen.getByRole("log");
    const selectedTop = log.scrollTop;
    await act(async () =>
      older.resolve({
        messages: [{ ...MESSAGE, id: "first-2", content: "다른 대화의 오래된 복원 응답" }],
        nextBefore: null,
      }),
    );
    expect(screen.queryByText("다른 대화의 오래된 복원 응답")).toBeNull();
    expect(screen.getByText(`${target.session.id} 원문 9`)).toBeTruthy();
    expect(log.scrollTop).toBe(selectedTop);
  },
);

it("preserves an initially hidden saved anchor across a second hidden memory refresh", async () => {
  const geometry = historyGeometry(0);
  let history = longHistory(104);
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_conversation_history_state")
      return {
        generation: 3,
        restoration: {
          userId: FIRST.userId,
          selectedId: FIRST.id,
          filter: "all",
          query: "",
          anchor: { messageId: "first-2", offset: 85 },
          followingTail: false,
        },
      };
    if (name === "get_conversation_messages") {
      const end = typeof args?.before === "number" ? args.before : history.messages.length;
      return {
        messages: history.messages.slice(Math.max(0, end - 100), end),
        nextBefore: end > 100 ? end - 100 : null,
      };
    }
    return fallback(name, args);
  });
  const { rerender } = render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await screen.findByText("first 원문 2");
  const log = screen.getByRole("log");
  expect(log.clientHeight).toBe(0);
  history = longHistory(105);
  const refreshed = { ...SNAPSHOT, memoryRevision: SNAPSHOT.memoryRevision + 1 };
  rerender(<ConversationHistoryWindow snapshot={refreshed} />);
  await screen.findByText("first 원문 104");
  expect(command).toHaveBeenCalledWith("get_conversation_messages", {
    sessionId: FIRST.id,
    before: 5,
  });
  expect(screen.getByText("first 원문 2")).toBeTruthy();
  scrollHistory(log, 0);
  geometry.resizeViewport(400);
  rerender(<ConversationHistoryWindow snapshot={{ ...refreshed }} />);
  expect(log.scrollTop).toBe(155);
  const anchor = log.querySelector<HTMLElement>('[data-history-message="first-2"]')!;
  expect(anchor.offsetTop - log.offsetTop - log.scrollTop).toBe(85);
});

it.each([
  ["session", false],
  ["session", true],
  ["user", false],
  ["user", true],
] as const)(
  "isolates hidden pending restoration after a %s change (tail=%s)",
  async (change, followingTail) => {
    const geometry = historyGeometry(0);
    const first = longHistory(104);
    let changedUser = false;
    let target = longHistory(10, SECOND);
    // Deliberately overlap an anchor ID to test scope, not accidental ID absence.
    target.messages[2] = { ...target.messages[2], id: "first-2" };
    const fallback = vi.mocked(command).getMockImplementation()!;
    vi.mocked(command).mockImplementation(async (name, args) => {
      if (name === "get_conversation_history_state")
        return {
          generation: 3,
          restoration: changedUser
            ? null
            : {
                userId: FIRST.userId,
                selectedId: FIRST.id,
                filter: "all",
                query: "",
                anchor: { messageId: "first-2", offset: 85 },
                followingTail,
              },
        };
      if (name === "get_conversations") return changedUser ? [target.session] : [FIRST, SECOND];
      if (name === "get_conversation_messages" || name === "resume_chat") {
        if (args?.sessionId === target.session.id) return target;
        const end = typeof args?.before === "number" ? args.before : first.messages.length;
        return {
          messages: first.messages.slice(Math.max(0, end - 100), end),
          nextBefore: end > 100 ? end - 100 : null,
        };
      }
      return fallback(name, args);
    });
    let snapshot = SNAPSHOT;
    const { rerender } = render(<ConversationHistoryWindow snapshot={snapshot} />);
    await screen.findByText(followingTail ? "first 원문 103" : "first 원문 2");
    expect(screen.getByRole("log").clientHeight).toBe(0);
    if (change === "user") {
      changedUser = true;
      target = longHistory(10, { ...SECOND, id: "foreign", userId: "other-user" });
      target.messages[2] = { ...target.messages[2], id: "first-2" };
      snapshot = { ...SNAPSHOT, user: { ...SNAPSHOT.user!, id: "other-user" } };
      rerender(<ConversationHistoryWindow snapshot={snapshot} />);
    } else {
      fireEvent.click(screen.getByRole("button", { name: /두 번째 초안/ }));
    }
    await screen.findByText(`${target.session.id} 원문 9`);
    geometry.resizeViewport(400);
    rerender(<ConversationHistoryWindow snapshot={{ ...snapshot }} />);
    const log = screen.getByRole("log");
    expect(log.scrollTop).toBe(0);
    expect(screen.getByText(`${target.session.id} 원문 9`)).toBeTruthy();
    expect(screen.queryByText("first 원문 103")).toBeNull();
  },
);

it("restores tail following against newly queried messages", async () => {
  historyGeometry();
  mockHistory(longHistory(10));
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) =>
    name === "get_conversation_history_state"
      ? {
          generation: 2,
          restoration: {
            userId: FIRST.userId,
            selectedId: FIRST.id,
            filter: "all",
            query: "",
            anchor: null,
            followingTail: true,
          },
        }
      : fallback(name, args),
  );
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await screen.findByText("first 원문 9");
  const log = screen.getByRole("log");
  expect(log.scrollTop).toBe(log.scrollHeight - log.clientHeight);
});

it("keeps the window and editor when close-time draft persistence fails", async () => {
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "save_conversation_draft") throw new Error("초안을 저장하지 못했어요");
    return fallback(name, args);
  });
  const input = screen.getByRole("textbox", { name: "이어서 말하기" });
  fireEvent.change(input, { target: { value: "버리면 안 되는 원문" } });
  act(() => native.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() }));
  await screen.findByText("초안을 저장하지 못했어요");
  expect(input).toHaveProperty("value", "버리면 안 되는 원문");
  expect(input).toHaveProperty("disabled", false);
  expect(command).not.toHaveBeenCalledWith("release_conversation_history", expect.anything());
});

it("cancels a close waiting for draft persistence when History is reopened", async () => {
  const save = deferred<void>();
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) =>
    name === "save_conversation_draft" ? save.promise : fallback(name, args),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "이어서 말하기" }), {
    target: { value: "재열기 중에도 유지" },
  });
  act(() => native.onCloseRequested.mock.calls[0][0]({ preventDefault: vi.fn() }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_conversation_draft", expect.anything()),
  );
  const reopen = vi
    .mocked(listen)
    .mock.calls.find(([event]) => event === "conversation-history-open")?.[1];
  await act(async () => {
    reopen?.({
      event: "conversation-history-open",
      id: 8,
      payload: { generation: 2, persona: "all" },
    });
    save.resolve();
  });
  expect(command).not.toHaveBeenCalledWith("release_conversation_history", expect.anything());
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty("disabled", false);
  fireEvent.click(screen.getByRole("button", { name: "지난 대화 닫기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "release_conversation_history",
      expect.objectContaining({ generation: 2 }),
    ),
  );
});

it("explains why native close is blocked without destroying an open save dialog", async () => {
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) =>
    name === "get_conversation_notes" ? [] : fallback(name, args),
  );
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await screen.findByText(/첫 대화 원문/);
  fireEvent.click(screen.getByRole("button", { name: "메모에 남기기" }));
  await screen.findByRole("form", { name: "대화를 메모에 남기기" });
  const event = { preventDefault: vi.fn() };
  act(() => native.onCloseRequested.mock.calls[0][0](event));
  expect(event.preventDefault).toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveProperty(
    "textContent",
    "저장하거나 취소한 뒤 닫아 주세요.",
  );
  expect(command).not.toHaveBeenCalledWith("release_conversation_history", expect.anything());
  expect(screen.getByRole("form", { name: "대화를 메모에 남기기" })).toBeTruthy();
});

it("explains why native close is blocked by a pending draft replacement", async () => {
  const { rerender } = render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  const failedInput = { ...MESSAGE, id: "cancelled-input", role: "user", content: "원래 입력" };
  rerender(
    <ConversationHistoryWindow
      snapshot={{
        ...SNAPSHOT,
        panel: { persona: "builtin-a", mode: "history-input" },
        conversation: {
          ...FIRST_VIEW,
          messages: [failedInput],
          recovery: { messageId: failedInput.id, reason: "cancelled" },
        },
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "입력 수정" }));
  const event = { preventDefault: vi.fn() };
  act(() => native.onCloseRequested.mock.calls[0][0](event));
  expect(event.preventDefault).toHaveBeenCalled();
  expect(screen.getByRole("alert")).toHaveProperty(
    "textContent",
    "저장하거나 취소한 뒤 닫아 주세요.",
  );
  expect(command).not.toHaveBeenCalledWith("release_conversation_history", expect.anything());
  expect(screen.getByRole("dialog", { name: "작성 중인 초안을 바꿀까요?" })).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty(
    "value",
    FIRST.draft,
  );
});

it.each(["generating", "playing"] as const)(
  "explains why native close is blocked while %s and allows closing once idle",
  async (phase) => {
    const { rerender } = render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
    await screen.findByText(/첫 대화 원문/);
    rerender(
      <ConversationHistoryWindow
        snapshot={{
          ...SNAPSHOT,
          runtime: { ...SNAPSHOT.runtime, phase },
          playback:
            phase === "playing"
              ? {
                  id: "wordbook-reply",
                  persona: "builtin-a",
                  text: "아직 말하는 중이에요.",
                  expression: "평온",
                  source: "wordbook",
                  endsAt: FIRST.createdAt + 5000,
                  lineIndex: 0,
                  lineCount: 1,
                }
              : null,
        }}
      />,
    );
    const event = { preventDefault: vi.fn() };
    act(() => native.onCloseRequested.mock.calls[0][0](event));
    expect(event.preventDefault).toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveProperty(
      "textContent",
      "대답이 끝난 뒤 닫아 주세요.",
    );
    expect(command).not.toHaveBeenCalledWith("release_conversation_history", expect.anything());

    rerender(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
    fireEvent.click(screen.getByRole("button", { name: "지난 대화 닫기" }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("release_conversation_history", expect.anything()),
    );
  },
);

it("refreshes a rejected close generation and retries without losing the editor draft", async () => {
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await begin();
  const fallback = vi.mocked(command).getMockImplementation()!;
  let releases = 0;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "release_conversation_history") return ++releases > 1;
    if (name === "get_conversation_history_state") return { generation: 7, restoration: null };
    return fallback(name, args);
  });
  const event = { preventDefault: vi.fn() };
  act(() => native.onCloseRequested.mock.calls[0][0](event));
  expect(event.preventDefault).toHaveBeenCalled();
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "창 상태가 바뀌었어요. 다시 닫아 주세요.",
  );
  expect(vi.mocked(command).mock.calls.filter(([name]) => name === "get_conversation_history_state"))
    .toHaveLength(2);
  expect(command).toHaveBeenCalledWith(
    "release_conversation_history",
    expect.objectContaining({ sessionId: FIRST.id, generation: 1 }),
  );
  const input = screen.getByRole("textbox", { name: "이어서 말하기" });
  expect(input).toHaveProperty("disabled", false);
  expect(input).toHaveProperty("value", FIRST.draft);
  const content = "  다시 닫기 전에도 편집 가능\n원문 유지  ";
  fireEvent.change(input, { target: { value: content } });
  expect(input).toHaveProperty("value", content);
  fireEvent.click(screen.getByRole("button", { name: "지난 대화 닫기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "release_conversation_history",
      expect.objectContaining({ sessionId: FIRST.id, generation: 7 }),
    ),
  );
  expect(releases).toBe(2);
  expect(command).toHaveBeenCalledWith("save_conversation_draft", {
    sessionId: FIRST.id,
    draft: content,
    inputOwner: "history",
  });
  expect(screen.queryByRole("alert")).toBeNull();
});

it("retries failed navigation hydration instead of permanently trapping the window", async () => {
  vi.mocked(command).mockRejectedValueOnce(new Error("창 상태 읽기 실패"));
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await screen.findByText("창 상태 읽기 실패");
  fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
  await screen.findByText(/첫 대화 원문/);
  fireEvent.click(screen.getByRole("button", { name: "지난 대화 닫기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "release_conversation_history",
      expect.objectContaining({ generation: 1 }),
    ),
  );
});

it("restores a selected transcript even when the saved search hides it from the sidebar", async () => {
  const fallback = vi.mocked(command).getMockImplementation()!;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_conversation_history_state")
      return {
        generation: 2,
        restoration: {
          userId: FIRST.userId,
          selectedId: SECOND.id,
          filter: "all",
          query: "no-match",
          anchor: null,
          followingTail: true,
        },
      };
    if (name === "get_conversations" && args?.query) return [];
    return fallback(name, args);
  });
  render(<ConversationHistoryWindow snapshot={SNAPSHOT} />);
  await screen.findByText("다음 대화 원문");
  expect(screen.getByText("찾는 대화가 없어요.")).toBeTruthy();
  expect(screen.getByRole("textbox", { name: "이어서 말하기" })).toHaveProperty(
    "value",
    SECOND.draft,
  );
});
