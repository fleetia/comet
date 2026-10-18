import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TravelEditor, NEW_ENVELOPE } from "./TravelEditor";
import { TravelPlanEditor } from "./TravelPlanEditor";
import { TravelSchedule } from "./TravelSchedule";
import type { Travel, TravelPlan } from "./travelTypes";

afterEach(cleanup);

const travel: Travel = {
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
const flight: TravelPlan = {
  id: "flight",
  travelId: "jeju",
  kind: "move",
  date: "2026-10-24",
  time: "09:10",
  title: "김포 → 제주",
  place: "",
  memo: "",
  arriveDate: "2026-10-24",
  arriveTime: "10:20",
};
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });

it("saves a move with its original for conflict checks and keeps the draft on a bad arrival", async () => {
  const onSave = vi.fn().mockResolvedValue(true);
  const onClose = vi.fn();
  render(
    <TravelPlanEditor
      travel={travel}
      plan={flight}
      date={flight.date}
      busy={false}
      onSave={onSave}
      onClose={onClose}
    />,
  );
  expect(screen.getByText("시차를 빼고 1시간 10분 걸려요.")).toBeTruthy();
  change("도착 시각", "08:00");
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect((await screen.findByRole("alert")).textContent).toContain("도착이 출발보다 빨라요");
  expect(onSave).not.toHaveBeenCalled();
  expect((screen.getByLabelText("도착 시각") as HTMLInputElement).value).toBe("08:00");

  change("도착 시각", "10:30");
  change("출발지 시간대", "Asia/Tokyo");
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(onClose).toHaveBeenCalled());
  expect(onSave).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "flight",
      expected: flight,
      kind: "move",
      arriveTime: "10:30",
      departZone: "Asia/Tokyo",
      arriveZone: null,
    }),
  );
});

it("does not close or report success when saving a trip fails", async () => {
  const onSave = vi.fn().mockResolvedValue(false);
  const onClose = vi.fn();
  render(
    <TravelEditor envelopes={[]} busy={false} onSave={onSave} onClose={onClose} />,
  );
  fireEvent.change(screen.getByLabelText(/^여행 이름/), { target: { value: "제주 가족 여행" } });
  change("예산 (원)", "2,000,000");
  fireEvent.click(screen.getByRole("button", { name: "만들기" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0]).toMatchObject({
    title: "제주 가족 여행",
    budget: 2_000_000,
    envelopeId: NEW_ENVELOPE,
    timeZone: "Asia/Seoul",
  });
  expect(onClose).not.toHaveBeenCalled();
});

it("lists a day's plans by time and moves between trip days", () => {
  const onEdit = vi.fn();
  const onSelectDay = vi.fn();
  const checkIn: TravelPlan = { ...flight, id: "stay", kind: "plan", time: "15:00", title: "애월 숙소 체크인", place: "애월" };
  render(
    <TravelSchedule
      travel={travel}
      plans={[checkIn, flight]}
      days={["2026-10-24", "2026-10-25"]}
      date="2026-10-24"
      busy={false}
      onSelectDay={onSelectDay}
      onAdd={vi.fn()}
      onEdit={onEdit}
    />,
  );
  const rows = within(screen.getByRole("region", { name: "10월 24일 (토) 일정" })).getAllByRole(
    "button",
  );
  expect(rows.map((row) => row.textContent)).toEqual([
    expect.stringContaining("오전 9:10  김포 → 제주도착 오전 10:20 · 이동 1시간 10분"),
    expect.stringContaining("오후 3:00  애월 숙소 체크인애월"),
  ]);
  fireEvent.click(rows[1]);
  expect(onEdit).toHaveBeenCalledWith(checkIn);
  fireEvent.click(screen.getByRole("button", { name: "둘째 날 일정" }));
  expect(onSelectDay).toHaveBeenCalledWith("2026-10-25");
  expect(screen.queryByRole("button", { name: /첫날 일정/ })).toBeNull();
});
