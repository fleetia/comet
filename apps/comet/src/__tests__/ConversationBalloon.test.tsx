import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Balloon } from "../components/Balloon/Balloon";
import { PREVIEW_SNAPSHOT, command, isDesktop } from "../hooks/useSnapshot";
import * as s from "../components/companion.css";
import type { ConversationSession, Message, Playback, Snapshot } from "../types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(() => false),
}));
beforeEach(() => {
  document.documentElement.dataset.cometMotion = "reduced";
  vi.mocked(command).mockReset().mockResolvedValue(undefined);
  vi.mocked(isDesktop).mockReturnValue(false);
  HTMLDialogElement.prototype.showModal = function (): void {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (): void {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.cometMotion;
  vi.useRealTimers();
});

const session: ConversationSession = {
  id: "conversation-one",
  userId: "preview-user",
  participants: ["builtin-a"],
  status: "active",
  title: "오늘의 이야기",
  createdAt: 1790470000000,
  updatedAt: 1790470020000,
  draft: "",
  continuedFrom: null,
};
const seed: Message = {
  id: "seed",
  role: "assistant",
  persona: "builtin-a",
  content: "오늘은 어땠어?",
  expression: "평온",
  createdAt: 1,
  status: "complete",
};
const playback: Playback = {
  id: "line-exact",
  persona: "builtin-a",
  text: "  첫 줄\n\n다음 줄  ",
  expression: "평온",
  source: "wordbook",
  endsAt: 100,
  lineIndex: 0,
  lineCount: 1,
};
function conversationSnapshot(): Snapshot {
  return {
    ...PREVIEW_SNAPSHOT,
    panel: { persona: "builtin-a", mode: "input" },
    conversation: { session, messages: [seed], nextBefore: null },
  };
}

it("sends a scene answer with the displayed question identity and no old conversation draft", async () => {
  const { rerender } = render(<Balloon snapshot={conversationSnapshot()} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "이전 대화" } });
  rerender(<Balloon snapshot={{ ...conversationSnapshot(), conversation: null, sceneAskId: "ask-2" }} />);
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  expect(input.value).toBe("");
  fireEvent.change(input, { target: { value: "장면 답변" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(command).toHaveBeenCalledWith("send_message", {
    content: "장면 답변", target: "builtin-a", clientMessageId: expect.any(String), sceneAskId: "ask-2",
  }));
});

const interruptedInput: Message = {
  ...seed,
  id: "interrupted-input",
  role: "user",
  content: "  쉬는 동안 들을 이야기\n원문 그대로  ",
};

function recoverySnapshot(draft = ""): Snapshot {
  const snapshot = conversationSnapshot();
  return {
    ...snapshot,
    runtime: { ...snapshot.runtime, phase: "idle", error: null },
    conversation: {
      session: { ...session, draft },
      messages: [seed, interruptedInput],
      nextBefore: null,
      recovery: { messageId: interruptedInput.id, reason: "cancelled" },
    },
  };
}

it("shows an unavailable notice during focus without conversation controls and keeps closing available", async () => {
  render(
    <Balloon
      snapshot={{
        ...PREVIEW_SNAPSHOT,
        panel: { persona: "builtin-a", mode: "focus" },
        runtime: { ...PREVIEW_SNAPSHOT.runtime, phase: "generating" },
      }}
    />,
  );
  expect(screen.getByRole("region", { name: "집중 중" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe(
    "집중 시간 동안에는 대화를 사용할 수 없어요. 집중을 마친 뒤 다시 말 걸어 주세요.",
  );
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.queryByRole("button", { name: "AI 연결 설정" })).toBeNull();
  expect(screen.queryByRole("button", { name: "생성 멈추기" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "패널 닫기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("close_panel", undefined));
  vi.mocked(command).mockClear();
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(command).toHaveBeenCalledWith("close_panel", undefined));
});

it.each([
  ["움직이기", "arm_character_move"],
  ["간식 주기", "give_character_snack"],
])(
  "routes the %s menu action to the displayed character and shows command failures",
  async (label, name) => {
    vi.mocked(command).mockImplementation(async (commandName) => {
      if (commandName === name) throw new Error("교감 실행 실패");
      return [];
    });
    render(
      <Balloon snapshot={{ ...PREVIEW_SNAPSHOT, panel: { persona: "builtin-a", mode: "menu" } }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "교감" }));
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() => expect(command).toHaveBeenCalledWith(name, { persona: "builtin-a" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "교감 실행 실패");
  },
);

it("routes drink and gift to the local character with separate interaction receipts", async () => {
  for (const [label, action] of [
    ["음료 건네기", "drink"],
    ["선물 건네기", "gift"],
  ]) {
    const view = render(
      <Balloon snapshot={{ ...PREVIEW_SNAPSHOT, panel: { persona: "builtin-a", mode: "menu" } }} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "교감" }));
    fireEvent.click(screen.getByRole("button", { name: label }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith(
        "give_character_item",
        expect.objectContaining({ action }),
      ),
    );
    view.unmount();
  }
  const requests = vi.mocked(command).mock.calls.filter(([name]) => name === "give_character_item");
  expect(requests).toHaveLength(2);
  expect(requests[0]?.[1]).toEqual({
    characterId: "builtin-a",
    action: "drink",
    sessionId: expect.any(String),
  });
  expect(requests[1]?.[1]).toEqual({
    characterId: "builtin-a",
    action: "gift",
    sessionId: expect.any(String),
  });
  expect(requests[0]?.[1]?.sessionId).not.toBe(requests[1]?.[1]?.sessionId);
});

it("offers sleep or wake for the displayed local character independently", async () => {
  const snapshot: Snapshot = { ...PREVIEW_SNAPSHOT, panel: { persona: "builtin-a", mode: "menu" } };
  const { rerender } = render(<Balloon snapshot={snapshot} />);
  fireEvent.click(screen.getByRole("button", { name: "교감" }));
  fireEvent.click(screen.getByRole("button", { name: "재우기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("set_character_sleep", {
      characterId: "builtin-a",
      sleeping: true,
    }),
  );
  rerender(
    <Balloon
      key="reopened"
      snapshot={{
        ...snapshot,
        animationStates: {
          ...PREVIEW_SNAPSHOT.animationStates!,
          sleepingCharacterIds: ["builtin-b"],
        },
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "교감" }));
  expect(screen.getByRole("button", { name: "재우기" })).toBeTruthy();
  rerender(
    <Balloon
      key="reopened"
      snapshot={{
        ...snapshot,
        animationStates: {
          ...PREVIEW_SNAPSHOT.animationStates!,
          sleepingCharacterIds: ["builtin-a"],
        },
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "깨우기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("set_character_sleep", {
      characterId: "builtin-a",
      sleeping: false,
    }),
  );
});

it("opens a reply to the exact displayed line and keeps the close action separate", async () => {
  render(<Balloon snapshot={{ ...PREVIEW_SNAPSHOT, playback }} />);
  const reply = screen.getByRole("button", { name: /에게 답장:/ });
  expect(reply.textContent).toBe(playback.text);
  fireEvent.click(reply);
  expect(command).toHaveBeenCalledWith("open_reply", { playbackId: "line-exact" });
  fireEvent.click(screen.getByRole("button", { name: "이야기 닫기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("skip_talk", undefined));
});

const updatePlayback: Playback = {
  ...playback,
  id: "update-notice-one",
  source: "update",
  text: "새로운 업데이트가 있어요!",
};

it("expands an update notice before showing navigation and never starts a reply or installation", async () => {
  const snapshot = { ...PREVIEW_SNAPSHOT, panel: null, playback: updatePlayback };
  const { rerender } = render(<Balloon snapshot={snapshot} />);
  const announcement = screen.getByRole("button", { name: updatePlayback.text });
  expect(announcement.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("button", { name: "이동하기" })).toBeNull();
  fireEvent.click(announcement);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("expand_update_notice", {
      playbackId: updatePlayback.id,
    }),
  );
  await waitFor(() => expect(announcement).toHaveProperty("disabled", false));
  rerender(<Balloon snapshot={{ ...snapshot, panel: { persona: "builtin-a", mode: "update" } }} />);
  const expanded = screen.getByRole("button", { name: updatePlayback.text });
  expect(expanded.getAttribute("aria-expanded")).toBe("true");
  expect(document.getElementById(expanded.getAttribute("aria-controls")!)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "이동하기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_update_settings", {
      playbackId: updatePlayback.id,
    }),
  );
  expect(
    vi
      .mocked(command)
      .mock.calls.some(([name]) => name === "open_reply" || name === "install_app_update"),
  ).toBe(false);
});

it.each(["{Enter}", " "])("opens the update action using keyboard activation %s", async (key) => {
  const user = userEvent.setup();
  render(<Balloon snapshot={{ ...PREVIEW_SNAPSHOT, panel: null, playback: updatePlayback }} />);
  screen.getByRole("button", { name: updatePlayback.text }).focus();
  await user.keyboard(key);
  expect(command).toHaveBeenCalledWith("expand_update_notice", { playbackId: updatePlayback.id });
});

it("keeps update navigation retryable on failure and removes it when the displayed notice changes", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "open_update_settings") throw new Error("설정을 열지 못했어요.");
  });
  const snapshot: Snapshot = {
    ...PREVIEW_SNAPSHOT,
    panel: { persona: "builtin-a", mode: "update" },
    playback: updatePlayback,
  };
  const { rerender } = render(<Balloon snapshot={snapshot} />);
  fireEvent.click(screen.getByRole("button", { name: "이동하기" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("설정을 열지 못했어요."));
  expect(screen.getByRole("button", { name: "이동하기" })).toHaveProperty("disabled", false);
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(command).toHaveBeenCalledWith("close_panel", undefined));
  rerender(
    <Balloon
      snapshot={{
        ...snapshot,
        panel: null,
        playback: { ...updatePlayback, id: "update-notice-two" },
      }}
    />,
  );
  expect(screen.queryByRole("button", { name: "이동하기" })).toBeNull();
  expect(
    screen.getByRole("button", { name: updatePlayback.text }).getAttribute("aria-expanded"),
  ).toBe("false");
});

it("ignores a late navigation failure after a newer expanded update notice replaces it", async () => {
  let rejectNavigation!: (cause: Error) => void;
  vi.mocked(command).mockImplementation((name) =>
    name === "open_update_settings"
      ? new Promise<void>((_, reject) => {
          rejectNavigation = reject;
        })
      : Promise.resolve(),
  );
  const snapshot: Snapshot = {
    ...PREVIEW_SNAPSHOT,
    panel: { persona: "builtin-a", mode: "update" },
    playback: updatePlayback,
  };
  const { rerender } = render(<Balloon snapshot={snapshot} />);
  fireEvent.click(screen.getByRole("button", { name: "이동하기" }));
  await waitFor(() => expect(rejectNavigation).toBeTypeOf("function"));
  rerender(
    <Balloon
      snapshot={{ ...snapshot, playback: { ...updatePlayback, id: "newer-update-notice" } }}
    />,
  );
  await act(async () => rejectNavigation(new Error("이전 알림의 이동 실패")));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "이동하기" })).toHaveProperty("disabled", false);
});

it("retains the seed and live draft across snapshots, speaker changes, and generation", async () => {
  const snapshot = conversationSnapshot();
  const { rerender } = render(<Balloon snapshot={snapshot} />);
  expect(screen.getByText(seed.content)).toBeTruthy();
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "쓰고 있는 말" } });
  rerender(
    <Balloon
      snapshot={{
        ...snapshot,
        panel: { persona: "builtin-b", mode: "input" },
        runtime: { ...snapshot.runtime, phase: "generating" },
        conversation: { ...snapshot.conversation!, session: { ...session, draft: "오래된 초안" } },
      }}
    />,
  );
  expect(input.value).toBe("쓰고 있는 말");
  expect(input.disabled).toBe(false);
  expect(screen.getByRole("combobox")).toHaveProperty("value", "builtin-a");
  expect(screen.getByRole("button", { name: "보내기" })).toHaveProperty("disabled", true);
  rerender(<Balloon snapshot={{ ...snapshot, playback }} />);
  expect(input.value).toBe("쓰고 있는 말");
  expect(
    screen.getByLabelText(playback.text, { normalizer: (value) => value }).textContent,
  ).toContain(playback.text);
  expect(screen.getByRole("button", { name: "보내기" })).toHaveProperty("disabled", true);
});

it("reveals a registered input reply while a waiting story is retained behind the editor", () => {
  vi.useFakeTimers();
  render(
    <Balloon
      snapshot={{
        ...conversationSnapshot(),
        playback: { ...playback, textSpeed: 1000 },
        story: {
          id: "waiting-story",
          persona: "builtin-a",
          title: "다음 이야기",
          prompt: "이야기를 이어갈까?",
          choices: [{ id: "continue", label: "계속" }],
          displayStartedAt: 1,
        },
      }}
    />,
  );
  expect(screen.queryByRole("group", { name: "이야기 선택지" })).toBeNull();
  const text = screen.getByText(playback.text, { normalizer: (value) => value });
  expect(text.style.visibility).toBe("hidden");
  act(() => vi.advanceTimersByTime(1000));
  expect(text.style.visibility).toBe("");
});

it("saves the draft when focus closes the input before autosave and retains it on resume", async () => {
  const snapshot = conversationSnapshot();
  const { rerender } = render(<Balloon snapshot={snapshot} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "  집중 전에 쓰던 말\n" } });
  expect(command).not.toHaveBeenCalledWith("save_conversation_draft", expect.anything());
  rerender(<Balloon snapshot={{ ...snapshot, panel: null, conversation: null }} />);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_conversation_draft", {
      inputOwner: "desktop",
      sessionId: session.id,
      draft: "  집중 전에 쓰던 말\n",
    }),
  );
  rerender(<Balloon snapshot={snapshot} />);
  expect(screen.getByRole("textbox")).toHaveProperty("value", "  집중 전에 쓰던 말\n");
});

it("saves pending text on unmount without writing a prior user's draft after identity changes", async () => {
  const snapshot = conversationSnapshot();
  const first = render(<Balloon snapshot={snapshot} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "창이 닫혀도 남을 말" } });
  first.unmount();
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_conversation_draft", {
      inputOwner: "desktop",
      sessionId: session.id,
      draft: "창이 닫혀도 남을 말",
    }),
  );
  vi.mocked(command).mockClear();
  const second = render(<Balloon snapshot={snapshot} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "이전 사용자의 초안" } });
  second.rerender(
    <Balloon
      snapshot={{
        ...snapshot,
        user: { ...snapshot.user!, id: "another-user" },
        panel: null,
        conversation: null,
      }}
    />,
  );
  await act(async () => {});
  expect(command).not.toHaveBeenCalledWith("save_conversation_draft", expect.anything());
});

it("does not erase text entered while the previous submission is pending", async () => {
  let finish!: () => void;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "send_message")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
  });
  render(<Balloon snapshot={conversationSnapshot()} />);
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  fireEvent.change(input, { target: { value: "첫 번째 말" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("send_message", {
      content: "첫 번째 말",
      target: "builtin-a",
      clientMessageId: expect.any(String),
      sessionId: session.id,
    }),
  );
  fireEvent.change(input, { target: { value: "그 다음에 쓴 말" } });
  await act(async () => finish());
  expect(input.value).toBe("그 다음에 쓴 말");
  expect(command).toHaveBeenCalledWith("save_conversation_draft", {
    inputOwner: "desktop",
    sessionId: session.id,
    draft: "그 다음에 쓴 말",
  });
});

it("flushes a draft before pausing and uses a separate explicit finish command", async () => {
  let finishSave!: () => void;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "save_conversation_draft")
      await new Promise<void>((resolve) => {
        finishSave = resolve;
      });
  });
  const view = render(<Balloon snapshot={conversationSnapshot()} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "  남겨 둔 말\n" } });
  fireEvent.click(screen.getByRole("button", { name: "대화 접어 두기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_conversation_draft", {
      inputOwner: "desktop",
      sessionId: session.id,
      draft: "  남겨 둔 말\n",
    }),
  );
  expect(command).not.toHaveBeenCalledWith("close_panel", { sessionId: session.id });
  await act(async () => finishSave());
  expect(command).toHaveBeenLastCalledWith("close_panel", { sessionId: session.id });
  expect(command).not.toHaveBeenCalledWith("finish_conversation", expect.anything());
  view.unmount();
  vi.mocked(command).mockResolvedValue(undefined);
  render(<Balloon snapshot={conversationSnapshot()} />);
  fireEvent.click(screen.getByRole("button", { name: "대화 끝내기" }));
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("finish_conversation", { sessionId: session.id }),
  );
});

it("keeps this conversation's log collapsed and loads older pages inside it", async () => {
  vi.mocked(command).mockResolvedValue({
    messages: [{ ...seed, id: "earlier", content: "앞선 기록" }],
    nextBefore: null,
    characterNames: { earlier: "그때의 이름" },
  });
  render(
    <Balloon
      snapshot={{
        ...conversationSnapshot(),
        conversation: {
          session,
          messages: [{ ...seed, id: "user", role: "user", content: "이번 대화에만 있는 말" }, seed],
          nextBefore: 42,
        },
        messages: [{ ...seed, id: "unrelated", content: "다른 대화의 기록" }],
      }}
    />,
  );
  expect(screen.queryByText("이번 대화에만 있는 말")).toBeNull();
  const details = screen.getByText("이번 대화").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  expect(await screen.findByText("이번 대화에만 있는 말")).toBeTruthy();
  expect(screen.queryByText("다른 대화의 기록")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "앞선 내용 더 보기" }));
  expect(await screen.findByText("앞선 기록")).toBeTruthy();
  expect(screen.getByText("그때의 이름")).toBeTruthy();
  expect(command).toHaveBeenCalledWith("get_conversation_messages", {
    sessionId: session.id,
    before: 42,
  });
});

it("does not close a new conversation when an older view's draft save completes", async () => {
  let finishSave!: () => void;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "save_conversation_draft")
      await new Promise<void>((resolve) => {
        finishSave = resolve;
      });
  });
  const snapshot = conversationSnapshot();
  const { rerender } = render(<Balloon snapshot={snapshot} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "이전 초안" } });
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_conversation_draft", {
      inputOwner: "desktop",
      sessionId: session.id,
      draft: "이전 초안",
    }),
  );
  rerender(
    <Balloon
      snapshot={{
        ...snapshot,
        conversation: {
          session: { ...session, id: "next", draft: "새 초안" },
          messages: [],
          nextBefore: null,
        },
      }}
    />,
  );
  await act(async () => finishSave());
  expect(vi.mocked(command).mock.calls.some(([name]) => name === "close_panel")).toBe(false);
  expect(screen.getByRole("textbox")).toHaveProperty("value", "새 초안");
});

it("keeps the visible guest recipient while sending through its reopened resident-owned session", async () => {
  const guest = {
    ...PREVIEW_SNAPSHOT.characters.installed[1],
    id: "guest-character",
    definition: {
      ...PREVIEW_SNAPSHOT.characters.installed[1].definition,
      name: "방문자",
      presenceRole: "npc" as const,
    },
  };
  const snapshot: Snapshot = {
    ...conversationSnapshot(),
    runtime: { ...PREVIEW_SNAPSHOT.runtime, guestCharacterIds: [guest.id] },
    characters: {
      installed: [...PREVIEW_SNAPSHOT.characters.installed, guest],
      active: ["builtin-a"],
    },
    panel: { persona: guest.id, mode: "menu" },
    conversation: null,
  };
  vi.mocked(isDesktop).mockReturnValue(true);
  const view = render(<Balloon snapshot={snapshot} />);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("get_conversations", { persona: guest.id }),
  );
  expect(screen.queryByRole("alert")).toBeNull();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "말 걸기" })).toHaveProperty("disabled", false),
  );
  fireEvent.click(screen.getByRole("button", { name: "말 걸기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_panel", { persona: guest.id, mode: "input" }),
  );
  const reopened = { ...session, id: "reopened-resident-session" };
  view.rerender(
    <Balloon
      snapshot={{
        ...snapshot,
        panel: { persona: guest.id, mode: "input" },
        conversation: { session: reopened, messages: [], nextBefore: null },
      }}
    />,
  );
  expect(screen.getByRole("combobox")).toHaveProperty("value", guest.id);
  const input = screen.getByRole("textbox", { name: "방문자에게 할 말" });
  fireEvent.change(input, { target: { value: "좋아" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("send_message", {
      content: "좋아",
      target: guest.id,
      clientMessageId: expect.any(String),
      sessionId: reopened.id,
    }),
  );
  expect(screen.getByRole("button", { name: "대화 끝내기" })).toBeTruthy();
});

it("offers the paused conversation in the menu and a linked continuation from ended history", async () => {
  vi.mocked(isDesktop).mockReturnValue(true);
  const ended = { ...session, id: "ended", title: "마친 이야기", status: "ended" as const };
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_conversations") return [{ ...session, status: "paused" }, ended];
    if (name === "get_conversation_messages") return { messages: [seed], nextBefore: null };
  });
  const { rerender } = render(
    <Balloon snapshot={{ ...PREVIEW_SNAPSHOT, panel: { persona: "builtin-a", mode: "menu" } }} />,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "이어서 하기" })).toHaveProperty("disabled", false),
  );
  fireEvent.click(screen.getByRole("button", { name: "이어서 하기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("resume_chat", { sessionId: session.id }),
  );
  rerender(
    <Balloon
      snapshot={{ ...PREVIEW_SNAPSHOT, panel: { persona: "builtin-a", mode: "history" } }}
    />,
  );
  fireEvent.click(await screen.findByRole("button", { name: /마친 이야기/ }));
  expect(await screen.findByText(seed.content)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "이어서 말하기" }));
  expect(command).toHaveBeenCalledWith("resume_chat", { sessionId: ended.id });
});

it("pauses only after idle time with no draft, open log, or active reply", async () => {
  vi.useFakeTimers();
  const snapshot = conversationSnapshot();
  const { rerender } = render(<Balloon snapshot={snapshot} />);
  await act(async () => {
    vi.advanceTimersByTime(89_000);
  });
  expect(command).not.toHaveBeenCalledWith("close_panel", { sessionId: session.id, idle: true });
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "작성 중" } });
  await act(async () => {
    vi.advanceTimersByTime(100_000);
  });
  expect(command).not.toHaveBeenCalledWith("close_panel", { sessionId: session.id, idle: true });
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
  rerender(
    <Balloon snapshot={{ ...snapshot, runtime: { ...snapshot.runtime, phase: "generating" } }} />,
  );
  await act(async () => {
    vi.advanceTimersByTime(100_000);
  });
  expect(command).not.toHaveBeenCalledWith("close_panel", { sessionId: session.id, idle: true });
  rerender(<Balloon snapshot={snapshot} />);
  await act(async () => {
    vi.advanceTimersByTime(90_000);
  });
  expect(command).toHaveBeenCalledWith("close_panel", { sessionId: session.id, idle: true });
});

it.each(["one failing test. one small fix.", "same hero new line. surprise me with a scene."])(
  "surfaces a failed follow-up before the retained reply: %s",
  async (previousReply) => {
    const failure = "이 기기의 모델을 아직 내려받지 않았어요.";
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    vi.mocked(command).mockImplementation(async (name) => {
      if (name === "send_message") throw new Error(failure);
    });
    try {
      const snapshot = conversationSnapshot();
      render(
        <Balloon
          snapshot={{
            ...snapshot,
            conversation: {
              ...snapshot.conversation!,
              messages: [
                { ...seed, id: "earlier-input", role: "user", content: "앞선 질문" },
                { ...seed, content: previousReply },
              ],
            },
          }}
        />,
      );
      const input = screen.getByRole("textbox") as HTMLTextAreaElement;
      const draftText = "  tell me something new\n";
      fireEvent.change(input, { target: { value: draftText } });
      fireEvent.keyDown(input, { key: "Enter" });
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).toBe(failure);
      const reply = screen.getByText(previousReply);
      expect(alert.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByText(/^이전 답변 · /)).toBeTruthy();
      expect(screen.getByText("이번 입력 · 답변을 받지 못했어요")).toBeTruthy();
      expect(screen.queryByText("이번 입력 · 답변을 마치지 못했어요")).toBeNull();
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
      expect(input.value).toBe(draftText);
      expect(document.activeElement).toBe(input);
      expect(screen.getByRole("button", { name: "보내기" })).toHaveProperty("disabled", false);
      expect(command).toHaveBeenCalledWith("save_conversation_draft", {
        inputOwner: "desktop",
        sessionId: session.id,
        draft: draftText,
      });
      expect(command).not.toHaveBeenCalledWith("save_conversation_draft", {
        inputOwner: "desktop",
        sessionId: session.id,
        draft: "",
      });
      // Repeating the same failed request must reveal the same feedback again.
      scrollIntoView.mockClear();
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" }));
      expect(input.value).toBe(draftText);
      expect(screen.getAllByRole("alert")).toHaveLength(1);
    } finally {
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  },
);

it("shows runtime failure and retry before the previous response, and clears the label on recovery", () => {
  const snapshot = conversationSnapshot();
  const failed: Snapshot = {
    ...snapshot,
    runtime: { ...snapshot.runtime, phase: "error" as const, error: "답변 생성 실패" },
    conversation: {
      ...snapshot.conversation!,
      messages: [seed, { ...seed, id: "new-question", role: "user", content: "다음 이야기" }],
      recovery: { messageId: "new-question", reason: "incomplete" },
    },
  };
  const { rerender } = render(<Balloon snapshot={failed} />);
  const reply = screen.getByText(seed.content);
  for (const feedback of [
    screen.getByRole("alert"),
    screen.getByRole("button", { name: "다시 이야기하기" }),
  ]) {
    expect(feedback.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  }
  expect(screen.getByText(/^이전 답변 · /)).toBeTruthy();
  expect(screen.getByText("이번 입력 · 답변을 받지 못했어요")).toBeTruthy();
  rerender(<Balloon snapshot={{ ...snapshot, playback }} />);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText(/^이전 답변 · /)).toBeNull();
  expect(screen.getByLabelText(playback.text, { normalizer: (value) => value })).toBeTruthy();
});

it.each([null, "답변 생성 실패"])(
  "focuses the editor without scrolling a reopened failure out of view: %s",
  (error) => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    try {
      const snapshot = conversationSnapshot();
      render(
        <Balloon
          snapshot={{
            ...snapshot,
            runtime: { ...snapshot.runtime, phase: error ? "error" : "idle", error },
            conversation: {
              ...snapshot.conversation!,
              messages: [seed, { ...seed, id: "input", role: "user", content: "다음 이야기" }],
              recovery: error ? { messageId: "input", reason: "incomplete" } : undefined,
            },
          }}
        />,
      );
      expect(focus).toHaveBeenCalledWith({ preventScroll: Boolean(error) });
      expect(document.activeElement).toBe(screen.getByRole("textbox"));
      if (error) expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" });
    } finally {
      focus.mockRestore();
      delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  },
);

it("keeps the expanded log, retained reply and editor in a scrolling input body below the header", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "send_message") throw new Error("이 기기의 모델을 아직 내려받지 않았어요.");
  });
  render(<Balloon snapshot={conversationSnapshot()} />);
  const viewport = screen.getByRole("region", { name: "대화 내용과 입력" });
  expect(viewport.classList.contains(s.inputContents)).toBe(true);
  const balloon = viewport.parentElement!;
  const header = balloon.querySelector("header")!;
  expect(header.parentElement).toBe(balloon);
  expect(viewport.contains(header)).toBe(false);
  const details = screen.getByText("이번 대화").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  await waitFor(() => expect(screen.getAllByText(seed.content)).toHaveLength(2));
  const input = screen.getByRole("textbox");
  const draftText = "  qa model-free failure\n";
  fireEvent.change(input, { target: { value: draftText } });
  fireEvent.keyDown(input, { key: "Enter" });
  const alert = await screen.findByRole("alert");
  const reply = screen.getByText(/^이전 답변 · /).parentElement!;
  // These regions must be block-flow children of the same scroll viewport, not
  // flex siblings competing with the expanded log and the non-shrinking editor.
  expect(alert.parentElement!.parentElement).toBe(viewport);
  expect(reply.parentElement).toBe(viewport);
  expect(reply.textContent).toContain(seed.content);
  expect(details.parentElement).toBe(viewport);
  expect(input.closest("form")!.parentElement).toBe(viewport);
  expect(details.open).toBe(true);
  expect(input).toHaveProperty("value", draftText);
  expect(document.activeElement).toBe(input);
  details.open = false;
  fireEvent(details, new Event("toggle"));
  await waitFor(() => expect(screen.getAllByText(seed.content)).toHaveLength(1));
  expect(reply.textContent).toContain(seed.content);
  expect(input).toHaveProperty("value", draftText);
});

it("reveals identical runtime errors again for sends and retries, without resetting manual scrolling on snapshot churn", async () => {
  const failure = "이 기기의 모델을 아직 내려받지 않았어요.";
  const scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "send_message" || name === "retry_turn") throw new Error(failure);
  });
  try {
    const base = conversationSnapshot();
    const snapshot: Snapshot = {
      ...base,
      runtime: { ...base.runtime, phase: "error", error: failure },
      conversation: {
        ...base.conversation!,
        messages: [seed, { ...seed, id: "failed-input", role: "user", content: "이번 요청" }],
        recovery: { messageId: "failed-input", reason: "incomplete" },
      },
    };
    const { rerender } = render(<Balloon snapshot={snapshot} />);
    const input = screen.getByRole("textbox");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      scrollIntoView.mockClear();
      fireEvent.keyDown(input, { key: "Enter" });
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" }));
      expect(input).toHaveProperty("value", "이번 요청");
    }
    for (let attempt = 0; attempt < 2; attempt += 1) {
      scrollIntoView.mockClear();
      fireEvent.click(screen.getByRole("button", { name: "다시 이야기하기" }));
      await waitFor(() => expect(scrollIntoView).toHaveBeenCalledWith({ block: "nearest" }));
      expect(command).toHaveBeenCalledWith("retry_turn", {
        messageId: "failed-input",
        target: "builtin-a",
      });
    }
    scrollIntoView.mockClear();
    rerender(<Balloon snapshot={{ ...snapshot, modelReady: true }} />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  } finally {
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  }
});

it("does not carry a failed submission's local feedback into another conversation", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "send_message") throw new Error("이전 대화 전송 실패");
  });
  const snapshot = conversationSnapshot();
  const { rerender } = render(<Balloon snapshot={snapshot} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "첫 대화의 입력" } });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(await screen.findByRole("alert")).toBeTruthy();
  rerender(
    <Balloon
      snapshot={{
        ...snapshot,
        conversation: {
          session: { ...session, id: "next", draft: "새 대화의 초안" },
          messages: [],
          nextBefore: null,
        },
      }}
    />,
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("textbox")).toHaveProperty("value", "새 대화의 초안");
});

it("shows model availability before sending and still routes registered replies without a model", async () => {
  render(<Balloon snapshot={conversationSnapshot()} />);
  expect(screen.getByLabelText("대화 가능 상태").textContent).toContain(
    "AI 자유 대화 · 모델 준비 필요",
  );

  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "등록된 키워드" } });
  expect(screen.getByRole("button", { name: "보내기" })).toHaveProperty("disabled", false);
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "send_message",
      expect.objectContaining({ content: "등록된 키워드" }),
    ),
  );
  expect(vi.mocked(command).mock.calls.some(([name]) => name.includes("download"))).toBe(false);
});

it("saves the exact draft before opening AI settings without starting a download", async () => {
  render(<Balloon snapshot={conversationSnapshot()} />);
  const value = "  설정 뒤 이어 쓸 말\n";
  fireEvent.change(screen.getByRole("textbox"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "AI 연결 설정" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("open_settings"));
  expect(vi.mocked(command).mock.calls.map(([name]) => name)).toEqual([
    "save_conversation_draft",
    "set_settings_section",
    "open_settings",
  ]);
  expect(command).toHaveBeenCalledWith("set_settings_section", { section: "model" });
  expect(screen.getByRole("textbox")).toHaveProperty("value", value);
});

it("uses the same unified send route for the button and Enter", async () => {
  render(<Balloon snapshot={{ ...conversationSnapshot(), modelReady: true }} />);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "lighthouse가 포함된 긴 질문에 답해 줘" } });
  expect(screen.queryByRole("button", { name: "AI에게 묻기" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
  await waitFor(() => expect(input).toHaveProperty("value", ""));
  expect(command).toHaveBeenCalledWith("send_message", {
    content: "lighthouse가 포함된 긴 질문에 답해 줘",
    target: "builtin-a",
    clientMessageId: expect.any(String),
    sessionId: session.id,
  });
  fireEvent.change(input, { target: { value: "lighthouse" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(input).toHaveProperty("value", ""));
  const sends = vi.mocked(command).mock.calls.filter(([name]) => name === "send_message");
  expect(sends).toHaveLength(2);
  for (const [, args] of sends) {
    expect(args).not.toHaveProperty("aiOnly");
  }
});

it("keeps ordinary sending available while AI needs setup", () => {
  render(<Balloon snapshot={conversationSnapshot()} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "등록된 키워드" } });
  expect(screen.queryByRole("button", { name: "AI에게 묻기" })).toBeNull();
  expect(screen.getByRole("button", { name: "보내기" })).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: "AI 연결 설정" })).toBeTruthy();
});

it("does not double-send or erase a newer draft", async () => {
  let finish!: () => void;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "send_message")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
  });
  render(<Balloon snapshot={{ ...conversationSnapshot(), modelReady: true }} />);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "첫 AI 질문" } });
  const ask = screen.getByRole("button", { name: "보내기" });
  fireEvent.click(ask);
  fireEvent.click(ask);
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(command).toHaveBeenCalledWith("send_message", expect.anything()));
  expect(vi.mocked(command).mock.calls.filter(([name]) => name === "send_message")).toHaveLength(1);
  expect(ask).toHaveProperty("disabled", true);
  fireEvent.change(input, { target: { value: "새로 쓰는 초안" } });
  await act(async () => finish());
  expect(input).toHaveProperty("value", "새로 쓰는 초안");
});

it("retains the input when unified submission fails", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "send_message") throw new Error("모델 실행 실패");
  });
  render(<Balloon snapshot={{ ...conversationSnapshot(), modelReady: true }} />);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "  lighthouse가 포함된 질문\n" } });
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "모델 실행 실패");
  expect(input).toHaveProperty("value", "  lighthouse가 포함된 질문\n");
  expect(screen.getByRole("button", { name: "보내기" })).toHaveProperty("disabled", false);
});

it("keeps an authored reply's recorded origin after model readiness changes", () => {
  const snapshot = conversationSnapshot();
  const view = {
    ...snapshot,
    conversation: { ...snapshot.conversation!, messageSources: { [seed.id]: "wordbook" } },
  };
  const { rerender } = render(<Balloon snapshot={view} />);
  expect(screen.getByText("등록 대사 · 단어장")).toBeTruthy();
  rerender(<Balloon snapshot={{ ...view, modelReady: true }} />);
  expect(screen.getByText("등록 대사 · 단어장")).toBeTruthy();
  expect(screen.getByText("AI 자유 대화 · 이 기기의 모델 준비됨")).toBeTruthy();
  expect(screen.queryByText("AI 생성")).toBeNull();
  rerender(<Balloon snapshot={{ ...snapshot, modelReady: true }} />);
  expect(screen.getByText("출처 미확인")).toBeTruthy();
  expect(screen.queryByText("AI 생성")).toBeNull();
});

it("restores an accepted input after async failure without replacing newer text", async () => {
  const snapshot = conversationSnapshot();
  const { rerender } = render(<Balloon snapshot={snapshot} />);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "  이번 요청\n" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(input).toHaveProperty("value", ""));
  const id = vi.mocked(command).mock.calls.find(([name]) => name === "send_message")![1]!
    .clientMessageId as string;
  const latestInput = { ...seed, id, role: "user", content: "이번 요청" };
  const generating = {
    ...snapshot,
    runtime: { ...snapshot.runtime, phase: "generating" as const },
    conversation: { ...snapshot.conversation!, messages: [seed, latestInput] },
  };
  rerender(<Balloon snapshot={generating} />);
  const failed: Snapshot = {
    ...generating,
    runtime: { ...snapshot.runtime, phase: "error" as const, error: "모델 실행 실패" },
    conversation: {
      ...generating.conversation,
      recovery: { messageId: id, reason: "incomplete" },
    },
  };
  rerender(<Balloon snapshot={failed} />);
  expect(input).toHaveProperty("value", "  이번 요청\n");
  expect(screen.getByLabelText("답변에 실패한 이번 입력").textContent).toContain("이번 요청");
  expect(screen.getByText(/^이전 답변 · /)).toBeTruthy();
  fireEvent.change(input, { target: { value: "다시 쓰고 있는 말" } });
  rerender(<Balloon snapshot={generating} />);
  rerender(<Balloon snapshot={failed} />);
  expect(input).toHaveProperty("value", "다시 쓰고 있는 말");
});

it("does not describe a partial current-turn reply as a previous answer", () => {
  const snapshot = conversationSnapshot();
  render(
    <Balloon
      snapshot={{
        ...snapshot,
        runtime: { ...snapshot.runtime, phase: "error", error: "다른 친구의 답변 실패" },
        conversation: {
          ...snapshot.conversation!,
          messages: [
            seed,
            { ...seed, id: "input", role: "user", content: "모두에게 할 말" },
            { ...seed, id: "partial", content: "이번 요청의 첫 답변" },
          ],
          messageSources: { partial: "llm" },
          recovery: { messageId: "input", reason: "incomplete" },
        },
      }}
    />,
  );
  expect(screen.getByText("이번 요청의 첫 답변")).toBeTruthy();
  expect(screen.getByText("AI 생성")).toBeTruthy();
  expect(screen.queryByText(/^이전 답변 · /)).toBeNull();
  expect(screen.getByText("이번 입력 · 답변을 마치지 못했어요")).toBeTruthy();
  expect(screen.queryByText("이번 입력 · 답변을 받지 못했어요")).toBeNull();
});

it("does not call an empty current-turn response a partial answer", () => {
  const snapshot = conversationSnapshot();
  render(
    <Balloon
      snapshot={{
        ...snapshot,
        runtime: { ...snapshot.runtime, phase: "error", error: "답변 생성 실패" },
        conversation: {
          ...snapshot.conversation!,
          messages: [
            seed,
            { ...seed, id: "input", role: "user", content: "다음 이야기" },
            { ...seed, id: "empty", content: "" },
          ],
          recovery: { messageId: "input", reason: "incomplete" },
        },
      }}
    />,
  );
  expect(screen.getByText("이번 입력 · 답변을 받지 못했어요")).toBeTruthy();
  expect(screen.queryByText("이번 입력 · 답변을 마치지 못했어요")).toBeNull();
});

it("preserves origin metadata when loading older conversation pages", async () => {
  vi.mocked(command).mockResolvedValue({
    messages: [{ ...seed, id: "earlier-authored", content: "  앞선 등록 원문\n\n " }],
    nextBefore: null,
    messageSources: { "earlier-authored": "wordbook" },
  });
  const snapshot = conversationSnapshot();
  render(
    <Balloon
      snapshot={{
        ...snapshot,
        conversation: {
          ...snapshot.conversation!,
          nextBefore: 42,
          messageSources: { seed: "llm" },
        },
      }}
    />,
  );
  const details = screen.getByText("이번 대화").closest("details")!;
  details.open = true;
  fireEvent(details, new Event("toggle"));
  fireEvent.click(await screen.findByRole("button", { name: "앞선 내용 더 보기" }));
  expect(await screen.findByText("등록 대사 · 단어장")).toBeTruthy();
  expect(screen.getAllByText("AI 생성")).toHaveLength(2);
  expect(screen.getByText("앞선 등록 원문").textContent).toContain("  앞선 등록 원문\n\n ");
});

it.each(["보내기", "AI 연결 설정"])(
  "does not continue %s after another view replaces the saved draft",
  async (action) => {
    let finishSave!: () => void;
    vi.mocked(command).mockImplementation(async (name) => {
      if (name === "save_conversation_draft")
        await new Promise<void>((resolve) => {
          finishSave = resolve;
        });
    });
    const snapshot = conversationSnapshot();
    const { rerender } = render(<Balloon snapshot={snapshot} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "이전 대화 초안" } });
    fireEvent.click(screen.getByRole("button", { name: action }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("save_conversation_draft", expect.anything()),
    );
    rerender(
      <Balloon
        snapshot={{
          ...snapshot,
          conversation: {
            session: { ...session, id: "different", draft: "새 초안" },
            messages: [],
            nextBefore: null,
          },
        }}
      />,
    );
    await act(async () => finishSave());
    expect(vi.mocked(command).mock.calls.map(([name]) => name)).toEqual([
      "save_conversation_draft",
    ]);
    expect(screen.getByRole("textbox")).toHaveProperty("value", "새 초안");
  },
);

it.each(["", "새로 작성한 초안\n보존"])(
  "rehydrates retry with the saved input ID without resending or overwriting a newer draft: %s",
  async (draft) => {
    const snapshot = conversationSnapshot();
    const failedInput = {
      ...seed,
      id: "failed-before-restart",
      role: "user",
      content: "lighthouse failed",
    };
    const recovered: Snapshot = {
      ...snapshot,
      runtime: {
        ...snapshot.runtime,
        phase: "error" as const,
        error: "마지막 답변을 마치지 못했어요. 다시 이야기하기로 이어갈 수 있어요.",
      },
      conversation: {
        ...snapshot.conversation!,
        session: { ...session, draft },
        messages: [seed, failedInput],
        recovery: { messageId: failedInput.id, reason: "incomplete" },
      },
    };
    const { rerender } = render(<Balloon snapshot={recovered} />);
    expect(screen.getByRole("alert").textContent).toContain("마지막 답변을 마치지 못했어요");
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(input.value).toBe(draft || failedInput.content);
    expect(screen.getByLabelText("답변에 실패한 이번 입력").textContent).toContain(
      failedInput.content,
    );
    expect(command).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "다시 이야기하기" }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("retry_turn", {
        messageId: failedInput.id,
        target: failedInput.persona,
      }),
    );
    expect(vi.mocked(command).mock.calls.filter(([name]) => name === "send_message")).toHaveLength(
      0,
    );
    rerender(
      <Balloon
        snapshot={{
          ...recovered,
          runtime: { ...snapshot.runtime, phase: "generating", error: null },
        }}
      />,
    );
    expect(screen.queryByRole("button", { name: "다시 이야기하기" })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(input.value).toBe(draft || failedInput.content);
  },
);

it("cancels only the displayed request and offers explicit recovery from cancelled idle", async () => {
  const snapshot = recoverySnapshot("새로 쓰던 초안");
  const activeRequest = { epoch: 42, sessionId: session.id, messageId: interruptedInput.id };
  const view = render(
    <Balloon
      snapshot={{
        ...snapshot,
        activeRequest,
        runtime: { ...snapshot.runtime, phase: "generating" },
        conversation: { ...snapshot.conversation!, recovery: undefined },
      }}
    />,
  );
  const cancel = screen.getByRole("button", { name: "생성 멈추기" });
  fireEvent.click(cancel);
  fireEvent.click(cancel);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("cancel_generation", { request: activeRequest }),
  );
  view.rerender(<Balloon snapshot={snapshot} />);
  expect(
    vi.mocked(command).mock.calls.filter(([name]) => name === "cancel_generation"),
  ).toHaveLength(1);
  expect(screen.getByText("생성을 멈췄어요.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "다시 이야기하기" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "입력 수정" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "AI 연결 확인" })).toBeTruthy();
  expect(screen.getByRole("textbox")).toHaveProperty("value", "새로 쓰던 초안");
  expect(command).not.toHaveBeenCalledWith("retry_turn", expect.anything());
});

it("requires the latest input's recovery marker in an idle input view", () => {
  const snapshot = recoverySnapshot();
  const conversation = snapshot.conversation!;
  const view = render(<Balloon snapshot={snapshot} />);
  expect(screen.getByRole("button", { name: "다시 이야기하기" })).toBeTruthy();
  const unavailable: Snapshot[] = [
    { ...snapshot, conversation: { ...conversation, recovery: undefined } },
    {
      ...snapshot,
      runtime: { ...snapshot.runtime, phase: "error", error: "복구 대상 없는 오류" },
      conversation: { ...conversation, recovery: undefined },
    },
    {
      ...snapshot,
      conversation: {
        ...conversation,
        messages: [...conversation.messages, { ...interruptedInput, id: "newer-input" }],
      },
    },
    { ...snapshot, runtime: { ...snapshot.runtime, phase: "loading" } },
    { ...snapshot, playback },
    { ...snapshot, panel: null },
  ];
  for (const next of unavailable) {
    view.rerender(<Balloon snapshot={next} />);
    expect(screen.queryByRole("button", { name: "다시 이야기하기" })).toBeNull();
    expect(screen.queryByRole("button", { name: "입력 수정" })).toBeNull();
    expect(screen.queryByRole("button", { name: "AI 연결 확인" })).toBeNull();
  }
  expect(command).not.toHaveBeenCalledWith("retry_turn", expect.anything());
});

it("retries a cancelled input once while keeping the newer draft and saved input untouched", async () => {
  let finish: (() => void) | undefined;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "retry_turn") {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    }
  });
  const snapshot = recoverySnapshot("  새로 작성한 초안\n보존  ");
  const original = structuredClone(snapshot.conversation);
  render(<Balloon snapshot={snapshot} />);
  const retry = screen.getByRole("button", { name: "다시 이야기하기" });
  fireEvent.click(retry);
  fireEvent.click(retry);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("retry_turn", {
      messageId: interruptedInput.id,
      target: interruptedInput.persona,
    }),
  );
  expect(vi.mocked(command).mock.calls.filter(([name]) => name === "retry_turn")).toHaveLength(1);
  expect(command).not.toHaveBeenCalledWith("send_message", expect.anything());
  expect(screen.getByRole("textbox")).toHaveProperty("value", original?.session.draft);
  await act(async () => finish?.());
  expect(screen.getByRole("textbox")).toHaveProperty("value", original?.session.draft);
  expect(snapshot.conversation).toEqual(original);
});

it("does not retry a superseded input after its pending draft save completes", async () => {
  let finish: (() => void) | undefined;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "save_conversation_draft") {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    }
  });
  const snapshot = recoverySnapshot();
  const view = render(<Balloon snapshot={snapshot} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "새로 적는 초안" } });
  fireEvent.click(screen.getByRole("button", { name: "다시 이야기하기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_conversation_draft", {
      inputOwner: "desktop",
      sessionId: session.id,
      draft: "새로 적는 초안",
    }),
  );
  view.rerender(
    <Balloon
      snapshot={{
        ...snapshot,
        conversation: {
          ...snapshot.conversation!,
          messages: [seed, { ...interruptedInput, id: "superseding-input" }],
          recovery: undefined,
        },
      }}
    />,
  );
  await act(async () => finish?.());
  expect(command).not.toHaveBeenCalledWith("retry_turn", expect.anything());
  expect(screen.getByRole("textbox")).toHaveProperty("value", "새로 적는 초안");
});

it("does not attach an old draft-save failure to a superseding recovery in the same conversation", async () => {
  let rejectSave: ((reason: Error) => void) | undefined;
  const save = vi
    .fn()
    .mockResolvedValue(undefined)
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "save_conversation_draft") {
      await save();
    }
  });
  const snapshot = recoverySnapshot();
  const view = render(<Balloon snapshot={snapshot} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "새로 적는 초안" } });
  fireEvent.click(screen.getByRole("button", { name: "다시 이야기하기" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  view.rerender(
    <Balloon
      snapshot={{
        ...snapshot,
        conversation: {
          ...snapshot.conversation!,
          messages: [seed, { ...interruptedInput, id: "superseding-input", content: "새 요청" }],
          recovery: { messageId: "superseding-input", reason: "cancelled" },
        },
      }}
    />,
  );
  await act(async () => rejectSave?.(new Error("오래된 초안 저장 실패")));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("textbox")).toHaveProperty("value", "새로 적는 초안");
  expect(screen.getByRole("button", { name: "다시 이야기하기" })).toHaveProperty("disabled", false);
  expect(command).not.toHaveBeenCalledWith("retry_turn", expect.anything());
});

it.each(["", interruptedInput.content])(
  "edits an interrupted input directly when no different draft needs replacing: %s",
  async (draft) => {
    render(<Balloon snapshot={recoverySnapshot(draft)} />);
    fireEvent.click(screen.getByRole("button", { name: "입력 수정" }));
    const input = screen.getByRole("textbox");
    expect(input).toHaveProperty("value", interruptedInput.content);
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(command).not.toHaveBeenCalledWith("send_message", expect.anything());
    expect(command).not.toHaveBeenCalledWith("retry_turn", expect.anything());
  },
);

it("replaces a different draft with the exact interrupted input only after confirmation", async () => {
  const snapshot = recoverySnapshot("  새로 쓰고 있는 말\n");
  const original = structuredClone(snapshot.conversation);
  render(<Balloon snapshot={snapshot} />);
  fireEvent.click(screen.getByRole("button", { name: "입력 수정" }));
  expect(screen.getByRole("dialog", { name: "작성 중인 초안을 바꿀까요?" })).toBeTruthy();
  expect(screen.getByRole("textbox")).toHaveProperty("value", "  새로 쓰고 있는 말\n");
  fireEvent.click(screen.getByRole("button", { name: "계속 작성" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("textbox")).toHaveProperty("value", "  새로 쓰고 있는 말\n");
  fireEvent.click(screen.getByRole("button", { name: "입력 수정" }));
  fireEvent.click(screen.getByRole("button", { name: "초안 바꾸기" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  const input = screen.getByRole("textbox");
  expect(input).toHaveProperty("value", interruptedInput.content);
  await waitFor(() => expect(document.activeElement).toBe(input));
  expect(snapshot.conversation).toEqual(original);
  expect(command).not.toHaveBeenCalledWith("send_message", expect.anything());
});

it.each(["conversation", "message"])(
  "invalidates pending draft replacement when the %s changes",
  (change) => {
    const snapshot = recoverySnapshot("지켜야 할 초안");
    const view = render(<Balloon snapshot={snapshot} />);
    fireEvent.click(screen.getByRole("button", { name: "입력 수정" }));
    const replace = screen.getByRole("button", { name: "초안 바꾸기" });
    const next: Snapshot = {
      ...snapshot,
      conversation: {
        ...snapshot.conversation!,
        session:
          change === "conversation"
            ? { ...session, id: "different-conversation", draft: "새 대화 초안" }
            : snapshot.conversation!.session,
        messages: [seed, { ...interruptedInput, id: "new-input", content: "새 입력 원문" }],
        recovery: { messageId: "new-input", reason: "cancelled" },
      },
    };
    view.rerender(<Balloon snapshot={next} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(replace);
    expect(screen.getByRole("textbox")).toHaveProperty(
      "value",
      change === "conversation" ? "새 대화 초안" : "지켜야 할 초안",
    );
    expect(command).not.toHaveBeenCalledWith("send_message", expect.anything());
    expect(command).not.toHaveBeenCalledWith("retry_turn", expect.anything());
  },
);

it("keeps the draft before opening AI connection settings from recovery", async () => {
  render(<Balloon snapshot={recoverySnapshot()} />);
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "  연결 확인 뒤 이어 쓸 말\n" },
  });
  fireEvent.click(screen.getByRole("button", { name: "AI 연결 확인" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("open_settings"));
  expect(vi.mocked(command).mock.calls).toEqual([
    [
      "save_conversation_draft",
      { inputOwner: "desktop", sessionId: session.id, draft: "  연결 확인 뒤 이어 쓸 말\n" },
    ],
    ["set_settings_section", { section: "model" }],
    ["open_settings"],
  ]);
});

it.each([
  ["the same request", 42, "멈추기 실패"],
  ["a newer request", 43, null],
])("reports a late cancel failure only while %s is displayed", async (_label, epoch, shown) => {
  let rejectCancel!: (reason: Error) => void;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "cancel_generation")
      await new Promise<void>((_resolve, reject) => {
        rejectCancel = reject;
      });
  });
  const snapshot = conversationSnapshot();
  const generating = (requestEpoch: number): Snapshot => ({
    ...snapshot,
    activeRequest: { epoch: requestEpoch, sessionId: session.id, messageId: "input" },
    runtime: { ...snapshot.runtime, phase: "generating" },
  });
  const view = render(<Balloon snapshot={generating(42)} />);
  fireEvent.click(screen.getByRole("button", { name: "생성 멈추기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("cancel_generation", {
      request: generating(42).activeRequest,
    }),
  );
  view.rerender(<Balloon snapshot={generating(epoch)} />);
  await act(async () => rejectCancel(new Error("멈추기 실패")));
  expect(screen.queryByRole("alert")?.textContent ?? null).toBe(shown);
  expect(screen.getByRole("button", { name: "생성 멈추기" })).toHaveProperty("disabled", false);
});

it.each(["save_conversation_draft", "set_settings_section"])(
  "does not open AI settings for an older conversation after %s completes",
  async (slowCommand) => {
    let finish!: () => void;
    vi.mocked(command).mockImplementation(async (name) => {
      if (name === slowCommand)
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
    });
    const snapshot = recoverySnapshot();
    const view = render(<Balloon snapshot={snapshot} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "설정 전 초안" } });
    fireEvent.click(screen.getByRole("button", { name: "AI 연결 확인" }));
    await waitFor(() => expect(command).toHaveBeenCalledWith(slowCommand, expect.anything()));
    view.rerender(
      <Balloon
        snapshot={{
          ...snapshot,
          conversation: {
            session: { ...session, id: "next", draft: "새 초안" },
            messages: [],
            nextBefore: null,
          },
        }}
      />,
    );
    await act(async () => finish());
    expect(command).not.toHaveBeenCalledWith("open_settings");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("textbox")).toHaveProperty("value", "새 초안");
  },
);

it("does not send an older conversation's text after its draft flush completes", async () => {
  let finishSave!: () => void;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "save_conversation_draft")
      await new Promise<void>((resolve) => {
        finishSave = resolve;
      });
  });
  const snapshot = conversationSnapshot();
  const view = render(<Balloon snapshot={snapshot} />);
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "이전 대화에 보낼 말" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_conversation_draft", {
      inputOwner: "desktop",
      sessionId: session.id,
      draft: "이전 대화에 보낼 말",
    }),
  );
  view.rerender(
    <Balloon
      snapshot={{
        ...snapshot,
        conversation: {
          session: { ...session, id: "next", draft: "새 초안" },
          messages: [],
          nextBefore: null,
        },
      }}
    />,
  );
  await act(async () => finishSave());
  expect(command).not.toHaveBeenCalledWith("send_message", expect.anything());
  expect(screen.getByRole("textbox")).toHaveProperty("value", "새 초안");
  expect(screen.getByRole("button", { name: "보내기" })).toHaveProperty("disabled", false);
});

it("keeps Escape for the draft replacement confirmation before closing the conversation", async () => {
  render(<Balloon snapshot={recoverySnapshot("바꾸지 않을 초안")} />);
  fireEvent.click(screen.getByRole("button", { name: "입력 수정" }));
  expect(screen.getByRole("dialog", { name: "작성 중인 초안을 바꿀까요?" })).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  await act(async () => {});
  expect(command).not.toHaveBeenCalledWith("close_panel", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "계속 작성" }));
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("close_panel", { sessionId: session.id }),
  );
  expect(screen.getByRole("textbox")).toHaveProperty("value", "바꾸지 않을 초안");
});

it("does not idle-close the conversation while IME composition is active", async () => {
  vi.useFakeTimers();
  render(<Balloon snapshot={conversationSnapshot()} />);
  const input = screen.getByRole("textbox");
  fireEvent.compositionStart(input);
  await act(async () => {
    vi.advanceTimersByTime(100_000);
  });
  expect(command).not.toHaveBeenCalledWith("close_panel", expect.anything());
  fireEvent.compositionEnd(input);
  await act(async () => {
    vi.advanceTimersByTime(1_000);
  });
  expect(command).toHaveBeenCalledWith("close_panel", { sessionId: session.id, idle: true });
});
