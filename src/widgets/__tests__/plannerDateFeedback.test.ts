import { afterEach, expect, it, vi } from "vitest";
import { dueLabel, overlappingEvents } from "../Planner/plannerData";
afterEach(() => vi.useRealTimers());
it("keeps full due date separate from the planned day and qualifies relative labels", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T12:00:00"));
  expect(
    dueLabel({ plannedDate: "2026-10-03", dueAt: new Date("2026-10-05T07:30:00").getTime() }),
  ).toBe("마감 2026-10-05 07:30 · 내일");
  expect(dueLabel({ dueDate: "2026-10-04" })).toBe("마감 2026-10-04 · 오늘");
  expect(dueLabel({ dueDate: "2026-10-03" })).toBe("마감 2026-10-03 · 기한 지남");
  expect(dueLabel({ dueDate: "2026-10-03", completedAt: Date.now() })).not.toContain("기한 지남");
});
it("only reports actual overlapping fetched events, not adjacency or cancellation", () => {
  const event = { id: "mine", startAt: 100, endAt: 200 };
  expect(
    overlappingEvents(event, [
      event,
      { id: "before", startAt: 0, endAt: 100 },
      { id: "after", startAt: 200, endAt: 300 },
      { id: "cancelled", startAt: 150, endAt: 300, cancelled: true },
      { id: "overlap", startAt: 150, endAt: 300 },
    ]).map((item) => item.id),
  ).toEqual(["overlap"]);
  expect(overlappingEvents({ startAt: 200, endAt: 100 }, [event])).toEqual([]);
});
