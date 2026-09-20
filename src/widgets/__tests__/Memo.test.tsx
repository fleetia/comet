import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { emitTo, listen } from "@tauri-apps/api/event";
import { command } from "../../hooks/useSnapshot";
import { WidgetTool } from "../WidgetTool/WidgetTool";
import { MemoNote } from "../MemoNote/MemoNote";
import { useWidgets } from "../useWidgets";
import type { WidgetView } from "../types";

vi.mock("../../hooks/useSnapshot", () => ({
  command: vi.fn(),
  isDesktop: () => true,
  errorText: (cause: unknown) => String(cause),
}));
vi.mock("../useWidgets", () => ({ useWidgets: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(), emitTo: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ label: "widget-memo-note-one" }),
}));
const widget: WidgetView = {
  id: "memo",
  kind: "memo",
  installed: true,
  enabled: true,
  revision: 2,
  version: 1,
  status: "enabled",
  missing: [],
  error: null,
  packageBytes: 0,
  data: {
    notes: [
      { id: "one", title: "기존 제목", body: "첫 줄\n둘째 줄", isOpen: true, fontSize: 16 },
      { id: "two", body: "", isOpen: false, fontSize: 16 },
    ],
  },
};
beforeEach(() => {
  vi.mocked(command).mockReset();
  vi.mocked(emitTo).mockReset();
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockResolvedValue(vi.fn());
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { catalog: [], widgets: [widget], onboardingDone: true },
    error: null,
    reload: vi.fn(),
  });
});
afterEach(cleanup);

it("shows one body preview per list row and requests note creation, opening and safe put-away", async () => {
  render(<WidgetTool id="memo" />);
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
  expect(screen.getByRole("button", { name: "첫 줄 둘째 줄" })).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "넣기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("request_close_memo_note", { id: "memo", noteId: "one" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "꺼내기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_memo_note", { id: "memo", noteId: "two" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "+ 새 메모" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("create_memo_note", { id: "memo" }));
});

it("keeps footer creation and list actions locked together until a memo command completes", async () => {
  let finish: (() => void) | undefined;
  vi.mocked(command).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  render(<WidgetTool id="memo" />);
  const create = screen.getByRole("button", { name: "+ 새 메모" });
  expect(create.closest("footer")).not.toBeNull();
  fireEvent.click(create);
  expect(create).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "넣기" })).toHaveProperty("disabled", true);
  fireEvent.click(create);
  expect(command).toHaveBeenCalledTimes(1);
  await act(async () => finish?.());
  expect(create).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: "넣기" })).toHaveProperty("disabled", false);
});

it("keeps a detached draft open when saving fails and closes only after successful save", async () => {
  vi.mocked(command).mockRejectedValueOnce(new Error("저장 실패"));
  render(<MemoNote id="memo" noteId="one" />);
  expect(screen.queryByLabelText("메모 제목")).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "메모 본문" }), {
    target: { value: "  수정\n " },
  });
  fireEvent.click(screen.getByRole("button", { name: "메모 넣기" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("저장 실패"));
  expect(command).not.toHaveBeenCalledWith("close_memo_note", expect.anything());
  expect(screen.getByRole("textbox")).toHaveProperty("value", "  수정\n ");
  fireEvent.click(screen.getByRole("button", { name: "메모 넣기" }));
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("close_memo_note", { id: "memo", noteId: "one" }),
  );
});

it("reduces note text and creates another detached memo using +", async () => {
  render(<MemoNote id="memo" noteId="one" />);
  expect(screen.getByRole("button", { name: "새 메모 꺼내기" }).closest("footer")).not.toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "글자 크기 줄이기" }));
  expect(screen.getByRole("textbox").style.fontSize).toBe("14px");
  fireEvent.click(screen.getByRole("button", { name: "새 메모 꺼내기" }));
  await waitFor(() => expect(command).toHaveBeenLastCalledWith("create_memo_note", { id: "memo" }));
  expect(command).toHaveBeenNthCalledWith(1, "save_memo_note", {
    id: "memo",
    noteId: "one",
    body: "첫 줄\n둘째 줄",
    fontSize: 14,
    expectedBody: "첫 줄\n둘째 줄",
  });
});

it("flushes a pending draft for native or list close requests", async () => {
  render(<MemoNote id="memo" noteId="one" />);
  await waitFor(() =>
    expect(listen).toHaveBeenCalledWith("memo-close-request", expect.any(Function), {
      target: "widget-memo-note-one",
    }),
  );
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "마지막 입력" } });
  const handler = vi.mocked(listen).mock.calls[0][1];
  handler({ event: "memo-close-request", id: 1, payload: null });
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("close_memo_note", { id: "memo", noteId: "one" }),
  );
  expect(command).toHaveBeenNthCalledWith(1, "save_memo_note", {
    id: "memo",
    noteId: "one",
    body: "마지막 입력",
    fontSize: 16,
    expectedBody: "첫 줄\n둘째 줄",
  });
});

it("locks the draft during widget shutdown and unlocks it when saving fails", async () => {
  vi.mocked(command).mockRejectedValueOnce(new Error("디스크 저장 실패"));
  render(<MemoNote id="memo" noteId="one" />);
  await waitFor(() =>
    expect(listen).toHaveBeenCalledWith("memo-flush-request", expect.any(Function), {
      target: "widget-memo-note-one",
    }),
  );
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "보존할 초안" } });
  const request = vi.mocked(listen).mock.calls.find(([name]) => name === "memo-flush-request")?.[1];
  await act(async () => {
    request?.({ event: "memo-flush-request", id: 1, payload: { requestId: "shutdown" } });
  });
  expect(screen.getByRole("textbox")).toHaveProperty("readOnly", true);
  expect(emitTo).toHaveBeenCalledWith("widget-memo-note-one", "memo-flush-result", {
    requestId: "shutdown",
    windowLabel: "widget-memo-note-one",
    success: false,
    error: expect.any(String),
  });
  const release = vi.mocked(listen).mock.calls.find(([name]) => name === "memo-flush-release")?.[1];
  expect(vi.mocked(listen).mock.calls.map(([event, , options]) => [event, options])).toEqual([
    ["memo-close-request", { target: "widget-memo-note-one" }],
    ["memo-flush-request", { target: "widget-memo-note-one" }],
    ["memo-flush-release", { target: "widget-memo-note-one" }],
  ]);
  act(() => {
    release?.({ event: "memo-flush-release", id: 2, payload: { requestId: "shutdown" } });
  });
  expect(screen.getByRole("textbox")).toHaveProperty("readOnly", false);
  expect(screen.getByRole("textbox")).toHaveProperty("value", "보존할 초안");
});
