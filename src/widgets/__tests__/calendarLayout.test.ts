import { afterEach, describe, expect, it, vi } from "vitest";
import { allDaySegments, monthDays, timedPlacements } from "../Planner/calendarLayout";
import { eventsOn } from "../Planner/plannerData";
import type { DataRecord } from "../toolData";

function allDay(id: string, startDate: string, endDate: string): DataRecord {
  return { id, title: id, allDay: true, startDate, endDate };
}
function timed(id: string, start: string, end: string): DataRecord {
  return { id, title: id, allDay: false, startAt: Date.parse(start), endAt: Date.parse(end) };
}

afterEach(() => vi.unstubAllEnvs());

describe("allDaySegments", () => {
  it("keeps holiday spans continuous, respects exclusive ends, and reuses unoccupied lanes", () => {
    const holiday = allDay("추석", "2026-09-24", "2026-09-27");
    const birthday = allDay("엄마 60", "2026-09-26", "2026-09-27");
    const monday = allDay("월요일", "2026-09-21", "2026-09-22");
    const saturday = allDay("토요일", "2026-09-26", "2026-09-27");
    const input = [birthday, saturday, holiday, monday];
    const segments = allDaySegments(input, "2026-09-21");
    expect(segments.map(({ event, start, span, lane }) => [event.id, start, span, lane])).toEqual([
      ["월요일", 0, 1, 0],
      ["추석", 3, 3, 0],
      ["엄마 60", 5, 1, 1],
      ["토요일", 5, 1, 2],
    ]);
    expect(allDaySegments([...input].reverse(), "2026-09-21")).toEqual(segments);
    expect(input).toEqual([birthday, saturday, holiday, monday]);
  });

  it("clips across week boundaries and omits events outside the week or cancelled", () => {
    const before = allDay("before", "2026-09-19", "2026-09-23");
    const after = allDay("after", "2026-09-27", "2026-09-30");
    const whole = allDay("whole", "2026-09-20", "2026-09-30");
    expect(
      allDaySegments(
        [
          before,
          after,
          whole,
          allDay("outside", "2026-09-19", "2026-09-21"),
          allDay("next-week", "2026-09-28", "2026-09-29"),
          { ...allDay("cancelled", "2026-09-24", "2026-09-25"), cancelled: true },
        ],
        "2026-09-21",
      ),
    ).toEqual([
      { event: whole, start: 0, span: 7, lane: 0, continuesBefore: true, continuesAfter: true },
      { event: before, start: 0, span: 2, lane: 1, continuesBefore: true, continuesAfter: false },
      { event: after, start: 6, span: 1, lane: 1, continuesBefore: false, continuesAfter: true },
    ]);
  });

  it("counts local calendar days through daylight saving without adding a day", () => {
    vi.stubEnv("TZ", "America/New_York");
    const event = allDay("DST weekend", "2026-03-07", "2026-03-09");
    expect(allDaySegments([event], "2026-03-02")).toEqual([
      { event, start: 5, span: 2, lane: 0, continuesBefore: false, continuesAfter: false },
    ]);
  });
});

describe("monthDays", () => {
  it.each([
    ["2021-02-14", "2021-02-01", "2021-02-28", 28],
    ["2026-02-14", "2026-01-26", "2026-03-01", 35],
    ["2026-03-14", "2026-02-23", "2026-04-05", 42],
  ])("returns the complete Monday-to-Sunday grid for %s", (day, first, last, count) => {
    vi.stubEnv("TZ", "America/New_York");
    const days = monthDays(day);
    expect(days).toHaveLength(count);
    expect(days[0]).toBe(first);
    expect(days.at(-1)).toBe(last);
    expect(new Set(days).size).toBe(count);
  });
});

describe("timedPlacements", () => {
  it("retains point events, separates coincident points, and assigns midnight to its own day", () => {
    const midnight = timed("midnight", "2026-09-22T00:00:00", "2026-09-22T00:00:00");
    const first = timed("first", "2026-09-22T09:00:00", "2026-09-22T09:00:00");
    const second = timed("second", "2026-09-22T09:00:00", "2026-09-22T09:00:00");
    const ended = timed("ended", "2026-09-21T23:00:00", "2026-09-22T00:00:00");
    const tomorrow = timed("tomorrow", "2026-09-23T00:00:00", "2026-09-23T00:00:00");
    const events = [second, first, ended, midnight, tomorrow];
    expect(timedPlacements(events, "2026-09-22")).toEqual([
      { event: midnight, start: 0, finish: 0, lane: 0, laneCount: 1 },
      { event: first, start: 9, finish: 9, lane: 0, laneCount: 2 },
      { event: second, start: 9, finish: 9, lane: 1, laneCount: 2 },
    ]);
    expect(eventsOn(events, "2026-09-22")).toEqual([midnight, second, first]);
  });

  it("shares width within each connected overlap group and restores full width afterwards", () => {
    const events = [
      timed("a", "2026-09-22T09:00:00", "2026-09-22T10:00:00"),
      timed("b", "2026-09-22T09:30:00", "2026-09-22T11:00:00"),
      timed("c", "2026-09-22T10:30:00", "2026-09-22T11:30:00"),
      timed("치과", "2026-09-22T15:00:00", "2026-09-22T16:00:00"),
      timed("저녁", "2026-09-22T16:00:00", "2026-09-22T16:30:00"),
    ];
    expect(
      timedPlacements([...events].reverse(), "2026-09-22").map(
        ({ event, start, finish, lane, laneCount }) => [event.id, start, finish, lane, laneCount],
      ),
    ).toEqual([
      ["a", 9, 10, 0, 2],
      ["b", 9.5, 11, 1, 2],
      ["c", 10.5, 11.5, 0, 2],
      ["치과", 15, 16, 0, 1],
      ["저녁", 16, 16.5, 0, 1],
    ]);
  });

  it("clips overnight events to local day boundaries and excludes cancelled or all-day events", () => {
    const overnight = timed("overnight", "2026-09-21T23:30:00", "2026-09-22T01:15:00");
    const late = timed("late", "2026-09-22T23:00:00", "2026-09-23T02:00:00");
    expect(
      timedPlacements(
        [
          overnight,
          late,
          allDay("holiday", "2026-09-22", "2026-09-23"),
          { ...timed("cancelled", "2026-09-22T10:00:00", "2026-09-22T11:00:00"), cancelled: true },
          timed("ended", "2026-09-21T23:00:00", "2026-09-22T00:00:00"),
        ],
        "2026-09-22",
      ),
    ).toEqual([
      { event: overnight, start: 0, finish: 1.25, lane: 0, laneCount: 1 },
      { event: late, start: 23, finish: 24, lane: 0, laneCount: 1 },
    ]);
  });

  it("uses local clock hours across DST and never returns a negative duration on fall-back", () => {
    vi.stubEnv("TZ", "America/New_York");
    const spring = timed("spring", "2026-03-08T01:30:00-05:00", "2026-03-08T03:30:00-04:00");
    expect(timedPlacements([spring], "2026-03-08")).toEqual([
      { event: spring, start: 1.5, finish: 3.5, lane: 0, laneCount: 1 },
    ]);
    const fall = timed("fall", "2026-11-01T01:45:00-04:00", "2026-11-01T01:15:00-05:00");
    expect(timedPlacements([fall], "2026-11-01")).toEqual([
      { event: fall, start: 1.75, finish: 1.75, lane: 0, laneCount: 1 },
    ]);
  });
});
