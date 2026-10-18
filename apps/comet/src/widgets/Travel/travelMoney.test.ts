import { describe, expect, it } from "vitest";
import {
  balances,
  costSummary,
  formatAmount,
  lastRate,
  maskConfirmation,
  parseAmount,
  parseRate,
  settle,
  shareOf,
  toWon,
} from "./travelMoney";
import type { Expense, TripData } from "./travelTypes";

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

function expense(value: Partial<Expense>): Expense {
  return {
    id: "e",
    travelId: "jeju",
    title: "비용",
    date: "2026-10-24",
    amount: 0,
    currency: "KRW",
    rate: 10_000,
    category: "food",
    paid: true,
    payer: "me",
    shares: [{ person: "me", weight: 1 }],
    memo: "",
    ...value,
  };
}

function trip(expenses: Expense[], transfers: TripData["transfers"] = []): TripData {
  return {
    travel,
    plans: [],
    bookings: [],
    expenses,
    people: [
      { id: "mom", travelId: "jeju", name: "엄마", color: "coral" },
      { id: "sis", travelId: "jeju", name: "동생", color: "green" },
    ],
    transfers,
    photos: [],
  };
}

describe("amounts and rates", () => {
  it("parses amounts by the currency's minor unit and rejects extra decimals", () => {
    expect(parseAmount("388,000", "KRW")).toBe(388_000);
    expect(parseAmount("12.5", "KRW")).toBeNull();
    expect(parseAmount("123.45", "USD")).toBe(12_345);
    expect(parseAmount("123.4", "USD")).toBe(12_340);
    expect(parseAmount("1.234", "USD")).toBeNull();
    expect(parseAmount("10000", "JPY")).toBe(10_000);
    expect(parseRate("9.12")).toBe(91_200);
    expect(parseRate("0")).toBeNull();
    expect(parseRate("1380.12345")).toBeNull();
  });

  it("rounds to won the same way as the saved ledger records", () => {
    // Rust의 diary::travel::won과 같은 값이어야 가계부 금액과 화면이 맞는다.
    expect(toWon(12_345, "USD", 13_800_000)).toBe(170_361);
    expect(toWon(10_000, "JPY", 91_200)).toBe(91_200);
    expect(toWon(5, "USD", 10_000)).toBe(0);
    expect(formatAmount(388_000, "KRW")).toBe("388,000원");
    expect(formatAmount(12_345, "USD")).toBe("123.45 USD");
  });

  it("prefills the rate typed last for the same currency", () => {
    const records = trip([
      expense({ id: "a", currency: "JPY", rate: 90_000, amount: 1 }),
      expense({ id: "b", currency: "JPY", rate: 91_200, amount: 1 }),
    ]);
    expect(lastRate(records, "JPY")).toBe(91_200);
    expect(lastRate(records, "USD")).toBeNull();
    expect(lastRate(records, "KRW")).toBe(10_000);
  });

  it("shows only the last four characters of a booking number", () => {
    expect(maskConfirmation("AB12 4821")).toBe("•••• 4821");
    expect(maskConfirmation("")).toBe("");
  });
});

describe("settlement", () => {
  it("splits by weight, counts sent money and asks for the fewest transfers", () => {
    const dinner = expense({
      id: "dinner",
      amount: 90_000,
      shares: [
        { person: "me", weight: 1 },
        { person: "mom", weight: 1 },
        { person: "sis", weight: 1 },
      ],
    });
    const taxi = expense({ id: "taxi", amount: 30_000, payer: "mom", shares: [{ person: "sis", weight: 1 }] });
    const onsite = expense({ id: "car", amount: 160_000, paid: false, payer: "sis" });
    expect(shareOf(dinner, "mom")).toBe(30_000);
    const before = trip([dinner, taxi, onsite]);
    expect(Object.fromEntries(balances(before))).toEqual({ me: 60_000, mom: 0, sis: -60_000 });
    expect(settle(before)).toEqual([{ from: "sis", to: "me", amount: 60_000 }]);
    const after = trip([dinner, taxi, onsite], [
      { id: "t", travelId: "jeju", from: "sis", to: "me", amount: 60_000, date: "2026-10-26" },
    ]);
    expect(settle(after)).toEqual([]);
    expect(costSummary(before)).toMatchObject({
      paid: 120_000,
      onsite: 160_000,
      onsiteCount: 1,
      perPerson: 40_000,
      budgetPercent: 6,
      remaining: 1_880_000,
    });
  });
});
