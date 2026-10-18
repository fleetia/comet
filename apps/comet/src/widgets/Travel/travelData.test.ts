import { describe, expect, it } from "vitest";
import {
  countdown,
  dateIn,
  hoursFromHome,
  instant,
  moveMinutes,
  periodLabel,
  plansOn,
  sortTravels,
  travelDays,
  travelStage,
} from "./travelData";
import type { Travel, TravelPlan } from "./travelTypes";

const jeju: Travel = {
  id: "jeju",
  title: "제주 가족 여행",
  destination: "제주",
  startDate: "2026-10-24",
  endDate: "2026-10-25",
  timeZone: "Asia/Seoul",
  currency: "KRW",
  budget: 2_000_000,
  finished: false,
};

function plan(value: Partial<TravelPlan>): TravelPlan {
  return {
    id: "p",
    travelId: "jeju",
    kind: "plan",
    date: "2026-10-24",
    title: "일정",
    place: "",
    memo: "",
    ...value,
  };
}

describe("travelStage", () => {
  it("moves through the stages by the destination date and waits for the user to finish", () => {
    const at = (iso: string) => travelStage(jeju, new Date(iso));
    expect(at("2026-10-16T12:00:00+09:00")).toBe("planning");
    expect(at("2026-10-17T00:00:00+09:00")).toBe("before");
    expect(at("2026-10-23T23:59:00+09:00")).toBe("before");
    expect(at("2026-10-24T00:00:00+09:00")).toBe("traveling");
    expect(at("2026-10-25T23:59:00+09:00")).toBe("traveling");
    expect(at("2026-10-26T00:00:00+09:00")).toBe("wrapping");
    expect(travelStage({ ...jeju, finished: true }, new Date("2026-10-24T09:00:00+09:00"))).toBe(
      "done",
    );
  });

  it("uses the destination's calendar, not the device's", () => {
    const honolulu = { ...jeju, timeZone: "Pacific/Honolulu" };
    // 서울 10월 24일 오전 9시는 호놀룰루 10월 23일 오후 2시다.
    const now = new Date("2026-10-24T09:00:00+09:00");
    expect(dateIn("Pacific/Honolulu", now)).toBe("2026-10-23");
    expect(travelStage(honolulu, now)).toBe("before");
    expect(countdown(honolulu, now)).toBe("D-1");
    expect(hoursFromHome("Pacific/Honolulu", now)).toBe(-19);
  });
});

describe("moves", () => {
  it("subtracts the time difference from the travel time", () => {
    const travel = { ...jeju, timeZone: "Asia/Tokyo" };
    const flight = plan({
      kind: "move",
      time: "12:00",
      arriveDate: "2026-10-24",
      arriveTime: "14:20",
      arriveZone: "Asia/Seoul",
    });
    expect(moveMinutes(flight, travel)).toBe(140);
    expect(instant("2026-03-08", "03:30", "America/New_York")).toBe(
      Date.parse("2026-03-08T07:30:00Z"),
    );
    expect(moveMinutes(plan({}), travel)).toBeNull();
  });
});

describe("schedule order", () => {
  it("sorts timed plans and keeps untimed ones in the order they were added", () => {
    const plans = [
      plan({ id: "later", title: "저녁", time: "18:00" }),
      plan({ id: "loose-1" }),
      plan({ id: "early", time: "09:10" }),
      plan({ id: "loose-2" }),
      plan({ id: "other-day", date: "2026-10-25" }),
    ];
    expect(plansOn(plans, "2026-10-24").map((value) => value.id)).toEqual([
      "early",
      "later",
      "loose-1",
      "loose-2",
    ]);
    expect(periodLabel(jeju)).toBe("10월 24일 (토) – 25일 (일)");
    expect(periodLabel({ ...jeju, endDate: "2026-11-01" })).toBe("10월 24일 (토) – 11월 1일 (일)");
    expect(travelDays(jeju, [plan({ date: "2026-10-27" })])).toEqual([
      "2026-10-24",
      "2026-10-25",
      "2026-10-27",
    ]);
  });

  it("lists upcoming trips first and finished trips last", () => {
    const now = new Date("2026-10-20T12:00:00+09:00");
    const past = { ...jeju, id: "past", startDate: "2026-09-01", endDate: "2026-09-02" };
    const done = { ...past, id: "done", finished: true };
    const later = { ...jeju, id: "later", startDate: "2026-12-01", endDate: "2026-12-03" };
    expect(sortTravels([done, later, past, jeju], now).map((value) => value.id)).toEqual([
      "jeju",
      "later",
      "past",
      "done",
    ]);
  });
});
