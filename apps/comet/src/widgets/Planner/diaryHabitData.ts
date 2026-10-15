import type { HabitDayState } from "@comet/ui";
import { localDay } from "../toolData";
import { dayDate, moveDay } from "./plannerData";
import type { DiaryHabit, DiaryHabitCheck } from "./diaryHabitTypes";

export function habitScheduled(habit: DiaryHabit, date: string): boolean {
  return date >= habit.startDate && habit.weekdays.includes(dayDate(date).getDay());
}

export function habitCompleted(habit: DiaryHabit, check?: DiaryHabitCheck): boolean {
  return check?.status === "done" && (habit.mode === "check" || check.count >= habit.target);
}

export function habitDayState(habit: DiaryHabit, check?: DiaryHabitCheck): HabitDayState {
  if (!check) return "unrecorded";
  if (check.status === "missed") return "missed";
  if (habit.mode === "check") return "done";
  return check.count >= habit.target ? "goalMet" : "counting";
}

export function habitRepeatLabel(habit: DiaryHabit): string {
  if (habit.weeklyGoal < habit.weekdays.length) return `주 ${habit.weeklyGoal}회`;
  if (habit.weekdays.length === 7) return "매일";
  return [1, 2, 3, 4, 5, 6, 0]
    .filter((day) => habit.weekdays.includes(day))
    .map((day) => "일월화수목금토"[day])
    .join(" · ");
}

function adjacentScheduled(habit: DiaryHabit, date: string, direction: 1 | -1): string {
  for (let distance = 1; distance <= 7; distance += 1) {
    const next = moveDay(date, direction * distance);
    if (habit.weekdays.includes(dayDate(next).getDay())) return next;
  }
  return "";
}

export function habitStatistics(
  habit: DiaryHabit,
  checks: DiaryHabitCheck[],
  date: string,
): {
  recent: number;
  month: number;
  streak: number;
  longest: number;
} {
  const effectiveDate = date > localDay() ? localDay() : date;
  const doneDates = [
    ...new Set(
      checks
        .filter(
          (check) =>
            check.habitId === habit.id &&
            check.date <= effectiveDate &&
            habitCompleted(habit, check),
        )
        .map((check) => check.date),
    ),
  ].sort();
  let consecutive = 0;
  let longest = 0;
  let previous = "";
  for (const checkedDate of doneDates) {
    if (!habitScheduled(habit, checkedDate)) continue;
    consecutive =
      previous && adjacentScheduled(habit, previous, 1) === checkedDate ? consecutive + 1 : 1;
    longest = Math.max(longest, consecutive);
    previous = checkedDate;
  }
  const lastExpected =
    habitScheduled(habit, effectiveDate) && doneDates.includes(effectiveDate)
      ? effectiveDate
      : effectiveDate === localDay() || !habitScheduled(habit, effectiveDate)
        ? adjacentScheduled(habit, effectiveDate, -1)
        : effectiveDate;
  return {
    recent: doneDates.filter((day) => day >= moveDay(date, -6)).length,
    month: doneDates.filter((day) => day.startsWith(date.slice(0, 7))).length,
    streak: previous === lastExpected ? consecutive : 0,
    longest,
  };
}

export function habitMonthDates(date: string): Array<string | null> {
  const start = `${date.slice(0, 7)}-01`;
  const first = dayDate(start);
  const offset = (first.getDay() + 6) % 7;
  const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  return [
    ...Array<null>(offset).fill(null),
    ...Array.from({ length: days }, (_, index) => moveDay(start, index)),
  ];
}
