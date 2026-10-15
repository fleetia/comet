import { expect, it } from "vitest";
import { ledgerAmount, ledgerOccurrences, yearThrough } from "./diaryLedgerData";
import type { RecurringExpense } from "./diaryLedgerTypes";

const monthly: RecurringExpense = {
  id: "rent",
  title: "월세",
  amount: 550000,
  category: "housing",
  estimated: false,
  frequency: "monthly",
  interval: 1,
  day: 31,
  weekday: 0,
  months: [],
  startDate: "2026-01-01",
  endDate: null,
  weekend: "keep",
  autoRecord: true,
  enabled: true,
  recordedDates: [],
};

it("accepts whole KRW amounts without interpreting fractional or malformed numbers", () => {
  expect(ledgerAmount(" 4,500 ")).toBe(4500);
  for (const value of ["0", "-1", "1.5", "1,5", "1e5", "1 000", "100000000001", ""])
    expect(ledgerAmount(value)).toBeNull();
});

it("clamps short months and accounts for weekend shifts across month boundaries", () => {
  expect(
    ledgerOccurrences([monthly], "2026-02-01", "2026-03-31").map((value) => value.date),
  ).toEqual(["2026-02-28", "2026-03-31"]);
  const specific = {
    ...monthly,
    frequency: "months" as const,
    months: [3, 6],
    day: 1,
    weekend: "before" as const,
  };
  expect(
    ledgerOccurrences([specific], "2026-02-01", "2026-06-30").map(({ date, occurrenceDate }) => ({
      date,
      occurrenceDate,
    })),
  ).toEqual([
    { date: "2026-02-27", occurrenceDate: "2026-03-01" },
    { date: "2026-06-01", occurrenceDate: "2026-06-01" },
  ]);
});

it("anchors interval and annual schedules to the start date and respects end and pause", () => {
  const interval = {
    ...monthly,
    frequency: "interval" as const,
    interval: 3,
    startDate: "2026-02-10",
    day: 15,
    endDate: "2026-08-01",
  };
  expect(
    ledgerOccurrences([interval], "2026-01-01", "2026-12-31").map((value) => value.date),
  ).toEqual(["2026-02-15", "2026-05-15"]);
  expect(
    ledgerOccurrences([{ ...interval, frequency: "yearly" }], "2026-01-01", "2026-12-31").map(
      (value) => value.date,
    ),
  ).toEqual(["2026-02-15"]);
  expect(ledgerOccurrences([{ ...monthly, enabled: false }], "2026-01-01", "2026-12-31")).toEqual(
    [],
  );
  expect(ledgerOccurrences([monthly], "", "2026-12-31")).toEqual([]);
});

it("uses Monday-based weekdays for weekly schedules", () => {
  const weekly = { ...monthly, frequency: "weekly" as const, weekday: 0 };
  expect(
    ledgerOccurrences([weekly], "2026-10-01", "2026-10-15").map((value) => value.date),
  ).toEqual(["2026-10-05", "2026-10-12"]);
});

it("keeps next year's first bill outside the annual preview", () => {
  const annual = { ...monthly, frequency: "yearly" as const, startDate: "2026-01-31" };
  expect(ledgerOccurrences([annual], annual.startDate, yearThrough(annual.startDate))).toHaveLength(
    1,
  );
  expect(yearThrough("2024-02-29")).toBe("2025-02-28");
});
