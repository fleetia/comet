import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { PreparationTool } from "../PreparationTool/PreparationTool";
import type { ToolAction } from "../toolData";
import type { WidgetView } from "../types";

afterEach(cleanup);
const envelope = {
  id: "envelope",
  title: "여행",
  eventId: "old",
  eventLabel: "기존 일정",
  checks: [{ id: "check", text: "표", done: true }],
  links: [],
  todoIds: ["todo"],
  archived: false,
};
function preparation(revision = 7, eventId = "old", id = "preparation"): WidgetView {
  return {
    id,
    kind: "preparation",
    revision,
    version: 1,
    reaction: true,
    status: "enabled",
    missing: [],
    error: null,
    packageBytes: 0,
    data: { envelopes: [{ ...envelope, eventId }] },
  };
}
const calendar: WidgetView = {
  ...preparation(),
  id: "calendar",
  kind: "calendar",
  data: {
    connections: [],
    events: [
      { id: "old", title: "기존 일정", connectionId: "local" },
      { id: "new", title: "새 일정", connectionId: "local" },
      { id: "gone", title: "해제된 연결", connectionId: "missing" },
      { id: "cancelled", title: "취소 일정", connectionId: "local", cancelled: true },
    ],
  },
};
function openEditor(): void {
  if (!screen.queryByRole("dialog", { name: "봉투 날짜와 일정" }))
    fireEvent.click(screen.getByRole("button", { name: /날짜 바꾸기|날짜 정하기/ }));
  const summary = screen.getByText("일정 연결 · 변경");
  if (!summary.parentElement?.hasAttribute("open")) fireEvent.click(summary);
}
function edit(value: string): void {
  openEditor();
  fireEvent.change(screen.getByLabelText("봉투에 연결할 일정"), { target: { value } });
}

it("saves only schedule fields with the captured revision and preserves checklist content", async () => {
  const action = vi.fn<ToolAction>().mockResolvedValue(true);
  const dirty = vi.fn();
  render(
    <PreparationTool
      widget={preparation()}
      widgets={[calendar]}
      act={action}
      onDirtyChange={dirty}
    />,
  );
  edit("new");
  fireEvent.click(screen.getByRole("button", { name: "일정 연결 저장" }));
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
  expect(action).toHaveBeenCalledExactlyOnceWith(
    "update",
    { id: "envelope", eventId: "new", eventLabel: "새 일정" },
    preparation(),
  );
  expect(screen.getByRole("checkbox", { name: "표" })).toHaveProperty("checked", true);
  expect(screen.queryByRole("option", { name: /해제된 연결|취소 일정/ })).toBeNull();
});

it("retains failed connection input and blocks a same-tick duplicate submission", async () => {
  let finish!: (ok: boolean) => void;
  const action = vi.fn<ToolAction>().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<PreparationTool widget={preparation()} widgets={[calendar]} act={action} />);
  edit("");
  const save = screen.getByRole("button", { name: "일정 연결 저장" });
  act(() => {
    fireEvent.click(save);
    fireEvent.click(save);
  });
  expect(action).toHaveBeenCalledOnce();
  await act(async () => finish(false));
  expect(screen.getByLabelText("봉투에 연결할 일정")).toHaveProperty("value", "");
  expect(screen.getByRole("alert").textContent).toContain("선택은 남아");
  fireEvent.click(save);
  await act(async () => finish(true));
  expect(action).toHaveBeenLastCalledWith(
    "update",
    { id: "envelope", eventId: "", eventLabel: "" },
    preparation(),
  );
});

it("rejects malformed remote connection IDs while preserving a current unavailable reference", () => {
  const invalidCalendar: WidgetView = {
    ...calendar,
    data: {
      connections: [{}, { id: "" }, { id: 1 }, { id: "live" }],
      events: [
        { id: "missing", title: "식별자 없음" },
        { id: "empty", title: "식별자 빈값", connectionId: "" },
        { id: "numeric", title: "식별자 숫자", connectionId: 1 },
        { id: "remote", title: "정상 연결", connectionId: "live" },
        { id: "local", title: "내 일정", connectionId: "local" },
      ],
    },
  };
  render(
    <PreparationTool
      widget={preparation(7, "missing")}
      widgets={[invalidCalendar]}
      act={vi.fn()}
    />,
  );
  expect(screen.queryByRole("option", { name: /식별자/ })).toBeNull();
  openEditor();
  expect(screen.getByRole("option", { name: "기존 일정 · 현재 조회 불가" })).toBeTruthy();
  expect(screen.getAllByRole("option", { name: /정상 연결|내 일정/ })).toHaveLength(2);
});

it("syncs untouched drafts but preserves edited choices and refuses an external revision conflict", async () => {
  const action = vi.fn<ToolAction>().mockResolvedValue(true);
  const view = render(<PreparationTool widget={preparation()} widgets={[calendar]} act={action} />);
  view.rerender(
    <PreparationTool widget={preparation(8, "new")} widgets={[calendar]} act={action} />,
  );
  openEditor();
  expect(screen.getByLabelText("봉투에 연결할 일정")).toHaveProperty("value", "new");
  edit("");
  view.rerender(<PreparationTool widget={preparation(9)} widgets={[calendar]} act={action} />);
  expect(screen.getByLabelText("봉투에 연결할 일정")).toHaveProperty("value", "");
  expect(screen.getByRole("button", { name: "일정 연결 저장" })).toHaveProperty("disabled", true);
  expect(action).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "최신 연결 불러오기" }));
  expect(screen.getByLabelText("봉투에 연결할 일정")).toHaveProperty("value", "old");
});

it("keeps a missing current schedule identifiable and cancellation restores its reference", () => {
  render(<PreparationTool widget={preparation(7, "missing")} widgets={[]} act={vi.fn()} />);
  openEditor();
  expect(screen.getByRole("option", { name: "기존 일정 · 현재 조회 불가" })).toBeTruthy();
  edit("");
  fireEvent.click(screen.getByRole("button", { name: "연결 변경 취소" }));
  expect(screen.getByLabelText("봉투에 연결할 일정")).toHaveProperty("value", "missing");
});

it("ignores the old A save when its envelope unmounts through A to B to A", async () => {
  let finish!: (ok: boolean) => void;
  const action = vi.fn<ToolAction>().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<PreparationTool widget={preparation()} widgets={[calendar]} act={action} />);
  edit("new");
  fireEvent.click(screen.getByRole("button", { name: "일정 연결 저장" }));
  view.rerender(
    <PreparationTool widget={preparation(7, "old", "B")} widgets={[calendar]} act={action} />,
  );
  view.rerender(<PreparationTool widget={preparation()} widgets={[calendar]} act={action} />);
  await act(async () => finish(false));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByLabelText("봉투에 연결할 일정")).toHaveProperty("value", "old");
});
