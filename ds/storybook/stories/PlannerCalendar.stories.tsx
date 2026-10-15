import { useState, type JSX } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import {
  CalendarDayCell,
  CalendarDayHeader,
  CalendarDayNumber,
  CalendarDayRing,
  CalendarMonth,
  CalendarPeriodProgress,
  CalendarSummaryCard,
  CalendarTimeBlock,
  CalendarTimedEvent,
  CalendarWeek,
  type CalendarEvent,
  type CalendarMonthDay,
  type CalendarRingSegment,
  type PlannerColor,
} from "@comet/ui";

const meta = {
  title: "UI/Planner/Calendar",
  component: CalendarDayCell,
  tags: ["autodocs"],
  argTypes: {
    day: { control: "text" },
    dateLabel: { control: "text" },
    today: { control: "boolean" },
    otherMonth: { control: "boolean" },
    disabled: { control: "boolean" },
    overflowCount: { control: "number" },
    holiday: { control: "text" },
  },
  args: {
    day: "12",
    dateLabel: "10월 12일",
    today: true,
    otherMonth: false,
    disabled: false,
    overflowCount: 0,
  },
  parameters: {
    docs: {
      description: {
        component:
          "날짜·일정·분류별 시간은 props로 전달합니다. 날짜 계산·외부 캘린더 연결·저장은 소비자 책임입니다. DayCell의 날짜/일정/더 보기, Week의 날짜/10분 슬롯/일정 동작을 각각 callback으로 연결합니다. DayRing은 startMinute/endMinute(0–1440) 데이터로 그리는 차트이며 원본 그림을 고정하지 않습니다.",
      },
    },
  },
} satisfies Meta<typeof CalendarDayCell>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Playground: Story = { name: "Props 조절" };
const events: CalendarEvent[] = [
  { id: "book", title: "책 모임", time: "2:00", color: "comet" },
  { id: "dinner", title: "저녁 약속", time: "6:30", color: "google", selected: true },
];
const weekdays = ["월", "화", "수", "목", "금", "토", "일"];
const week = weekdays.map((weekday, index) => ({
  id: String(index),
  weekday,
  day: String(12 + index),
  label: `10월 ${12 + index}일`,
  today: index === 0,
}));
function SelectedEvent(): JSX.Element {
  const [selected, setSelected] = useState(false);
  return (
    <CalendarTimedEvent
      title="이달 계획 세우기"
      time="9:00"
      selected={selected}
      onClick={() => setSelected(!selected)}
    />
  );
}
export const DayCell: Story = {
  parameters: { controls: { disable: true } },
  name: "Day Cell · 6상태",
  render: () => (
    <div className="comet-catalog-row">
      {[
        { day: "28", otherMonth: true },
        { day: "10월 1일", events: events.slice(0, 1) },
        { day: "2" },
        { day: "3", holiday: "개천절" },
        { day: "12", today: true, events },
        { day: "22", events, overflowCount: 2 },
      ].map((day) => (
        <div key={day.day} style={{ width: 168 }}>
          <CalendarDayCell {...day} dateLabel={day.day.includes("월") ? day.day : `${day.day}일`} />
        </div>
      ))}
    </div>
  ),
};
export const DayHeader: Story = {
  parameters: { controls: { disable: true } },
  name: "Day Header",
  render: () => (
    <div className="comet-catalog-row" style={{ width: 340 }}>
      <CalendarDayHeader weekday="월" day="12" />
      <CalendarDayHeader weekday="월" day="12" today />
    </div>
  ),
};
export const DayNumber: Story = {
  parameters: { controls: { disable: true } },
  name: "Day Number",
  render: () => <CalendarDayNumber>12</CalendarDayNumber>,
};
export const TimedEvent: Story = {
  parameters: { controls: { disable: true } },
  name: "Timed Event · 선택",
  render: () => (
    <div style={{ width: 157 }}>
      <SelectedEvent />
    </div>
  ),
};
export const TimeBlock: Story = {
  parameters: { controls: { disable: true } },
  name: "Time Block · 5상태",
  render: () => (
    <div className="comet-catalog-row">
      {(["past", "planned", "cometEvent", "activeFocus", "selectedRange"] as const).map((state) => (
        <div key={state} style={{ width: state === "activeFocus" ? 76 : 154 }}>
          <CalendarTimeBlock state={state}>
            {state === "selectedRange"
              ? null
              : state === "activeFocus"
                ? "기획서 다듬기"
                : "회의 준비"}
          </CalendarTimeBlock>
        </div>
      ))}
    </div>
  ),
};
export const PeriodProgress: Story = {
  parameters: { controls: { disable: true } },
  name: "Period Progress",
  render: () => <CalendarPeriodProgress value={19} total={24} />,
};
export const SummaryCard: Story = {
  parameters: { controls: { disable: true } },
  name: "Summary Card · 4종류",
  render: () => (
    <div className="comet-catalog-row">
      <CalendarSummaryCard
        kind="categoryTime"
        metrics={[
          { id: "work", label: "일", value: 180, valueLabel: "3시간", color: "work" },
          { id: "life", label: "생활", value: 170, valueLabel: "2시간 50분", color: "life" },
          { id: "focus", label: "집중", value: 60, valueLabel: "1시간", color: "focus" },
          { id: "record", label: "기록", value: 50, valueLabel: "50분", color: "record" },
          { id: "exercise", label: "운동", value: 40, valueLabel: "40분", color: "exercise" },
          { id: "rest", label: "쉼", value: 30, valueLabel: "30분", color: "rest" },
        ]}
      />
      <CalendarSummaryCard
        kind="tasks"
        status="2개 중 1개 남음"
        tasks={[
          { id: "book", label: "반납할 책 가방에 넣기" },
          { id: "walk", label: "20분 산책하기", checked: true },
        ]}
      />
      <CalendarSummaryCard
        kind="habits"
        status="1/3"
        habits={[
          { id: "diary", label: "다이어리 쓰기", done: true },
          { id: "read", label: "독서 30분" },
          { id: "water", label: "물 3/8" },
        ]}
      />
      <CalendarSummaryCard kind="spending" amount="23,600원" description="3건 · 점심, 커피, 택시" />
    </div>
  ),
};
export const Month: Story = {
  parameters: { controls: { disable: true } },
  name: "Month",
  render: () => (
    <CalendarMonth
      aria-label="10월 일정"
      days={Array.from({ length: 21 }, (_, index): CalendarMonthDay => ({
        id: String(index),
        day: String(index < 3 ? index + 28 : index - 2),
        dateLabel: `${index < 3 ? "9" : "10"}월 ${index < 3 ? index + 28 : index - 2}일`,
        otherMonth: index < 3,
        today: index === 14,
        holiday: index === 5 ? "개천절" : undefined,
        events: index === 14 ? events : [],
      }))}
    />
  ),
};
function WeekExample(): JSX.Element {
  const [selected, setSelected] = useState("");
  return (
    <div>
      <CalendarWeek
        days={week}
        onSlotClick={(day, minute) =>
          setSelected(
            `${day.label} ${Math.floor(minute / 60)}:${String(minute % 60).padStart(2, "0")}`,
          )
        }
        events={[
          {
            id: "past",
            dayId: "0",
            startMinute: 9 * 60,
            durationMinutes: 60,
            children: "메일 정리",
          },
          {
            id: "lecture",
            dayId: "0",
            startMinute: 10 * 60,
            durationMinutes: 30,
            children: "온라인 강의",
          },
          {
            id: "break",
            dayId: "0",
            startMinute: 10 * 60 + 30,
            durationMinutes: 30,
            color: "rest",
            children: "쉬기",
          },
          {
            id: "planned",
            dayId: "1",
            startMinute: 9 * 60,
            durationMinutes: 180,
            state: "planned",
            children: "디자인 리뷰 준비",
          },
          {
            id: "event",
            dayId: "2",
            startMinute: 14 * 60,
            durationMinutes: 60,
            state: "cometEvent",
            children: "책 모임",
          },
          {
            id: "focus",
            dayId: "3",
            startMinute: 15 * 60,
            durationMinutes: 30,
            state: "activeFocus",
            children: "기획서 다듬기",
          },
          {
            id: "range",
            dayId: "4",
            startMinute: 19 * 60,
            durationMinutes: 120,
            state: "selectedRange",
            "aria-label": "오후 7시부터 9시 선택",
          },
        ]}
      />
      <output aria-live="polite">{selected}</output>
    </div>
  );
}
export const Week: Story = {
  parameters: { controls: { disable: true } },
  name: "Week · 일정과 빈 슬롯",
  render: () => <WeekExample />,
};
const segments: CalendarRingSegment[] = [
  { id: "walk", startMinute: 360, endMinute: 410, color: "exercise", label: "아침 산책 · 50분" },
  { id: "work", startMinute: 540, endMinute: 720, color: "work", label: "메일 정리 · 3시간" },
  { id: "lunch", startMinute: 720, endMinute: 780, color: "life", label: "점심 · 1시간" },
  {
    id: "focus",
    startMinute: 790,
    endMinute: 860,
    color: "focus",
    label: "기획서 초안 · 집중",
    kind: "focus",
  },
  { id: "book", startMinute: 860, endMinute: 900, color: "comet", label: "책 모임", kind: "event" },
  {
    id: "plan",
    startMinute: 1020,
    endMinute: 1080,
    color: "work",
    label: "회의 준비 · 예정",
    kind: "planned",
  },
];
function RingExample(): JSX.Element {
  const [color, setColor] = useState<PlannerColor>("exercise");
  const [selected, setSelected] = useState<CalendarRingSegment>();
  return (
    <div>
      <CalendarDayRing
        segments={segments}
        value="6시간 40분"
        caption="10분 단위 시간 기록"
        selectedColor={color}
        onColorChange={setColor}
        onSegmentClick={setSelected}
      />
      <output aria-live="polite">{selected?.label}</output>
    </div>
  );
}
export const DayRing: Story = {
  parameters: { controls: { disable: true } },
  name: "Day Ring · 데이터 차트",
  render: () => <RingExample />,
};
