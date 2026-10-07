import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { FocusTimerStats } from "./FocusTimerStats";
import type { FocusSession } from "./FocusTimerData";
import type { ToolAction } from "../toolData";

const session: FocusSession = {
  id: "session",
  title: "원고",
  startedAt: new Date("2026-10-07T10:00:00").getTime(),
  endedAt: new Date("2026-10-07T10:25:00").getTime(),
  elapsedMs: 1500000,
  outcome: "completed",
  memo: "원문",
  eventRef: {},
  noteRef: {},
  segments: [],
};
beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("preserves a dirty record memo across remote updates and reopening instead of overwriting either version", () => {
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  const props = {
    day: "2026-10-07",
    selectedId: "session",
    onSelect: vi.fn(),
    onOpenNote: vi.fn(),
    act,
  };
  const view = render(<FocusTimerStats {...props} sessions={[session]} />);
  fireEvent.change(screen.getByLabelText("집중 기록 메모"), {
    target: { value: "작성 중인 초안" },
  });
  const remote = { ...session, memo: "다른 창의 저장" };
  view.rerender(<FocusTimerStats {...props} sessions={[remote]} />);
  expect(screen.getByLabelText("집중 기록 메모")).toHaveProperty("value", "작성 중인 초안");
  expect(screen.getByRole("button", { name: "기록 메모 저장" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("alert").textContent).toContain("다른 화면");
  view.unmount();
  render(<FocusTimerStats {...props} sessions={[remote]} />);
  expect(screen.getByLabelText("집중 기록 메모")).toHaveProperty("value", "작성 중인 초안");
  expect(screen.getByRole("button", { name: "기록 메모 저장" })).toHaveProperty("disabled", true);
  expect(act).not.toHaveBeenCalled();
});
