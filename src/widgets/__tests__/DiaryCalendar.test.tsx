import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { DiaryCalendar, MiniCalendar, type DiaryCalendarProps } from "../Planner/DiaryCalendar";
import { WIDGET_DRAG_TYPE } from "../widgetDrag";

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
