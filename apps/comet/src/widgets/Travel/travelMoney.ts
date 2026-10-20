import { won } from "../Planner/diaryLedgerData";
import type { Expense, TripData } from "./travelTypes";

export const ME = "me";
const ZERO_DECIMAL = ["KRW", "JPY", "VND", "CLP", "ISK", "PYG", "UGX"];
export const CURRENCIES = ["KRW", "JPY", "USD", "EUR", "CNY", "TWD", "THB", "VND", "GBP", "AUD"];

export function exponent(currency: string): number {
  return ZERO_DECIMAL.includes(currency) ? 0 : 2;
}

/** "1,234.5" → minor units, or null when the text is not a plain amount for the currency. */
export function parseAmount(text: string, currency: string): number | null {
  const raw = text.trim().replaceAll(",", "");
  const digits = exponent(currency);
  const pattern = digits ? /^\d+(?:\.\d{1,2})?$/ : /^\d+$/;
  if (!pattern.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const value = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, "0") || "0");
  return Number.isSafeInteger(value) && value <= 10_000_000_000_000 ? value : null;
}

export function amountText(amount: number, currency: string): string {
  const digits = exponent(currency);
  const whole = Math.floor(amount / 10 ** digits);
  const fraction = digits ? `.${String(amount % 10 ** digits).padStart(digits, "0")}` : "";
  return `${whole}${fraction}`;
}

export function formatAmount(amount: number, currency: string): string {
  if (currency === "KRW") return won(amount);
  const digits = exponent(currency);
  return `${(amount / 10 ** digits).toLocaleString("ko-KR", {
    minimumFractionDigits: digits && amount % 10 ** digits ? digits : 0,
    maximumFractionDigits: digits,
  })} ${currency}`;
}

/** "9.12" (won per unit) → 91200; up to four decimals. */
export function parseRate(text: string): number | null {
  const raw = text.trim().replaceAll(",", "");
  if (!/^\d+(?:\.\d{1,4})?$/.test(raw)) return null;
  const [whole, fraction = ""] = raw.split(".");
  const value = Number(whole) * 10_000 + Number(fraction.padEnd(4, "0"));
  return value > 0 && value <= 1_000_000_000 ? value : null;
}

export function rateText(rate: number): string {
  return String(rate / 10_000);
}

/** Won value rounded half up, the same rule as the saved ledger records. */
function wonUnits(amount: number, currency: string, rate: number): bigint {
  const scale = 10n ** BigInt(exponent(currency)) * 10_000n;
  return (BigInt(amount) * BigInt(rate) + scale / 2n) / scale;
}

export function toWon(amount: number, currency: string, rate: number): number {
  return Number(wonUnits(amount, currency, rate));
}

/** The rate typed last for this currency, to prefill a new record. */
export function lastRate(trip: Pick<TripData, "expenses" | "bookings">, currency: string): number | null {
  if (currency === "KRW") return 10_000;
  const records = [...trip.bookings, ...trip.expenses].filter((value) => value.currency === currency);
  return records.at(-1)?.rate ?? null;
}

/** Largest remainder in whole won; tied remainders use stable person IDs, not payer or array order.
 * Keep this allocation identical to diary::travel::split_shares. IDs are ASCII UUIDs or "me".
 */
function splitShares(expense: Expense): Map<string, number> {
  const total = expense.shares.reduce((sum, share) => sum + BigInt(share.weight), 0n);
  if (!total) return new Map();
  const value = wonUnits(expense.amount, expense.currency, expense.rate);
  const shares = expense.shares.map(({ person, weight }) => {
    const weighted = value * BigInt(weight);
    return { person, amount: weighted / total, remainder: weighted % total };
  });
  let remaining = value - shares.reduce((sum, share) => sum + share.amount, 0n);
  shares.sort(
    (a, b) =>
      Number(b.remainder - a.remainder) || (a.person < b.person ? -1 : a.person > b.person ? 1 : 0),
  );
  for (const share of shares) {
    if (remaining === 0n) break;
    share.amount += 1n;
    remaining -= 1n;
  }
  return new Map(shares.map((share) => [share.person, Number(share.amount)]));
}

export function shareOf(expense: Expense, person: string): number {
  return splitShares(expense).get(person) ?? 0;
}

export function personName(trip: Pick<TripData, "people">, id: string): string {
  return id === ME ? "나" : (trip.people.find((person) => person.id === id)?.name ?? "알 수 없는 사람");
}

/** Positive: others owe this person. Only paid bills and recorded transfers count. */
export function balances(trip: TripData): Map<string, number> {
  const result = new Map<string, number>([[ME, 0]]);
  for (const person of trip.people) result.set(person.id, 0);
  const add = (id: string, value: number) => result.set(id, (result.get(id) ?? 0) + value);
  for (const expense of trip.expenses.filter((value) => value.paid)) {
    add(expense.payer, toWon(expense.amount, expense.currency, expense.rate));
    for (const [person, amount] of splitShares(expense)) add(person, -amount);
  }
  for (const transfer of trip.transfers) {
    add(transfer.from, transfer.amount);
    add(transfer.to, -transfer.amount);
  }
  return result;
}

export type Settlement = { from: string; to: string; amount: number };

/** Fewest transfers: the largest debtor pays the largest creditor until both reach zero. */
export function settle(trip: TripData): Settlement[] {
  const entries = [...balances(trip)].map(([id, value]) => ({ id, value }));
  const debtors = entries.filter((entry) => entry.value < 0).sort((a, b) => a.value - b.value);
  const creditors = entries.filter((entry) => entry.value > 0).sort((a, b) => b.value - a.value);
  const result: Settlement[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(-debtors[i].value, creditors[j].value);
    // Rounding leftovers under 10 won are not worth a transfer.
    if (amount >= 10) result.push({ from: debtors[i].id, to: creditors[j].id, amount });
    debtors[i].value += amount;
    creditors[j].value -= amount;
    if (debtors[i].value > -1) i += 1;
    if (creditors[j].value < 1) j += 1;
  }
  return result;
}

export type CostSummary = {
  paid: number;
  onsite: number;
  onsiteCount: number;
  perPerson: number;
  budgetPercent: number | null;
  remaining: number | null;
};

export function costSummary(trip: TripData): CostSummary {
  const value = (expense: Expense) => toWon(expense.amount, expense.currency, expense.rate);
  const paid = trip.expenses.filter((e) => e.paid).reduce((sum, e) => sum + value(e), 0);
  const unpaid = trip.expenses.filter((e) => !e.paid);
  const budget = trip.travel.budget;
  return {
    paid,
    onsite: unpaid.reduce((sum, e) => sum + value(e), 0),
    onsiteCount: unpaid.length,
    perPerson: Math.round(paid / (trip.people.length + 1)),
    budgetPercent: budget ? Math.round((paid / budget) * 100) : null,
    remaining: budget ? budget - paid : null,
  };
}

export function maskConfirmation(value: string): string {
  const visible = value.replace(/\s/g, "");
  if (!visible) return "";
  return `•••• ${visible.slice(-4)}`;
}
