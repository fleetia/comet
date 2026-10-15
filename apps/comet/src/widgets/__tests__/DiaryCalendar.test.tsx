import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DiaryCalendar, MiniCalendar, type DiaryCalendarProps } from "../Planner/DiaryCalendar";
import { WIDGET_DRAG_TYPE } from "../widgetDrag";
import type { FocusSession } from "../PlanningTools/FocusTimerData";

const DAY = "2026-10-03";

function props(overrides: Partial<DiaryCalendarProps> = {}): DiaryCalendarProps {
  return {
    day: DAY,
    view: "month",
    pages: [],
    events: [],
    items: [],
    envelopes: [],
    onDay: vi.fn(),
    onEvent: vi.fn(),
    onEnvelope: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${DAY}T12:00:00`));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("uses Monday-first dates in the mini and month calendars and opens the chosen day", () => {
  const onDay = vi.fn();
  render(
    <>
      <MiniCalendar day={DAY} month={DAY} pages={[]} onMonth={vi.fn()} onDay={onDay} />
      <DiaryCalendar {...props({ onDay })} />
    </>,
  );
  const mini = within(screen.getByRole("region", { name: "날짜 찾기" }));
  const month = within(screen.getByRole("region", { name: "월간 다이어리" }));
  const miniDates = mini.getAllByRole("button", { name: /기록 열기$/ });
  const monthDates = month.getAllByRole("button", { name: /하루 펼치기$/ });
  expect(miniDates[0].getAttribute("aria-label")).toBe("2026-09-28 기록 열기");
  expect(monthDates[0].getAttribute("aria-label")).toBe("2026-09-28 하루 펼치기");
  expect(monthDates.at(-1)?.getAttribute("aria-label")).toBe("2026-11-01 하루 펼치기");
  expect(mini.getByRole("button", { name: `${DAY} 기록 열기` }).getAttribute("aria-current")).toBe(
    "date",
  );
  fireEvent.click(month.getByRole("button", { name: "2026-10-08 하루 펼치기" }));
  expect(onDay).toHaveBeenCalledWith("2026-10-08");
});

it.each(["month", "week"] as const)(
  "opens local appointments and independent dated envelopes in the %s view",
  (view) => {
    const callbacks = props({
      view,
      pages: [
        {
          id: "page",
          title: "",
          date: DAY,
          entries: [
            { id: "appointment", kind: "event", text: "동네 산책", time: "19:00" },
            { id: "note", kind: "note", text: "집에 오는 길이 좋았다." },
          ],
        },
      ],
      envelopes: [
        { id: "dated", title: "여행에 가져갈 것", date: DAY },
        { id: "undated", title: "날짜 없는 준비" },
        { id: "archived", title: "보관한 준비", date: DAY, archived: true },
      ],
    });
    render(<DiaryCalendar {...callbacks} />);
    fireEvent.click(screen.getByRole("button", { name: `${DAY} 동네 산책 직접 적은 일정 열기` }));
    expect(callbacks.onDay).toHaveBeenCalledWith(DAY);
    expect(callbacks.onEvent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "여행에 가져갈 것 준비 봉투 열기" }));
    expect(callbacks.onEnvelope).toHaveBeenCalledWith("dated");
    expect(screen.queryByRole("button", { name: "날짜 없는 준비 준비 봉투 열기" })).toBeNull();
    expect(screen.queryByRole("button", { name: "보관한 준비 준비 봉투 열기" })).toBeNull();
    expect(
      screen.getByRole("button", {
        name: view === "month" ? `${DAY} 기록 1개 읽기` : `${DAY} 메모 이어 쓰기`,
      }),
    ).toBeTruthy();
  },
);

it("keeps external event selection and its envelope as separate actions on a multi-day bar", () => {
  const event = {
    id: "trip",
    title: "강릉 여행",
    allDay: true,
    startDate: "2026-10-08",
    endDate: "2026-10-11",
  };
  const callbacks = props({
    events: [event],
    envelopes: [{ id: "trip-kit", title: "여행 준비", eventId: "trip" }],
  });
  render(<DiaryCalendar {...callbacks} />);
  fireEvent.click(screen.getByRole("button", { name: "강릉 여행" }));
  expect(callbacks.onEvent).toHaveBeenCalledWith(event, "2026-10-08");
  expect(callbacks.onEnvelope).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "여행 준비 준비 봉투 열기" }));
  expect(callbacks.onEnvelope).toHaveBeenCalledWith("trip-kit");
  expect(callbacks.onEvent).toHaveBeenCalledTimes(1);
});

it("opens the Sunday page from the weekly reflection card", () => {
  const callbacks = props({ view: "week" });
  render(<DiaryCalendar {...callbacks} />);
  fireEvent.click(
    screen.getByRole("button", { name: "이번 주에 남길 말, 일요일 페이지에 이어 쓰기" }),
  );
  expect(callbacks.onDay).toHaveBeenCalledWith("2026-10-04");
});

it("creates an event from a blank month date while keeping the date button for opening its page", () => {
  const callbacks = props({ onCreateEvent: vi.fn() });
  render(<DiaryCalendar {...callbacks} />);
  const date = "2026-10-08";
  fireEvent.doubleClick(screen.getByTitle(`${date} 빈 곳을 두 번 눌러 일정 추가`));
  expect(callbacks.onCreateEvent).toHaveBeenCalledWith(date);
  expect(callbacks.onDay).not.toHaveBeenCalled();
  const dateButton = screen.getByRole("button", { name: `${date} 하루 펼치기` });
  fireEvent.click(dateButton);
  fireEvent.doubleClick(dateButton);
  expect(callbacks.onDay).toHaveBeenCalledWith(date);
  expect(callbacks.onCreateEvent).toHaveBeenCalledOnce();
});

it.each(["month", "week"] as const)(
  "routes a widget drop to its exact date in the %s view and ignores unrelated text",
  (view) => {
    const callbacks = props({ view, onCreateEvent: vi.fn(), onDropItem: vi.fn() });
    render(<DiaryCalendar {...callbacks} />);
    const date = "2026-10-04";
    const target =
      view === "month"
        ? screen.getByTitle(`${date} 빈 곳을 두 번 눌러 일정 추가`)
        : screen.getByRole("region", { name: `${date} 기록` });
    const payload = { v: 1, kind: "todo", widgetId: "todo", itemId: "existing-task" };
    fireEvent.drop(target, {
      dataTransfer: {
        getData: (type: string) => (type === WIDGET_DRAG_TYPE ? JSON.stringify(payload) : ""),
      },
    });
    expect(callbacks.onDropItem).toHaveBeenCalledWith(payload, date);
    expect(callbacks.onDay).not.toHaveBeenCalled();
    fireEvent.drop(target, {
      dataTransfer: {
        getData: (type: string) => (type === "text/plain" ? "웹에서 복사한 글" : ""),
      },
    });
    expect(callbacks.onDropItem).toHaveBeenCalledOnce();
  },
);

it("offers a keyboard-accessible event creation button for every week date", () => {
  const callbacks = props({ view: "week", onCreateEvent: vi.fn() });
  render(<DiaryCalendar {...callbacks} />);
  fireEvent.click(screen.getByRole("button", { name: "2026-10-04 일정 추가" }));
  expect(callbacks.onCreateEvent).toHaveBeenCalledWith("2026-10-04");
  expect(callbacks.onDay).not.toHaveBeenCalled();
});

it("edits week records using their own date and the shared classification/save contract", async () => {
  const record = {
    id: "manual",
    date: "2026-10-04",
    startMinute: 540,
    endMinute: 600,
    categoryId: "work",
    title: "오전 정리",
  };
  const state = { revision: 0, pages: [], notes: [], moves: [], timeRecords: [record] };
  const action = vi.fn().mockResolvedValue(true);
  const dirty = vi.fn();
  render(
    <DiaryCalendar {...props({ view: "week", state, onAction: action, onDirtyChange: dirty })} />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "2026-10-04 09:00–10:00 · 오전 정리 시간 기록 수정" }),
  );
  expect(screen.getByRole("dialog", { name: "시간 칠하기" })).toBeDefined();
  fireEvent.change(screen.getByLabelText("시간 기록 제목"), {
    target: { value: "  다음 날 원고  " },
  });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "생활" }));
  fireEvent.click(screen.getByRole("button", { name: "수정" }));
  await waitFor(() =>
    expect(action).toHaveBeenCalledWith("time-record-save", {
      id: record.id,
      expectedRecord: record,
      expectedRecords: [record],
      date: record.date,
      startMinute: 540,
      endMinute: 600,
      categoryId: "life",
      title: "  다음 날 원고  ",
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "2026-10-02 23:50" }));
  expect(screen.getByLabelText("종료 시각").getAttribute("value")).toBe("24:00");
  fireEvent.click(screen.getByRole("button", { name: "칠하기" }));
  await waitFor(() =>
    expect(action).toHaveBeenLastCalledWith(
      "time-record-save",
      expect.objectContaining({
        date: "2026-10-02",
        startMinute: 1430,
        endMinute: 1440,
        expectedRecords: [],
      }),
    ),
  );
  expect(dirty).toHaveBeenCalledWith(true);
});

it("clips actual focus and overnight events at each date and excludes unrecorded focus", () => {
  const session: FocusSession = {
    id: "night",
    title: "밤 집중",
    startedAt: new Date(`${DAY}T23:40:00`).getTime(),
    endedAt: new Date("2026-10-04T00:20:00").getTime(),
    elapsedMs: 40 * 60000,
    outcome: "completed",
    memo: "",
    eventRef: {},
    noteRef: {},
    segments: [
      {
        startAt: new Date(`${DAY}T23:40:00`).getTime(),
        endAt: new Date("2026-10-04T00:20:00").getTime(),
      },
    ],
  };
  const callbacks = props({
    view: "week",
    focusSessions: [
      session,
      { ...session, id: "hidden", title: "링에 남기지 않은 집중", recordTimeline: false },
    ],
    events: [
      {
        id: "overnight",
        title: "밤 일정",
        startAt: new Date(`${DAY}T23:50:00`).getTime(),
        endAt: new Date("2026-10-04T00:30:00").getTime(),
      },
    ],
  });
  render(<DiaryCalendar {...callbacks} />);
  const focus = screen.getByRole("button", { name: `${DAY} 밤 집중 집중 · 20분` });
  expect(screen.getByRole("button", { name: "2026-10-04 밤 집중 집중 · 20분" })).toBeDefined();
  expect(screen.queryByRole("button", { name: /링에 남기지 않은 집중/ })).toBeNull();
  fireEvent.click(focus);
  expect(callbacks.onDay).toHaveBeenCalledWith(DAY);
  const events = screen.getAllByRole("button", { name: "밤 일정 일정 상세" });
  expect(events).toHaveLength(2);
  expect(Number.parseFloat(events[0].parentElement?.style.width ?? "")).toBeCloseTo(100 / 6);
  expect(Number.parseFloat(events[1].parentElement?.style.width ?? "")).toBe(50);
});

it.each(["month", "week"] as const)(
  "shows connected widget, memo and envelope entries in the %s view",
  (view) => {
    const callbacks = props({
      view,
      pages: [
        {
          id: "page",
          date: DAY,
          title: "",
          entries: [
            { id: "timer-link", kind: "widget", refId: "timer", text: "타이머" },
            { id: "memo-link", kind: "widget", refId: "memo", itemId: "note-1", text: "꺼낸 메모" },
            { id: "envelope-link", kind: "envelope", refId: "envelope-1", text: "준비 봉투" },
          ],
        },
      ],
    });
    render(<DiaryCalendar {...callbacks} />);
    const links = screen.getByText(/연결 3개/);
    fireEvent.click(links.closest("button") ?? links);
    expect(callbacks.onDay).toHaveBeenCalledWith(DAY);
    if (view === "week") {
      const date = within(screen.getByRole("region", { name: `${DAY} 기록` }));
      expect(date.queryByRole("button", { name: "＋ 이날에 적기" })).toBeNull();
    }
  },
);
