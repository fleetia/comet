import { localDay } from "../toolData";
import { dayDate, moveDay } from "./plannerData";
import { MAX_LEDGER_AMOUNT, type RecurringExpense } from "./diaryLedgerTypes";

export function ledgerAmount(value: string): number | null {
  const raw = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(raw)) return null;
  const amount = Number(raw.replaceAll(",", ""));
  return Number.isSafeInteger(amount) && amount > 0 && amount <= MAX_LEDGER_AMOUNT ? amount : null;
}
export function won(value: number): string {
  return `${value.toLocaleString("ko-KR")}원`;
}
export function monthEnd(date: string): string {
  const day = dayDate(date);
  day.setMonth(day.getMonth() + 1, 0);
  return localDay(day);
}
export function yearThrough(date: string): string {
  const day = dayDate(date);
  day.setFullYear(day.getFullYear() + 1);
  day.setDate(day.getDate() - 1);
  return localDay(day);
}
export type LedgerOccurrence = { rule: RecurringExpense; date: string; occurrenceDate: string };
export function ledgerOccurrences(
  rules: RecurringExpense[],
  from: string,
  through: string,
): LedgerOccurrence[] {
  const result: LedgerOccurrence[] = [];
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(from) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(through) ||
    Number.isNaN(dayDate(from).getTime()) ||
    Number.isNaN(dayDate(through).getTime()) ||
    from > through
  )
    return result;
  const end = moveDay(through, 2);
  for (
    let date = moveDay(from, -2), count = 0;
    date <= end && count < 371;
    date = moveDay(date, 1), count += 1
  ) {
    const day = dayDate(date);
    const weekday = (day.getDay() + 6) % 7;
    const month = day.getMonth() + 1;
    const lastDay = Number(monthEnd(date).slice(8));
    for (const rule of rules) {
      if (!rule.enabled || date < rule.startDate || (rule.endDate && date > rule.endDate)) continue;
      const start = dayDate(rule.startDate);
      const monthOffset =
        (day.getFullYear() - start.getFullYear()) * 12 + day.getMonth() - start.getMonth();
      const due =
        rule.frequency === "weekly"
          ? weekday === rule.weekday
          : day.getDate() === Math.min(rule.day, lastDay) &&
            (rule.frequency === "monthly" ||
              (rule.frequency === "yearly" && day.getMonth() === start.getMonth()) ||
              (rule.frequency === "interval" && monthOffset % rule.interval === 0) ||
              (rule.frequency === "months" && rule.months.includes(month)));
      if (!due) continue;
      let offset = 0;
      if (weekday >= 5 && rule.weekend === "before") offset = 4 - weekday;
      if (weekday >= 5 && rule.weekend === "after") offset = 7 - weekday;
      const adjusted = moveDay(date, offset);
      if (adjusted >= from && adjusted <= through)
        result.push({ rule, date: adjusted, occurrenceDate: date });
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date) || a.rule.id.localeCompare(b.rule.id));
}
export const FREQUENCIES = [
  { value: "weekly", label: "매주" },
  { value: "monthly", label: "매달" },
  { value: "yearly", label: "매년" },
  { value: "interval", label: "몇 달마다" },
  { value: "months", label: "특정 달" },
] as const;
export function recurringDescription(rule: RecurringExpense): string {
  if (rule.frequency === "weekly")
    return `매주 ${["월", "화", "수", "목", "금", "토", "일"][rule.weekday]}요일`;
  if (rule.frequency === "yearly")
    return `매년 ${Number(rule.startDate.slice(5, 7))}월 ${rule.day}일`;
  if (rule.frequency === "interval") return `${rule.interval}개월마다 ${rule.day}일`;
  if (rule.frequency === "months") return `${rule.months.join("·")}월 ${rule.day}일`;
  return `매달 ${rule.day}일`;
}
