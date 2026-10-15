import type { PlannerColor } from "@comet/ui";

export type DiaryHabit = {
  id: string;
  title: string;
  description: string;
  color: PlannerColor;
  weekdays: number[];
  weeklyGoal: number;
  mode: "check" | "count";
  target: number;
  startDate: string;
  reminderTime: string | null;
  archived: boolean;
};

export type DiaryHabitCheck = {
  habitId: string;
  date: string;
  status: "done" | "missed";
  count: number;
};
