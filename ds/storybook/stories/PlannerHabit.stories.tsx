import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  HabitDay,
  HabitDayCell,
  HabitRow,
  HabitWeekTable,
  HabitMonthCalendar,
  type HabitDayData,
  type HabitDayState,
} from "@comet/ui";

const states: HabitDayState[] = ["done", "missed", "unrecorded", "counting", "goalMet"];
const days = Array.from({ length: 7 }, (_, index) => ({
  id: String(index),
  weekday: ["화", "수", "목", "금", "토", "일", "월"][index] ?? "",
  date: String(6 + index),
  today: index === 6,
}));
const records: HabitDayData[] = days.map((day, index) => ({
  id: day.id,
  label: `${day.weekday}요일 ${day.date}일`,
  state: states[index % states.length] ?? "unrecorded",
  count: index + 1,
  today: day.today,
}));
function ControlledWeek(): JSX.Element {
  const [values, setValues] = useState(records);
  return (
    <HabitWeekTable
      days={days}
      habits={[
        {
          id: "reading",
          title: "독서 30분",
          description: "매일",
          days: values,
          summary: "최근 7일",
          detail: "기록을 눌러 바꿔 보세요",
        },
      ]}
      onHabitDayChange={(_habit, day) =>
        setValues(
          values.map((value) =>
            value.id === day.id
              ? { ...value, state: value.state === "done" ? "missed" : "done" }
              : value,
          ),
        )
      }
    />
  );
}
const meta = {
  title: "UI/Planner/Habit",
  component: HabitDay,
  tags: ["autodocs"],
  argTypes: {
    state: { control: "select", options: ["done", "missed", "unrecorded", "counting", "goalMet"] },
    count: { control: "number" },
    color: {
      control: "select",
      options: ["work", "record", "life", "exercise", "rest", "focus", "comet", "google"],
    },
    disabled: { control: "boolean" },
  },
  args: { state: "done", count: 3, color: "record", disabled: false },
  parameters: {
    docs: {
      description: {
        component:
          "HabitDay/DayCell은 기록 상태를 표시하는 native button입니다. Row와 WeekTable은 습관·날짜 식별자를 callback으로 돌려주며 기록의 순환·횟수 저장은 소비자가 정합니다. kind는 매일/주간/횟수의 표시 계약이고 색상과 문구는 별도 props입니다.",
      },
    },
  },
} satisfies Meta<typeof HabitDay>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "Props 조절" };
export const Day: Story = {
  parameters: { controls: { disable: true } },
  name: "Day · 5상태",
  render: () => (
    <div className="comet-catalog-row">
      {states.map((state) => (
        <HabitDay
          key={state}
          state={state}
          color={state === "counting" || state === "goalMet" ? "google" : "record"}
          count={state === "goalMet" ? 8 : 3}
        />
      ))}
      <HabitDay state="done" disabled />
    </div>
  ),
};
export const DayCell: Story = {
  parameters: { controls: { disable: true } },
  name: "Day Cell · 5상태",
  render: () => (
    <div className="comet-catalog-row">
      {(["done", "skipped", "empty", "countComplete", "countOngoing"] as const).map((state) => (
        <HabitDayCell key={state} state={state} count={8} />
      ))}
    </div>
  ),
};
export const Row: Story = {
  parameters: { controls: { disable: true } },
  name: "Row · 매일, 주간, 횟수",
  render: () => (
    <div style={{ width: 780, maxWidth: "100%" }}>
      <HabitRow
        title="다이어리 쓰기"
        description="매일"
        days={records}
        summary="7/7"
        detail="연속 23일"
      />
      <HabitRow
        title="독서 30분"
        description="주 3회"
        color="comet"
        kind="weekly"
        selected
        days={records}
        summary="2/3"
        detail="이번 주 목표"
      />
      <HabitRow
        title="물 마시기"
        description="하루 8잔"
        color="google"
        kind="count"
        days={records}
        summary="3/7"
        detail="오늘 3잔"
      />
    </div>
  ),
};
export const WeekTable: Story = {
  parameters: { controls: { disable: true } },
  name: "Week Table · 기록 변경",
  render: () => <ControlledWeek />,
};
export const MonthCalendar: Story = {
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        story:
          "습관 상세 월별 기록. Figma 03. screens / 습관 101:816에서 추출했습니다. 빈 칸은 null로 주고 날짜·완료 상태·선택·비활성 여부를 소비자가 관리합니다.",
      },
    },
  },
  name: "Month Calendar · 월별 기록",
  render: () => (
    <div style={{ width: 300 }}>
      <HabitMonthCalendar
        label="10월"
        color="comet"
        days={[
          null,
          null,
          null,
          ...Array.from({ length: 31 }, (_, i) => ({
            id: `2026-10-${i + 1}`,
            day: i + 1,
            label: `10월 ${i + 1}일`,
            state: i < 12 && i % 3 !== 0 ? ("done" as const) : ("unrecorded" as const),
            today: i === 14,
            selected: i === 11,
            disabled: i > 14,
          })),
        ]}
      />
    </div>
  ),
};
