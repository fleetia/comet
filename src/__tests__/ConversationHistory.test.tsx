import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Balloon } from "../components/Balloon/Balloon";
import { ConversationHistory } from "../components/Balloon/ConversationHistory";
import { PREVIEW_SNAPSHOT, command, isDesktop } from "../hooks/useSnapshot";
import type { ConversationSession, Snapshot } from "../types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(() => false),
}));

beforeEach(() => {
  vi.mocked(command).mockReset().mockResolvedValue(undefined);
  vi.mocked(isDesktop).mockReturnValue(false);
  HTMLDialogElement.prototype.showModal = function (): void {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (): void {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

const FIRST: ConversationSession = {
  id: "work-draft",
  userId: "preview-user",
  participants: ["builtin-a"],
  status: "paused",
  title: "  같은 제목  ",
  createdAt: new Date(2026, 0, 2, 9, 4).getTime(),
  updatedAt: new Date(2026, 0, 20, 17, 35).getTime(),
  draft: "  첫    작업을\n이어가요.   두 번째 문장은 숨겨요.  ",
  continuedFrom: null,
};
const SECOND: ConversationSession = {
  ...FIRST,
  id: "story-draft",
  createdAt: new Date(2026, 0, 5, 15, 27).getTime(),
  updatedAt: new Date(2026, 0, 25, 10, 15).getTime(),
  draft: "  다른 장면을   써요! \n뒤 문장도 남겨요.  ",
};

it("distinguishes matching titles with the first draft sentence and omits whitespace-only drafts", () => {
  const empty = { ...FIRST, id: "empty-draft", title: "빈 초안", draft: " \n\t  " };
  const sessions = [FIRST, SECOND, empty];
  const original = structuredClone(sessions);
  render(
    <ConversationHistory
      snapshot={PREVIEW_SNAPSHOT}
      persona="builtin-a"
      sessions={sessions}
      loading={false}
      error={null}
      onResume={vi.fn()}
    />,
  );
  const first = screen.getByRole("button", { name: /첫 작업을 이어가요\./ });
  const second = screen.getByRole("button", { name: /다른 장면을 써요!/ });
  expect(within(first).getByText("같은 제목").textContent).toBe(FIRST.title);
  expect(within(second).getByText("같은 제목").textContent).toBe(SECOND.title);
  expect(within(first).getByText("초안")).toBeTruthy();
  expect(within(second).getByText("초안")).toBeTruthy();
  expect(within(screen.getByRole("button", { name: /빈 초안/ })).queryByText("초안")).toBeNull();
  expect(screen.queryByText(/두 번째 문장은 숨겨요/)).toBeNull();
  expect(screen.queryByText(/뒤 문장도 남겨요/)).toBeNull();
  expect(sessions).toEqual(original);
  expect(command).not.toHaveBeenCalled();
});

it("shows creation date and time as the start while retaining the supplied session order", () => {
  render(
    <ConversationHistory
      snapshot={PREVIEW_SNAPSHOT}
      persona="builtin-a"
      sessions={[FIRST, SECOND]}
      loading={false}
      error={null}
      onResume={vi.fn()}
    />,
  );
  const buttons = screen.getAllByRole("button", { name: /같은 제목/ });
  expect(buttons[0].textContent).toContain("첫 작업을 이어가요.");
  expect(buttons[1].textContent).toContain("다른 장면을 써요!");
  expect(within(buttons[0]).getByText("시작 2026. 1. 2. 09:04")).toHaveProperty(
    "dateTime",
    new Date(FIRST.createdAt).toISOString(),
  );
  expect(within(buttons[1]).getByText("시작 2026. 1. 5. 15:27")).toHaveProperty(
    "dateTime",
    new Date(SECOND.createdAt).toISOString(),
  );
  expect(screen.queryByText(/2026\. 1\. 25\./)).toBeNull();
  expect(screen.queryByText(/2026\. 1\. 20\./)).toBeNull();
});

it("selects and resumes the identified session and restores its complete unmodified draft", async () => {
  vi.mocked(isDesktop).mockReturnValue(true);
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_conversations") return [FIRST, SECOND];
    if (name === "get_conversation_messages") return { messages: [], nextBefore: null };
  });
  const snapshot: Snapshot = {
    ...PREVIEW_SNAPSHOT,
    panel: { persona: "builtin-a", mode: "history" },
  };
  const { rerender } = render(<Balloon snapshot={snapshot} />);
  fireEvent.click(await screen.findByRole("button", { name: /다른 장면을 써요!/ }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("get_conversation_messages", { sessionId: SECOND.id }),
  );
  fireEvent.click(screen.getByRole("button", { name: "이어하기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("resume_chat", { sessionId: SECOND.id }),
  );
  rerender(
    <Balloon
      snapshot={{
        ...snapshot,
        panel: { persona: "builtin-a", mode: "input" },
        conversation: {
          session: { ...SECOND, status: "active" },
          messages: [],
          nextBefore: null,
        },
      }}
    />,
  );
  expect(screen.getByRole("textbox")).toHaveProperty("value", SECOND.draft);
  expect(command).not.toHaveBeenCalledWith("resume_chat", { sessionId: FIRST.id });
  expect(vi.mocked(command).mock.calls.some(([name]) => name === "save_conversation_draft")).toBe(
    false,
  );
});
