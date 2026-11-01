// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { command } from "../../hooks/useSnapshot";
import { DiaryDesktopNoteDetail } from "./DiaryDesktopNotes";
import { useDiaryWidgetActions } from "./useDiaryWidgetActions";
import type { WidgetView } from "../types";

vi.mock("../../hooks/useSnapshot", () => ({
  command: vi.fn(),
  errorText: (cause: unknown) => String(cause),
  isDesktop: () => true,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); localStorage.clear(); });

const widget: WidgetView = {
  id: "memo", kind: "memo", reaction: true, revision: 3, version: 1,
  status: "enabled", missing: [], error: null, packageBytes: 0,
  data: { notes: [{ id: "note", title: "제목", body: "원문", isOpen: true, fontSize: 16 }] },
};
const reload = vi.fn();
const setFailure = vi.fn();
function setup(): void {
  function Harness() {
    const actions = useDiaryWidgetActions({ snapshot: null, todo: undefined, reload, setFailure });
    return <>
      <button onClick={() => void actions.act("update", { id: "note" }, widget)}>다른 작업</button>
      <DiaryDesktopNoteDetail
        item={{ key: "desktop:memo:note", widget, note: { id: "note", title: "제목", body: "원문", isOpen: true } }}
        widgets={[widget]} busy={actions.busy} act={actions.act} run={actions.run} execute={actions.execute}
        onCreate={vi.fn()} onOpenNote={vi.fn()} onAdd={vi.fn()} onDirtyChange={vi.fn()}
      />
    </>;
  }
  render(<Harness />);
}
async function inspect(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "메모 지우기…" }));
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "메모 삭제" }));
  await screen.findByRole("button", { name: "초안 보존" });
}

it("keeps the note when preserving the detached draft", async () => {
  vi.mocked(command).mockResolvedValueOnce("memo-draft:3:session:1").mockResolvedValueOnce({ widgets: [widget] });
  setup();
  await inspect();
  fireEvent.click(screen.getByRole("button", { name: "초안 보존" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(command).toHaveBeenCalledTimes(2);
});

it("discards only with the inspected draft token", async () => {
  vi.mocked(command)
    .mockResolvedValueOnce("memo-draft:3:session:1")
    .mockResolvedValueOnce({ widgets: [widget] })
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ widgets: [widget] });
  setup();
  await inspect();
  fireEvent.click(screen.getByRole("button", { name: "초안 폐기하고 삭제" }));
  await waitFor(() => expect(command).toHaveBeenCalledTimes(4));
  expect(command).toHaveBeenNthCalledWith(3, "execute_widget", {
    request: expect.objectContaining({ action: "delete", input: { id: "note", discardDraft: "3:session:1" } }),
  });
});

it("rejects stale confirmation and asks again", async () => {
  vi.mocked(command)
    .mockResolvedValueOnce("memo-draft:3:session:1")
    .mockResolvedValueOnce({ widgets: [widget] })
    .mockRejectedValueOnce("메모 초안이나 열린 창이 바뀌었어요.");
  setup();
  await inspect();
  fireEvent.click(screen.getByRole("button", { name: "초안 폐기하고 삭제" }));
  expect((await screen.findByRole("alert")).textContent).toContain("다시 확인해 주세요");
  expect(screen.getByRole("button", { name: "메모 삭제" })).toBeTruthy();
  expect(reload).toHaveBeenCalled();
});

it("uses the updated revision after another widget action", async () => {
  vi.mocked(command)
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ widgets: [{ ...widget, revision: 4 }] })
    .mockResolvedValueOnce("memo-draft:4:session:2")
    .mockResolvedValueOnce({ widgets: [{ ...widget, revision: 4 }] });
  setup();
  fireEvent.click(screen.getByRole("button", { name: "다른 작업" }));
  await waitFor(() => expect((screen.getByRole("button", { name: "메모 지우기…" }) as HTMLButtonElement).disabled).toBe(false));
  await inspect();
  expect(command).toHaveBeenNthCalledWith(3, "execute_widget", {
    request: expect.objectContaining({ action: "delete", expectedRevision: 4, input: { id: "note" } }),
  });
});

it("does not delete while another widget action is pending", async () => {
  let finish: (value: null) => void = () => {};
  vi.mocked(command)
    .mockImplementationOnce(() => new Promise<null>((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce({ widgets: [widget] });
  setup();
  fireEvent.click(screen.getByRole("button", { name: "메모 지우기…" }));
  fireEvent.click(screen.getByRole("button", { name: "다른 작업" }));
  expect((within(screen.getByRole("dialog")).getByRole("button", { name: "메모 삭제" }) as HTMLButtonElement).disabled).toBe(true);
  expect(command).toHaveBeenCalledTimes(1);
  finish(null);
  await waitFor(() => expect((within(screen.getByRole("dialog")).getByRole("button", { name: "메모 삭제" }) as HTMLButtonElement).disabled).toBe(false));
});
