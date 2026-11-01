import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TravelBookingEditor } from "./TravelBookingEditor";
import { TravelExpenseEditor } from "./TravelExpenseEditor";
import { TravelPlanEditor } from "./TravelPlanEditor";
import type { Expense, TravelPlan, TripData, Voucher } from "./travelTypes";

const { command } = vi.hoisted(() => ({ command: vi.fn() }));
vi.mock("../../hooks/useSnapshot", () => ({
  command,
  errorText: String,
  isDesktop: () => false,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const trip: TripData = {
  travel: { id: "trip", title: "여행", destination: "", startDate: "2026-10-24", endDate: "2026-10-25", timeZone: "Asia/Seoul", currency: "KRW", budget: 0, finished: false },
  plans: [], bookings: [], expenses: [], people: [], transfers: [], photos: [],
};
const callbacks = () => ({ onSave: vi.fn().mockResolvedValue(true), onClose: vi.fn(), onDirtyChange: vi.fn(), onRequestClose: vi.fn() });

it("waits for the selected voucher before allowing a booking to be saved", async () => {
  let resolve!: (vouchers: Voucher[]) => void;
  command.mockReturnValueOnce(new Promise<Voucher[]>((done) => { resolve = done; }));
  const props = callbacks();
  render(<TravelBookingEditor trip={trip} categories={[]} busy={false} today="2026-10-24" {...props} />);
  fireEvent.change(screen.getByLabelText(/^이름/), { target: { value: "숙소" } });
  fireEvent.click(screen.getByRole("button", { name: "PDF·이미지 붙이기" }));
  expect((screen.getByRole("button", { name: "저장" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.submit(screen.getByRole("button", { name: "저장" }).closest("form")!);
  expect(props.onSave).not.toHaveBeenCalled();
  resolve([{ id: "v", name: "예약.pdf", file: "v.pdf" }]);
  await screen.findByText("예약.pdf");
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(props.onSave).toHaveBeenCalledWith(expect.objectContaining({ vouchers: [{ id: "v", name: "예약.pdf", file: "v.pdf" }] })));
});

it("asks before deleting a plan and preserves it when cancelled", async () => {
  const plan: TravelPlan = { id: "p", travelId: "trip", kind: "plan", date: "2026-10-24", title: "일정", place: "", memo: "" };
  const onDelete = vi.fn().mockResolvedValue(true);
  render(<TravelPlanEditor travel={trip.travel} bookings={[]} plan={plan} date={plan.date} busy={false} onDelete={onDelete} {...callbacks()} />);
  fireEvent.click(screen.getByRole("button", { name: "지우기" }));
  const confirm = screen.getByRole("dialog", { name: "이 일정을 지울까요?" });
  fireEvent.click(within(confirm).getByRole("button", { name: "취소" }));
  expect(onDelete).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "지우기" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "이 일정을 지울까요?" })).getByRole("button", { name: "지우기" }));
  await waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
});

it("explains the connected ledger record before deleting an expense", async () => {
  const expense: Expense = { id: "e", travelId: "trip", title: "비용", date: "2026-10-24", amount: 100, currency: "KRW", rate: 10000, category: "other", paid: true, payer: "me", shares: [{ person: "me", weight: 1 }], memo: "", ledgerEntryId: "ledger" };
  const onDelete = vi.fn().mockResolvedValue(true);
  render(<TravelExpenseEditor trip={trip} expense={expense} categories={[]} today="2026-10-24" busy={false} onDelete={onDelete} {...callbacks()} />);
  fireEvent.click(screen.getByRole("button", { name: "지우기" }));
  const confirm = screen.getByRole("dialog", { name: "이 비용을 지울까요?" });
  expect(within(confirm).getByText(/가계부 기록도 함께 지워져요/)).toBeTruthy();
  expect(onDelete).not.toHaveBeenCalled();
  fireEvent.click(within(confirm).getByRole("button", { name: "지우기" }));
  await waitFor(() => expect(onDelete).toHaveBeenCalledOnce());
});
