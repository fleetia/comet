import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { TravelExpenseEditor } from "./TravelExpenseEditor";
import type { Expense, TripData } from "./travelTypes";

afterEach(cleanup);

it("previews a conserved split after changing payer and reselecting participants", async () => {
  const companion = "11111111-1111-4111-8111-111111111111";
  const expense: Expense = {
    id: "e",
    travelId: "trip",
    title: "비용",
    date: "2026-10-24",
    amount: 101,
    currency: "KRW",
    rate: 10_000,
    category: "food",
    paid: true,
    payer: "me",
    memo: "",
    shares: [
      { person: "me", weight: 1 },
      { person: companion, weight: 1 },
    ],
  };
  const trip: TripData = {
    travel: {
      id: "trip",
      title: "여행",
      destination: "제주",
      startDate: "2026-10-24",
      endDate: "2026-10-25",
      timeZone: "Asia/Seoul",
      currency: "KRW",
      budget: 0,
      finished: false,
    },
    plans: [],
    bookings: [],
    expenses: [expense],
    transfers: [],
    photos: [],
    people: [{ id: companion, travelId: "trip", name: "동행", color: "coral" }],
  };
  const onSave = vi.fn().mockResolvedValue(true);
  render(
    <TravelExpenseEditor
      trip={trip}
      expense={expense}
      categories={[]}
      today="2026-10-24"
      busy={false}
      onSave={onSave}
      onClose={vi.fn()}
    />,
  );
  const group = within(screen.getByRole("group", { name: "나눌 사람과 몫" }));
  const amounts = () => group.getAllByText(/^\d+원$/).map((node) => node.textContent);
  expect(amounts()).toEqual(["50원", "51원"]);
  fireEvent.change(screen.getByLabelText("낸 사람"), { target: { value: companion } });
  expect(amounts()).toEqual(["50원", "51원"]);
  fireEvent.click(group.getByRole("checkbox", { name: "나" }));
  expect(amounts()).toEqual(["101원"]);
  fireEvent.click(group.getByRole("checkbox", { name: "나" }));
  expect(amounts()).toEqual(["50원", "51원"]);
  fireEvent.change(screen.getByLabelText("나 몫"), { target: { value: "2" } });
  expect(amounts()).toEqual(["67원", "34원"]);
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0]).toMatchObject({
    amount: 101,
    payer: companion,
    shares: [
      { person: companion, weight: 1 },
      { person: "me", weight: 2 },
    ],
  });
});
