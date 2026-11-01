import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Travel } from "./Travel";

const mocks = vi.hoisted(() => ({
  diary: { state: null as unknown, busy: false, error: null as string | null, reload: vi.fn(), mutate: vi.fn() },
  widgets: { snapshot: { widgets: [] }, error: null as string | null, reload: vi.fn() },
}));
vi.mock("../../hooks/useSnapshot", () => ({ command: vi.fn(), isDesktop: () => false, errorText: String }));
vi.mock("../useWidgets", () => ({ useWidgets: () => mocks.widgets }));
vi.mock("../Planner/useDiary", () => ({ useDiary: () => mocks.diary }));

const travel = {
  id: "trip", title: "여행", destination: "", startDate: "2026-11-01", endDate: "2026-11-02",
  timeZone: "Asia/Seoul", currency: "KRW", budget: 0, finished: false,
};
const state = {
  revision: 1,
  travels: [travel],
  travelPlans: [
    { id: "first", travelId: "trip", kind: "plan", date: "2026-11-01", title: "첫날 일정", place: "", memo: "" },
    { id: "second", travelId: "trip", kind: "plan", date: "2026-11-02", title: "둘째 날 일정", place: "", memo: "" },
  ],
  travelPeople: [{ id: "friend", travelId: "trip", name: "친구", color: "blue" }],
  travelExpenses: [{ id: "expense", travelId: "trip", title: "식사", date: "2026-11-01", amount: 10000, currency: "KRW", rate: 10000, category: "", paid: true, payer: "me", shares: [{ person: "me", weight: 1 }, { person: "friend", weight: 1 }], memo: "" }],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-31T14:59:59Z"));
  mocks.diary.state = state;
  mocks.diary.error = null;
  mocks.widgets.error = null;
  window.history.replaceState(null, "", "/");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("offers reload and close instead of a loading message after a failed load", () => {
  mocks.diary.state = null;
  mocks.diary.error = "다이어리를 불러오지 못했어요";
  const close = vi.fn();
  render(<Travel onClose={close} />);
  expect(screen.getByRole("alert").textContent).toContain("다이어리를 불러오지 못했어요");
  expect(screen.queryByText("여행을 펼치고 있어요.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
  expect(mocks.diary.reload).toHaveBeenCalledOnce();
  expect(mocks.widgets.reload).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "닫기" }));
  expect(close).toHaveBeenCalledOnce();
});

it("refreshes at the destination's midnight and when the window regains focus", () => {
  render(<Travel onClose={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "다녀올 준비를 한눈에" })).toBeTruthy();
  act(() => vi.advanceTimersByTime(1200));
  expect(screen.getByRole("heading", { name: "오늘의 여행" })).toBeTruthy();
  expect(screen.getByRole("button", { name: /첫날 일정/ })).toBeTruthy();
  act(() => {
    vi.setSystemTime(new Date("2026-11-02T03:00:00Z"));
    window.dispatchEvent(new Event("focus"));
  });
  expect(screen.getByRole("button", { name: /둘째 날 일정/ })).toBeTruthy();
  expect(screen.queryByRole("button", { name: /첫날 일정/ })).toBeNull();
});

it("records a transfer using the destination date at the time of the click", () => {
  window.history.replaceState(null, "", "/#costs");
  render(<Travel onClose={vi.fn()} />);
  vi.setSystemTime(new Date("2026-10-31T15:00:01Z"));
  fireEvent.click(screen.getByRole("button", { name: "보냄 표시" }));
  expect(mocks.diary.mutate).toHaveBeenCalledWith("travel-transfer-create", expect.objectContaining({ date: "2026-11-01", travelId: "trip" }));
});
