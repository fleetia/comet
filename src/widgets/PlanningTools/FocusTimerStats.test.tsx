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

it("shows the saved program and its own total separately from actual focus time", () => {
  render(
    <FocusTimerStats
      sessions={[
        {
          ...session,
          appUsage: {
            target: { id: "app:editor", name: "글쓰기" },
            elapsedMs: 62000,
            status: "tracking",
          },
        },
      ]}
      day="2026-10-07"
      selectedId="session"
      onSelect={vi.fn()}
      onOpenNote={vi.fn()}
      act={vi.fn<ToolAction>().mockResolvedValue(true)}
    />,
  );
  expect(screen.getByText("25분")).toBeTruthy();
  expect(screen.getByText("세션 전체 집중")).toBeTruthy();
  expect(screen.getByText("앱 전면 사용")).toBeTruthy();
  expect(screen.getByText("세션 전체 · 글쓰기 · 01:02")).toBeTruthy();
});

it("distinguishes a selected date from a midnight-spanning session while preserving the full app usage", () => {
  const startedAt = new Date("2026-10-07T23:45:00").getTime();
  const endedAt = new Date("2026-10-08T00:10:00").getTime();
  const overnight: FocusSession = {
    ...session,
    startedAt,
    endedAt,
    segments: [{ startAt: startedAt, endAt: endedAt }],
    appUsage: {
      target: { id: "app:editor", name: "글쓰기" },
      elapsedMs: 7 * 60_000,
      status: "tracking",
    },
  };
  const original = structuredClone(overnight);
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  const onSelect = vi.fn();
  render(
    <FocusTimerStats
      sessions={[overnight]}
      day="2026-10-08"
      selectedId={null}
      onSelect={onSelect}
      onOpenNote={vi.fn()}
      act={act}
    />,
  );
  const record = (): HTMLElement => screen.getByRole("button", { name: "원고 집중 기록 상세" });
  expect(screen.getByText("2026-10-05 – 2026-10-11 합계")).toBeTruthy();
  expect(record().textContent).toContain("이 기간 25분 · 세션 전체 25분");
  fireEvent.click(screen.getByRole("button", { name: "2026-10-08 10분" }));
  expect(screen.getByText("이 날짜 · 2026-10-08 · 10분")).toBeTruthy();
  expect(record().textContent).toContain("이 날짜 10분 · 세션 전체 25분");
  expect(record().textContent).toContain("앱 전면 사용 · 세션 전체 · 글쓰기 07:00");
  expect(screen.getByText("2026-10-05 – 2026-10-11 합계")).toBeTruthy();
  expect(screen.getByText("25분")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "일" }));
  expect(screen.getByText("2026-10-08 합계")).toBeTruthy();
  expect(record().textContent).toContain("이 기간 10분 · 세션 전체 25분");
  fireEvent.click(screen.getByRole("button", { name: "2026-10-08 00:00–04:00 10분" }));
  expect(screen.getByText("선택 구간 · 2026-10-08 00:00–04:00 · 10분")).toBeTruthy();
  expect(record().textContent).toContain("선택 구간 10분 · 세션 전체 25분");
  expect(record().textContent).toContain("앱 전면 사용 · 세션 전체 · 글쓰기 07:00");

  fireEvent.click(screen.getByRole("button", { name: "년" }));
  fireEvent.click(screen.getByRole("button", { name: "2026년 10월 25분" }));
  expect(screen.getByText("2026년 합계")).toBeTruthy();
  expect(screen.getByText("선택 구간 · 2026년 10월 · 25분")).toBeTruthy();
  expect(record().textContent).toContain("선택 구간 25분 · 세션 전체 25분");
  fireEvent.click(screen.getByRole("button", { name: "2026년 9월 0초" }));
  expect(screen.getByText("2026년 9월에 집중 기록이 없어요.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "원고 집중 기록 상세" })).toBeNull();
  expect(overnight).toEqual(original);
  expect(act).not.toHaveBeenCalled();
  expect(onSelect).not.toHaveBeenCalled();
});
