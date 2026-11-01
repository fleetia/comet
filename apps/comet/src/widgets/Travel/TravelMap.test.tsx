import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { command } from "../../hooks/useSnapshot";
import { PlacePicker, TravelMap } from "./TravelMap";
import { TravelSchedule } from "./TravelSchedule";
import type { TravelPlan, TripData } from "./travelTypes";

vi.mock("../../hooks/useSnapshot", () => ({
  command: vi.fn(),
  isDesktop: () => true,
  errorText: String,
}));

const trip: TripData = {
  travel: { id: "trip", title: "여행", destination: "", startDate: "2026-11-01", endDate: "2026-11-01", timeZone: "Asia/Seoul", currency: "KRW", budget: 0, finished: false },
  plans: [], bookings: [], expenses: [], people: [], transfers: [], photos: [],
};
const plan: TravelPlan = { id: "plan", travelId: "trip", date: "2026-11-01", kind: "plan", title: "장소", place: "", memo: "" };

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

it("clears old address results when a new search fails", async () => {
  vi.mocked(command).mockResolvedValueOnce([{ name: "이전 장소", lat: 123, lng: 456 }] as never).mockRejectedValueOnce(new Error("검색 실패"));
  render(<PlacePicker plan={plan} search busy={false} onSave={vi.fn()} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "주소로 찾기" }));
  expect(await screen.findByRole("button", { name: "이전 장소" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "주소로 찾기" }));
  expect((await screen.findByRole("alert")).textContent).toContain("검색 실패");
  expect(screen.queryByRole("button", { name: "이전 장소" })).toBeNull();
});

it("clears address results when the query changes", async () => {
  vi.mocked(command).mockResolvedValueOnce([{ name: "이전 장소", lat: 123, lng: 456 }] as never);
  render(<PlacePicker plan={plan} search busy={false} onSave={vi.fn()} onClose={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "주소로 찾기" }));
  expect(await screen.findByRole("button", { name: "이전 장소" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("찾을 장소"), { target: { value: "새 장소" } });
  expect(screen.queryByRole("button", { name: "이전 장소" })).toBeNull();
});

it("expands all unplaced plans and allows choosing one beyond eight", () => {
  const plans = Array.from({ length: 10 }, (_, index) => ({ ...plan, id: String(index), title: `장소 ${index + 1}` }));
  render(<TravelMap trip={{ ...trip, plans }} days={[plan.date]} settings={{ mapTiles: false, addressSearch: false }} busy={false} onSettings={vi.fn()} onPlace={vi.fn()} onOpenDay={vi.fn()} />);
  expect(screen.queryByText(/장소 10/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "더 보기 (2개)" }));
  const row = screen.getByText(/장소 10/).parentElement!;
  fireEvent.click(within(row).getByRole("button", { name: "위치 붙이기" }));
  expect(screen.getByRole("dialog", { name: "‘장소 10’ 위치" })).toBeTruthy();
});

it("reports failed tiles and retries them", async () => {
  vi.mocked(command).mockRejectedValue(new Error("offline"));
  render(<TravelMap trip={{ ...trip, plans: [{ ...plan, lat: 37400000, lng: 127000000 }] }} days={[plan.date]} settings={{ mapTiles: true, addressSearch: false }} busy={false} onSettings={vi.fn()} onPlace={vi.fn()} onOpenDay={vi.fn()} />);
  await waitFor(() => expect(screen.getByText(/그린 지도로 표시하고 있어요/)).toBeTruthy());
  const calls = vi.mocked(command).mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
  await waitFor(() => expect(vi.mocked(command).mock.calls.length).toBeGreaterThan(calls));
});

it("shows each move time zone and the default trip zone", () => {
  const move: TravelPlan = { ...plan, kind: "move", time: "09:00", arriveDate: plan.date, arriveTime: "11:00", departZone: "Asia/Tokyo" };
  render(<TravelSchedule travel={trip.travel} plans={[move]} bookings={[]} days={[plan.date]} date={plan.date} busy={false} onSelectDay={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} />);
  expect(screen.getByText(/출발지와 도착지 시간대/)).toBeTruthy();
  const row = screen.getByRole("button", { name: /장소/ });
  expect(row.textContent).toContain("(일본 시각)");
  expect(row.textContent).toContain("(한국 시각)");
});

it("shows a custom trip time zone when it has no predefined label", () => {
  const move: TravelPlan = { ...plan, kind: "move", time: "09:00", arriveDate: plan.date, arriveTime: "11:00" };
  render(<TravelSchedule travel={{ ...trip.travel, timeZone: "America/Chicago" }} plans={[move]} bookings={[]} days={[plan.date]} date={plan.date} busy={false} onSelectDay={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} />);
  const row = screen.getByRole("button", { name: /장소/ });
  expect(row.textContent).toContain("오전 9:00 (America/Chicago 시각)");
  expect(row.textContent).toContain("도착 오전 11:00 (America/Chicago 시각)");
});

it("uses particles matching a destination with a final consonant", () => {
  const travel = { ...trip.travel, destination: "서울" };
  const { rerender } = render(<TravelSchedule travel={travel} plans={[]} bookings={[]} days={[plan.date]} date={plan.date} busy={false} onSelectDay={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} />);
  expect(screen.getByText(/서울과 한국의 시차는 없어요/)).toBeTruthy();
  rerender(<TravelSchedule travel={{ ...travel, timeZone: "America/Chicago" }} plans={[]} bookings={[]} days={[plan.date]} date={plan.date} busy={false} onSelectDay={vi.fn()} onAdd={vi.fn()} onEdit={vi.fn()} />);
  expect(screen.getByText(/서울은 /)).toBeTruthy();
});
