import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../App";
import { command, PREVIEW_SNAPSHOT, useSnapshot } from "../hooks/useSnapshot";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  useSnapshot: vi.fn(),
  command: vi.fn().mockResolvedValue(undefined),
  isDesktop: () => true,
}));
vi.mock("../components/Balloon/Balloon", () => ({
  Balloon: () => <textarea aria-label="desktop draft" />,
}));
vi.mock("../components/Balloon/ConversationResponse", () => ({
  ConversationResponse: () => <div role="status">character response</div>,
}));
vi.mock("../components/Balloon/ConversationHistoryWindow", () => ({
  ConversationHistoryWindow: () => <textarea aria-label="history draft" />,
}));
beforeEach(() => {
  vi.mocked(command)
    .mockReset()
    .mockImplementation(async (name) =>
      name === "get_conversation_history_state" ? { generation: 4, restoration: null } : true,
    );
});
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

it("can close a history window whose initial snapshot failed to load", async () => {
  window.history.replaceState(null, "", "/?view=conversation-history");
  vi.mocked(useSnapshot).mockReturnValue({ snapshot: null, error: "읽기 실패", reload: vi.fn() });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "창 닫기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("release_conversation_history", {
      generation: 4,
      restoration: null,
    }),
  );
});

it("keeps a newly loaded history editor when an earlier startup close receives its state", async () => {
  window.history.replaceState(null, "", "/?view=conversation-history");
  const reload = vi.fn();
  vi.mocked(useSnapshot).mockReturnValue({ snapshot: null, error: null, reload });
  let resolveState!: (state: { generation: number; restoration: null }) => void;
  const pendingState = new Promise<{ generation: number; restoration: null }>((resolve) => {
    resolveState = resolve;
  });
  vi.mocked(command).mockImplementationOnce(() => pendingState);
  const { rerender } = render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "창 닫기" }));
  expect(command).toHaveBeenCalledWith("get_conversation_history_state");

  vi.mocked(useSnapshot).mockReturnValue({ snapshot: PREVIEW_SNAPSHOT, error: null, reload });
  rerender(<App />);
  const editor = screen.getByRole("textbox", { name: "history draft" });
  fireEvent.change(editor, { target: { value: "새로 작성한 초안" } });
  await act(async () => resolveState({ generation: 4, restoration: null }));

  expect(command).not.toHaveBeenCalledWith("release_conversation_history", expect.anything());
  expect(screen.getByRole("textbox", { name: "history draft" })).toBe(editor);
  expect(editor).toHaveProperty("value", "새로 작성한 초안");
});

it.each(["input", "history-input"] as const)(
  "keeps the response webview read-only while %s owns the editor",
  (mode) => {
    window.history.replaceState(null, "", "/?view=balloon");
    vi.mocked(useSnapshot).mockReturnValue({
      snapshot: { ...PREVIEW_SNAPSHOT, panel: { persona: "builtin-a", mode } },
      error: null,
      reload: vi.fn(),
    });
    render(<App />);
    expect(screen.getByRole("status").textContent).toBe("character response");
    expect(screen.queryByRole("textbox")).toBeNull();
  },
);

it("unmounts the desktop draft controller when history takes ownership", () => {
  window.history.replaceState(null, "", "/?view=conversation-input");
  const snapshot = { ...PREVIEW_SNAPSHOT, panel: { persona: "builtin-a", mode: "input" as const } };
  vi.mocked(useSnapshot).mockReturnValue({ snapshot, error: null, reload: vi.fn() });
  const { rerender } = render(<App />);
  expect(screen.getByRole("textbox", { name: "desktop draft" })).toBeTruthy();
  vi.mocked(useSnapshot).mockReturnValue({
    snapshot: { ...snapshot, panel: { ...snapshot.panel, mode: "history-input" } },
    error: null,
    reload: vi.fn(),
  });
  rerender(<App />);
  expect(screen.queryByRole("textbox")).toBeNull();
});

it("allows retrying a failed startup close without discarding saved navigation", async () => {
  window.history.replaceState(null, "", "/?view=conversation-history");
  vi.mocked(useSnapshot).mockReturnValue({ snapshot: null, error: "읽기 실패", reload: vi.fn() });
  vi.mocked(command).mockRejectedValueOnce(new Error("상태 읽기 실패"));
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "창 닫기" }));
  await screen.findByText("상태 읽기 실패");
  expect(command).not.toHaveBeenCalledWith("release_conversation_history", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "창 닫기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("release_conversation_history", {
      generation: 4,
      restoration: null,
    }),
  );
});
