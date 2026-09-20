import { localDay, number, record, rows, text, type DataRecord } from "../toolData";

export type PlanPeriod = "none" | "week" | "month" | "year" | "someday";
export type PlannerTab = "today" | "plans" | "calendar" | "templates";
export const PERIODS = [
  ["week", "이번 주"],
  ["month", "이번 달"],
  ["year", "올해"],
  ["someday", "언젠가"],
] as const;
export const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];

export function dayDate(day: string): Date {
  return new Date(`${day}T12:00:00`);
}
export function moveDay(day: string, amount: number): string {
  const next = dayDate(day);
  next.setDate(next.getDate() + amount);
  return localDay(next);
}
export function periodAnchor(period: string, day: string): string {
  const date = dayDate(day);
  if (period === "week") date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  if (period === "month") date.setDate(1);
  if (period === "year") date.setMonth(0, 1);
  return localDay(date);
}
export function movePeriod(day: string, period: string, amount: number): string {
  const date = dayDate(periodAnchor(period, day));
  if (period === "week") date.setDate(date.getDate() + amount * 7);
  if (period === "month") date.setMonth(date.getMonth() + amount);
  if (period === "year") date.setFullYear(date.getFullYear() + amount);
  return localDay(date);
}
export function dueDay(item: DataRecord): string {
  return typeof item.dueAt === "number" ? localDay(new Date(item.dueAt)) : text(item.dueDate);
}
export function plannedDay(item: DataRecord): string {
  // An explicit removal from Today must not be undone by falling back to its due date.
  return Object.hasOwn(item, "plannedDate") ? text(item.plannedDate) : dueDay(item);
}
export function inPeriod(item: DataRecord, period: string, day: string): boolean {
  if (period === "inbox")
    return !plannedDay(item) && (!item.planPeriod || item.planPeriod === "none");
  if (item.planPeriod === period) {
    if (period === "week" && ruleOf(item).mode === "frequency")
      return (
        !item.planAnchor || periodAnchor("week", text(item.planAnchor)) <= periodAnchor("week", day)
      );
    return (
      period === "someday" ||
      !item.planAnchor ||
      periodAnchor(period, text(item.planAnchor)) === periodAnchor(period, day)
    );
  }
  return false;
}
export function ruleOf(item: DataRecord): DataRecord {
  if (item.repeatRule && typeof item.repeatRule === "object") return record(item.repeatRule);
  const unit: Record<string, string> = {
    daily: "day",
    weekly: "week",
    monthly: "month",
    yearly: "year",
  };
  return unit[text(item.repeat)]
    ? { mode: "calendar", unit: unit[text(item.repeat)], interval: 1, timeZone: "local" }
    : {};
}
export function repeatLabel(item: DataRecord): string {
  const rule = ruleOf(item);
  if (!rule.mode) return "";
  if (rule.mode === "frequency") return `주 ${number(rule.timesPerWeek) || 3}회`;
  const units: Record<string, string> = { day: "일", week: "주", month: "개월", year: "년" };
  const interval = number(rule.interval) || 1;
  if (rule.mode === "completion") return `완료 후 ${interval}${units[text(rule.unit)] || "일"}`;
  if (rule.unit === "month" && rule.monthlyMode === "last-day")
    return `${interval === 1 ? "매월" : `${interval}개월마다`} 마지막 날`;
  if (rule.unit === "month" && rule.monthlyMode === "nth-weekday")
    return `매월 ${rule.nth === -1 ? "마지막" : `${rule.nth}번째`} ${WEEKDAYS[number(rule.weekday)]}요일`;
  const weekdays = Array.isArray(rule.weekdays)
    ? rule.weekdays.filter((v): v is number => typeof v === "number")
    : [];
  if (rule.unit === "week" && weekdays.length)
    return `${interval === 1 ? "매주" : `${interval}주마다`} ${weekdays.map((d) => WEEKDAYS[d]).join("·")}`;
  if (interval !== 1) return `${interval}${units[text(rule.unit)] || "일"}마다`;
  return (
    ({ day: "매일", week: "매주", month: "매월", year: "매년" } as Record<string, string>)[
      text(rule.unit)
    ] || ""
  );
}
export function frequencyRecords(item: DataRecord, day: string): DataRecord[] {
  const start = periodAnchor("week", day),
    end = moveDay(start, 7);
  return rows(item.frequencyRecords).filter((r) => text(r.date) >= start && text(r.date) < end);
}
export function eventStart(event: DataRecord): number {
  return typeof event.startAt === "number"
    ? event.startAt
    : new Date(`${text(event.startDate)}T00:00:00`).getTime();
}
export function eventEnd(event: DataRecord): number {
  return typeof event.endAt === "number"
    ? event.endAt
    : new Date(`${text(event.endDate)}T00:00:00`).getTime();
}
export function eventsOn(events: DataRecord[], day: string): DataRecord[] {
  const start = new Date(`${day}T00:00:00`).getTime(),
    end = new Date(`${moveDay(day, 1)}T00:00:00`).getTime();
  return events
    .filter((e) => eventStart(e) < end && eventEnd(e) > start)
    .sort((a, b) => eventStart(a) - eventStart(b));
}
export function clockLabel(at: number): string {
  return new Date(at).toLocaleTimeString("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
export function eventTime(event: DataRecord): string {
  return event.allDay ? "종일" : `${clockLabel(eventStart(event))}–${clockLabel(eventEnd(event))}`;
}
export function localDateTime(day: string, time: string): number | null {
  if (!day || !time) return null;
  const value = new Date(`${day}T${time}`);
  if (
    !Number.isFinite(value.getTime()) ||
    localDay(value) !== day ||
    clockLabel(value.getTime()) !== time
  )
    return null;
  return value.getTime();
}
