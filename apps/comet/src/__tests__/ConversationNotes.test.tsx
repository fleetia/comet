// @vitest-environment jsdom
// happy-dom localStorage bypasses Storage.prototype spies.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  ConversationSave,
  type ConversationSaveRequest,
} from "../components/Balloon/ConversationSave";
import { Balloon } from "../components/Balloon/Balloon";
import { PREVIEW_SNAPSHOT, command, isDesktop } from "../hooks/useSnapshot";
import type {
  ConversationNote,
  ConversationSession,
  Message,
  Snapshot,
} from "../types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(() => false),
}));
const note: ConversationNote = {
  noteRef: { kind: "diary", id: "note-one", title: "3화 수정" },
  body: "03C를 03D로 수정\n독자 검증은 아직",
};
const message: Message = {
  id: "message",
  role: "assistant",
  persona: "builtin-b",
  content: "  문서는 준비됐지만\n\n구현은 아직  ",
  expression: "평온",
  createdAt: 10,
  status: "complete",
};
const session: ConversationSession = {
  id: "session",
  userId: "preview-user",
  participants: ["builtin-a"],
  status: "active",
  title: "집필",
  createdAt: 10,
  updatedAt: 30,
  continuedFrom: null,
  draft: "",
};
const snapshot: Snapshot = {
  ...PREVIEW_SNAPSHOT,
  panel: { persona: "builtin-a", mode: "input" },
  conversation: {
    session,
    messages: [message],
    nextBefore: null,
  },
};
function request(kind: ConversationSaveRequest["kind"] = "note"): ConversationSaveRequest {
  return { sessionId: session.id, message, kind };
}
beforeEach(() => {
  localStorage.clear();
  vi.mocked(isDesktop).mockReturnValue(false);
  vi.mocked(command)
    .mockReset()
    .mockImplementation(async (name) => (name === "get_conversation_notes" ? [note] : undefined));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("uses the normal expression when registering a custom-expression reply, even if request storage is malformed", async () => {
  localStorage.setItem(
    `comet.conversation-save:${snapshot.user?.id}:${session.id}:${message.id}:wordbook:request`,
    "broken JSON",
  );
  render(
    <ConversationSave
      snapshot={snapshot}
      request={{ ...request("wordbook"), message: { ...message, expression: "책상으로 숨기" } }}
      onClose={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByRole("textbox", { name: "대사 제목" }), {
    target: { value: "상기" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "키워드" }), { target: { value: "상기" } });
  fireEvent.click(screen.getByRole("button", { name: "대사 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_wordbook_entry", {
      entry: expect.objectContaining({
        lines: [{ persona: "b", expression: "평온", text: message.content }],
      }),
    }),
  );
});

it("can retry within the open form when local draft storage is unavailable", async () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("storage unavailable");
  });
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "save_wordbook_entry") throw new Error("저장 연결 실패");
  });
  render(<ConversationSave snapshot={snapshot} request={request("wordbook")} onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "대사 제목" }), {
    target: { value: "상기" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "키워드" }), { target: { value: "상기" } });
  fireEvent.click(screen.getByRole("button", { name: "대사 저장" }));
  await screen.findByText(/저장 연결 실패/);
  const first = vi.mocked(command).mock.calls.find(([name]) => name === "save_wordbook_entry")?.[1];
  fireEvent.click(screen.getByRole("button", { name: "대사 저장" }));
  await waitFor(() =>
    expect(
      vi.mocked(command).mock.calls.filter(([name]) => name === "save_wordbook_entry"),
    ).toHaveLength(2),
  );
  expect(vi.mocked(command).mock.calls.at(-1)?.[1]).toEqual(first);
  expect(screen.getByText(/초안을 임시 보관하지 못했어요/)).toBeTruthy();
});

it("preserves the confirmed note text, guards appends with the original body, and reuses a lost-response request after reopening", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_conversation_notes") return [note];
    if (name === "save_conversation_note") throw new Error("저장 응답을 확인하지 못했어요.");
  });
  const first = render(
    <ConversationSave snapshot={snapshot} request={request()} onClose={vi.fn()} />,
  );
  await screen.findByRole("option", { name: note.noteRef.title });
  expect(screen.getByRole("textbox", { name: "저장할 내용" })).toHaveProperty(
    "value",
    message.content,
  );
  expect(screen.queryByRole("checkbox", { name: "다음에 이어갈 내용으로 남기기" })).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: "저장할 메모" }), {
    target: { value: note.noteRef.id },
  });
  fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
  await screen.findByRole("alert");
  const firstInput = vi
    .mocked(command)
    .mock.calls.find(([name]) => name === "save_conversation_note")?.[1];
  expect(firstInput).toEqual({
    sessionId: session.id,
    messageId: message.id,
    text: message.content,
    noteId: note.noteRef.id,
    title: undefined,
    expectedBody: note.body,
    requestId: expect.any(String),
  });
  first.unmount();
  const latestBody = `${note.body}\n\n${message.content}`;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_conversation_notes") return [{ ...note, body: latestBody }];
    if (name === "save_conversation_note") throw new Error("응답이 아직 없어요.");
  });
  render(<ConversationSave snapshot={snapshot} request={request()} onClose={vi.fn()} />);
  await screen.findByRole("option", { name: note.noteRef.title });
  fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
  await screen.findByRole("alert");
  expect(
    vi
      .mocked(command)
      .mock.calls.filter(([name]) => name === "save_conversation_note")
      .at(-1)?.[1],
  ).toEqual({ ...firstInput, expectedBody: latestBody });
});

it("opens the exact saved note from the success view and keeps the conversation return", async () => {
  const savedRef = { kind: "diary" as const, id: "note-new", title: "새 기록" };
  const onClose = vi.fn();
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_conversation_notes") return [note];
    if (name === "save_conversation_note") return savedRef;
    if (name === "open_conversation_note") throw new Error("메모를 찾을 수 없어요.");
  });
  render(<ConversationSave snapshot={snapshot} request={request()} onClose={onClose} />);
  await screen.findByRole("option", { name: note.noteRef.title });
  fireEvent.change(screen.getByRole("textbox", { name: "메모 제목" }), {
    target: { value: savedRef.title },
  });
  fireEvent.click(screen.getByRole("button", { name: "메모 저장" }));
  fireEvent.click(await screen.findByRole("button", { name: "메모 열기" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "메모를 찾을 수 없어요.");
  expect(
    vi.mocked(command).mock.calls.filter(([name]) => name === "open_conversation_note"),
  ).toEqual([["open_conversation_note", { noteRef: savedRef }]]);
  expect(
    vi.mocked(command).mock.calls.filter(([name]) => name === "save_conversation_note"),
  ).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "대화로 돌아가기" }));
  expect(onClose).toHaveBeenCalledOnce();
});

it("offers no note link after registering a line", async () => {
  render(<ConversationSave snapshot={snapshot} request={request("wordbook")} onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "대사 제목" }), {
    target: { value: "준비" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "키워드" }), {
    target: { value: "준비" },
  });
  fireEvent.click(screen.getByRole("button", { name: "대사 저장" }));
  await screen.findByText("개인 단어장에 저장했어요.");
  expect(screen.queryByRole("button", { name: "메모 열기" })).toBeNull();
});

it("registers exactly the reviewed text with a chosen speaker and no automatic idle playback", async () => {
  render(<ConversationSave snapshot={snapshot} request={request("wordbook")} onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "대사 제목" }), {
    target: { value: "상태 상기" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "키워드" }), {
    target: { value: "문서, 상태" },
  });
  expect(screen.getByRole("combobox", { name: "재생할 친구" })).toHaveProperty("value", "b");
  fireEvent.click(screen.getByRole("button", { name: "대사 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_wordbook_entry", {
      entry: {
        id: expect.any(String),
        title: "상태 상기",
        keywords: ["문서", "상태"],
        lines: [{ persona: "b", expression: "평온", text: message.content }],
        enabled: true,
        useForIdle: false,
      },
    }),
  );
  expect(await screen.findByRole("status")).toHaveProperty(
    "textContent",
    "개인 단어장에 저장했어요.",
  );
});

it("does not silently cut a long source to fit a registered line", () => {
  const long = { ...request("wordbook"), message: { ...message, content: "가".repeat(301) } };
  render(<ConversationSave snapshot={snapshot} request={long} onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "대사 제목" }), {
    target: { value: "긴 말" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "키워드" }), { target: { value: "긴말" } });
  expect(screen.getByRole("textbox", { name: "저장할 내용" })).toHaveProperty(
    "value",
    long.message.content,
  );
  expect(screen.getByRole("button", { name: "대사 저장" })).toHaveProperty("disabled", true);
});

it("resumes the paused chat from the menu", async () => {
  const paused = { ...session, id: "paused-chat", status: "paused" as const };
  render(
    <Balloon
      snapshot={{ ...PREVIEW_SNAPSHOT, panel: { persona: "builtin-a", mode: "menu" } }}
      previewConversations={[{ session: paused, messages: [], nextBefore: null }]}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "이어서 하기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("resume_chat", { sessionId: paused.id }),
  );
});

it("opens past chats instead of a memo picker when nothing is paused", async () => {
  render(
    <Balloon snapshot={{ ...PREVIEW_SNAPSHOT, panel: { persona: "builtin-a", mode: "menu" } }} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "이어서 하기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_panel", { persona: "builtin-a", mode: "history" }),
  );
  expect(screen.queryByRole("region", { name: "대화에서 참고할 메모" })).toBeNull();
  expect(command).not.toHaveBeenCalledWith("set_conversation_note_context", expect.anything());
});

it("keeps a save form open past idle timeout and does not leak it to a different user", async () => {
  vi.useFakeTimers();
  const view = render(<Balloon snapshot={snapshot} />);
  fireEvent.click(screen.getByText("남기기"));
  fireEvent.click(screen.getByRole("button", { name: "대사로 등록" }));
  fireEvent.change(screen.getByRole("textbox", { name: "대사 제목" }), {
    target: { value: "내 초안" },
  });
  await act(async () => {
    vi.advanceTimersByTime(100_000);
  });
  expect(screen.getByRole("form", { name: "대화를 대사로 등록" })).toBeTruthy();
  expect(vi.mocked(command).mock.calls.some(([name]) => name === "close_panel")).toBe(false);
  view.rerender(
    <Balloon
      snapshot={{
        ...snapshot,
        user: { ...snapshot.user!, id: "another-user" },
        conversation: {
          ...snapshot.conversation!,
          session: { ...session, id: "another-session", userId: "another-user" },
        },
      }}
    />,
  );
  expect(screen.queryByRole("form", { name: "대화를 대사로 등록" })).toBeNull();
  expect(
    Object.keys(localStorage).some((key) => key.includes("conversation-save:another-user")),
  ).toBe(false);
});
