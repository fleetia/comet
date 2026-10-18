import { describe, expect, it } from "vitest";
import { deadlines, placePhoto, tripPage, widgetLine, widgetTrip } from "./travelSummary";
import type { Booking, TripData } from "./travelTypes";

const travel = {
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
const stay: Booking = {
  id: "stay",
  travelId: "jeju",
  kind: "stay",
  title: "애월 숙소",
  vendor: "",
  confirmation: "AB12-4821",
  status: "paid",
  amount: 400_000,
  currency: "KRW",
  rate: 10_000,
  category: "housing",
  startDate: "2026-10-24",
  startTime: "15:00",
  endDate: "2026-10-25",
  endTime: "11:00",
  place: "애월",
  destination: "",
  cancelDate: "2026-10-21",
  cancelTime: "23:59",
  link: "",
  memo: "",
  vouchers: [],
};
const car: Booking = { ...stay, id: "car", kind: "car", title: "렌터카", status: "onsite", amount: 160_000, cancelDate: undefined, confirmation: "" };

function trip(value: Partial<TripData> = {}): TripData {
  return {
    travel,
    plans: [
      { id: "flight", travelId: "jeju", kind: "move", date: "2026-10-24", time: "09:10", title: "김포 → 제주", place: "", memo: "", arriveDate: "2026-10-24", arriveTime: "10:20" },
      { id: "car-plan", travelId: "jeju", kind: "plan", date: "2026-10-24", time: "10:50", title: "렌터카 받기", place: "제주공항", memo: "", lat: 33_506_600, lng: 126_492_900 },
    ],
    bookings: [stay, car],
    expenses: [],
    people: [],
    transfers: [],
    photos: [],
    ...value,
  };
}

describe("overview deadlines", () => {
  it("lists open free-cancel deadlines first and then payments left", () => {
    const now = new Date("2026-10-21T09:00:00+09:00");
    expect(deadlines(trip(), now).map((item) => [item.title, item.detail, item.value])).toEqual([
      ["애월 숙소 무료 취소 마감", "무료 취소 오늘 오후 11:59까지 · 한국 시각", "예약 보기"],
      ["렌터카 현장 결제", "10월 24일 오후 3:00 – 10월 25일 오전 11:00", "160,000원"],
    ]);
    expect(deadlines(trip(), new Date("2026-10-22T09:00:00+09:00")).map((item) => item.bookingId)).toEqual(["car"]);
  });
});

describe("widget line", () => {
  it("shows the nearest open trip by stage and leaves finished trips out", () => {
    expect(widgetLine(trip(), { completed: 2, total: 9 }, new Date("2026-10-21T09:00:00+09:00"))).toEqual({
      title: "제주 가족 여행",
      description: "준비 2/9 · 취소 마감 오늘",
      value: "D-3",
      meta: "출발까지",
    });
    expect(widgetLine(trip(), null, new Date("2026-10-24T10:30:00+09:00"))).toEqual({
      title: "다음 일정 · 오전 10:50",
      description: "렌터카 받기 · 20분 뒤",
      value: "1일째",
      meta: "1박 2일",
    });
    expect(widgetLine(trip(), null, new Date("2026-10-26T20:00:00+09:00")).title).toBe("제주 가족 여행 정리");
    const done = { travel: { ...travel, finished: true } };
    expect(widgetTrip([done], new Date("2026-10-26T20:00:00+09:00"))).toBeUndefined();
    expect(widgetLine(undefined, null).title).toBe("다가오는 여행이 없어요");
  });
});

describe("photos and the trip page", () => {
  it("moves a photo with a known offset into the trip's day and nearest place", () => {
    const placed = placePhoto(
      { path: "/p/a.heic", takenAt: "2026-10-24T02:30", offsetMinutes: 0, lat: 33_506_700, lng: 126_493_000 },
      trip(),
      "a.jpg",
    );
    expect(placed).toMatchObject({ takenAt: "2026-10-24T11:30", date: "2026-10-24", planId: "car-plan", thumb: "a.jpg" });
    expect(placePhoto({ path: "/p/b.jpg", takenAt: null }, trip())).toEqual({ path: "/p/b.jpg" });
  });

  it("writes days, bookings with masked numbers, money and photo counts", () => {
    const page = tripPage(trip({ photos: [{ id: "p", travelId: "jeju", path: "/p/a.jpg", date: "2026-10-24", cover: true }] }));
    expect(page).toContain("# 제주 가족 여행");
    expect(page).toContain("### 첫날 · 10월 24일 (토)");
    expect(page).toContain("- 오전 9:10 김포 → 제주");
    expect(page).toContain("예약번호 •••• 4821");
    expect(page).not.toContain("AB12-4821");
    expect(page).toContain("- 대표 사진: /p/a.jpg");
    expect(page).toContain("원본은 처음 있던 자리에 그대로 있어요.");
  });
});
