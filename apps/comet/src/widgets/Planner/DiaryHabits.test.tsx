import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DiaryHabits } from "./DiaryHabits";
import { habitMonthDates, habitStatistics } from "./diaryHabitData";
import type { DiaryHabit } from "./diaryHabitTypes";
import type { DiaryState } from "./diaryTypes";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const habit: DiaryHabit = {
  id: "reading",
  title: "독서",
  description: "",
  color: "comet",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  weeklyGoal: 7,
  mode: "check",
  target: 1,
  startDate: "2026-01-01",
  reminderTime: null,
  archived: false,
};
const empty: DiaryState = {
  revision: 0,
  pages: [],
  notes: [],
  moves: [],
  habits: [habit],
  habitChecks: [],
};

describe("diary habit recording", () => {
  it("cycles daily completion with an optimistic original and keeps count goals distinct", async () => {
    const action = vi.fn().mockResolvedValue(true);
    const { rerender } = render(
      <DiaryHabits state={empty} date="2026-01-03" busy={false} onAction={action} />,
    );
    const table = within(screen.getByLabelText("습관 목록"));
    fireEvent.click(table.getByRole("button", { name: "독서 2026-01-03: 아직 기록하지 않음" }));
    await waitFor(() =>
      expect(action).toHaveBeenCalledWith("habit-check", {
        habitId: "reading",
        date: "2026-01-03",
        status: "done",
        expectedCheck: null,
      }),
    );
    const check = { habitId: "reading", date: "2026-01-03", status: "done" as const, count: 1 };
    rerender(
      <DiaryHabits
        state={{ ...empty, habitChecks: [check] }}
        date="2026-01-03"
        busy={false}
        onAction={action}
      />,
    );
    fireEvent.click(table.getByRole("button", { name: "독서 2026-01-03: 했어요" }));
    await waitFor(() =>
      expect(action).toHaveBeenLastCalledWith("habit-check", {
        habitId: "reading",
        date: "2026-01-03",
        status: "missed",
        expectedCheck: check,
      }),
    );
    const countHabit = { ...habit, mode: "count" as const, target: 8 };
    rerender(
      <DiaryHabits
        state={{ ...empty, habits: [countHabit], habitChecks: [check] }}
        date="2026-01-03"
        busy={false}
        onAction={action}
      />,
    );
    fireEvent.click(table.getByRole("button", { name: "독서 2026-01-03: 횟수 기록 중 1회" }));
    await waitFor(() =>
      expect(action).toHaveBeenLastCalledWith("habit-check", {
        habitId: "reading",
        date: "2026-01-03",
        status: "done",
        count: 2,
        expectedCheck: check,
      }),
    );
  });

  it("retains failed edits, blocks duplicate submissions and asks before discarding changes", async () => {
    const action = vi.fn().mockResolvedValue(false);
    const dirty = vi.fn();
    render(
      <DiaryHabits
        state={empty}
        date="2026-01-03"
        busy={false}
        onAction={action}
        onDirtyChange={dirty}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "편집" }));
    const editor = within(screen.getByRole("dialog", { name: "습관 편집" }));
    fireEvent.change(editor.getByLabelText("습관 설명"), { target: { value: "  원문\n그대로  " } });
    fireEvent.click(editor.getByRole("button", { name: "저장" }));
    fireEvent.click(editor.getByRole("button", { name: "저장" }));
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(action.mock.calls[0][1]).toMatchObject({
      expectedHabit: habit,
      description: "  원문\n그대로  ",
    });
    await waitFor(() =>
      expect(editor.getByRole("alert").textContent).toContain("입력한 내용은 유지"),
    );
    expect(dirty).toHaveBeenLastCalledWith(true);
    expect((editor.getByLabelText("습관 설명") as HTMLTextAreaElement).value).toBe(
      "  원문\n그대로  ",
    );
    fireEvent.click(editor.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
    expect(editor.getByLabelText("습관 설명")).toBeTruthy();
    fireEvent.click(editor.getByRole("button", { name: "취소" }));
    fireEvent.click(screen.getByRole("button", { name: "변경 버리기" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it("keeps archived history read-only until restored and confirms permanent deletion", async () => {
    const action = vi.fn().mockResolvedValue(true);
    const archived = { ...habit, archived: true };
    render(
      <DiaryHabits
        state={{ ...empty, habits: [archived] }}
        date="2026-01-03"
        busy={false}
        onAction={action}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "보관한 습관 1개 보기" }));
    const table = within(screen.getByLabelText("보관한 습관"));
    const day = table.getByRole("button", { name: "독서 2026-01-03: 아직 기록하지 않음" });
    expect((day as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(day);
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "습관 다시 시작하기" }));
    await waitFor(() =>
      expect(action).toHaveBeenCalledWith("habit-archive", {
        id: "reading",
        archived: false,
        expectedHabit: archived,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "습관 영구 삭제" }));
    expect(action).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "영구 삭제" }));
    await waitFor(() =>
      expect(action).toHaveBeenLastCalledWith("habit-delete", {
        id: "reading",
        expectedHabit: archived,
      }),
    );
  });

  it("counts scheduled streaks, leap month boundaries and only completed count targets", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-05T12:00:00"));
    const weekdays = { ...habit, weekdays: [1, 3, 5], weeklyGoal: 3 };
    const checks = ["2025-12-31", "2026-01-02"].map((date) => ({
      habitId: habit.id,
      date,
      status: "done" as const,
      count: 1,
    }));
    // Start date excludes the prior year's record from scheduled streaks but preserves its history.
    expect(habitStatistics(weekdays, checks, "2026-01-05")).toMatchObject({
      recent: 2,
      month: 1,
      streak: 1,
      longest: 1,
    });
    expect(
      habitStatistics({ ...habit, mode: "count", target: 2 }, checks, "2026-01-05").recent,
    ).toBe(0);
    expect(habitMonthDates("2024-02-15").filter(Boolean)).toHaveLength(29);
    expect(habitMonthDates("2026-01-03").slice(0, 4)).toEqual([null, null, null, "2026-01-01"]);
  });
});
