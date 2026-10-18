import type { Travel, TravelPlan, TravelStage } from "./travelTypes";

export const HOME_ZONE = "Asia/Seoul";
const DAY = 86_400_000;

export const STAGE_LABELS: Record<TravelStage, string> = {
  planning: "계획 중",
  before: "출발 전",
  traveling: "여행 중",
  wrapping: "정리 중",
  done: "끝남",
};

export function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date at `now` in `zone`, as YYYY-MM-DD. */
export function dateIn(zone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: string) => parts.find((value) => value.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dayNumber(date: string): number {
  return Math.round(Date.parse(`${date}T00:00:00Z`) / DAY);
}

export function daysBetween(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from);
}

export function addDays(date: string, days: number): string {
  return new Date((dayNumber(date) + days) * DAY).toISOString().slice(0, 10);
}

/** Stages follow the destination's date; only the user can mark a trip done. */
export function travelStage(travel: Travel, now: Date = new Date()): TravelStage {
  if (travel.finished) return "done";
  const today = dateIn(travel.timeZone, now);
  if (today > travel.endDate) return "wrapping";
  if (today >= travel.startDate) return "traveling";
  return daysBetween(today, travel.startDate) > 7 ? "planning" : "before";
}

function offsetMinutes(zone: string, at: number): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  }).formatToParts(new Date(at));
  const part = (type: string) => Number(parts.find((value) => value.type === type)?.value);
  const local = Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"));
  return Math.round((local - Math.floor(at / 60_000) * 60_000) / 60_000);
}

/** UTC milliseconds of a wall-clock time in `zone`. */
export function instant(date: string, time: string, zone: string): number {
  const wall = Date.parse(`${date}T${time}:00Z`);
  let guess = wall - offsetMinutes(zone, wall) * 60_000;
  guess = wall - offsetMinutes(zone, guess) * 60_000;
  return guess;
}

/** Hours the destination is ahead of Korea (negative when behind). */
export function hoursFromHome(zone: string, now: Date = new Date()): number {
  const at = now.getTime();
  return (offsetMinutes(zone, at) - offsetMinutes(HOME_ZONE, at)) / 60;
}

export function zoneNote(zone: string, now?: Date): string {
  const hours = hoursFromHome(zone, now);
  if (hours === 0) return "한국과 시차가 없어요";
  return `한국보다 ${Math.abs(hours)}시간 ${hours > 0 ? "빨라요" : "느려요"}`;
}

export function moveMinutes(plan: TravelPlan, travel: Travel): number | null {
  if (plan.kind !== "move" || !plan.time || !plan.arriveDate || !plan.arriveTime) return null;
  const departs = instant(plan.date, plan.time, plan.departZone ?? travel.timeZone);
  const arrives = instant(plan.arriveDate, plan.arriveTime, plan.arriveZone ?? travel.timeZone);
  return Math.round((arrives - departs) / 60_000);
}

export function duration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return [hours && `${hours}시간`, rest && `${rest}분`].filter(Boolean).join(" ") || "0분";
}

export function clock(time: string): string {
  const [hour, minute] = time.split(":").map(Number);
  return `${hour < 12 ? "오전" : "오후"} ${hour % 12 || 12}:${String(minute).padStart(2, "0")}`;
}

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

export function dayLabel(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  return `${value.getUTCMonth() + 1}월 ${value.getUTCDate()}일 (${WEEKDAYS[value.getUTCDay()]})`;
}

const ORDINALS = ["첫날", "둘째 날", "셋째 날", "넷째 날", "다섯째 날", "여섯째 날", "일곱째 날"];

export function periodLabel(travel: Travel): string {
  if (travel.endDate === travel.startDate) return dayLabel(travel.startDate);
  const end = dayLabel(travel.endDate);
  return `${dayLabel(travel.startDate)} – ${
    travel.endDate.slice(0, 7) === travel.startDate.slice(0, 7) ? end.replace(/^\d+월 /, "") : end
  }`;
}

export function ordinalDay(travel: Travel, date: string): string {
  const index = daysBetween(travel.startDate, date);
  if (index < 0) return "출발 전";
  if (date > travel.endDate) return "돌아온 뒤";
  return ORDINALS[index] ?? `${index + 1}일째`;
}

/** Every day of the trip plus any planned day outside it, in order. */
export function travelDays(travel: Travel, plans: TravelPlan[]): string[] {
  const days = new Set<string>();
  const span = Math.min(daysBetween(travel.startDate, travel.endDate), 365);
  for (let index = 0; index <= span; index += 1) days.add(addDays(travel.startDate, index));
  for (const plan of plans) days.add(plan.date);
  return [...days].sort();
}

/** Timed plans first by time, untimed ones keep the order they were added. */
export function plansOn(plans: TravelPlan[], date: string): TravelPlan[] {
  return plans
    .map((plan, index) => ({ plan, index }))
    .filter(({ plan }) => plan.date === date)
    .sort(
      (a, b) =>
        (a.plan.time ?? "99:99").localeCompare(b.plan.time ?? "99:99") || a.index - b.index,
    )
    .map(({ plan }) => plan);
}

/** Upcoming and current trips first by start date, finished trips last by recency. */
export function sortTravels(travels: Travel[], now: Date = new Date()): Travel[] {
  const rank = (travel: Travel) => {
    const stage = travelStage(travel, now);
    return stage === "done" ? 2 : stage === "wrapping" ? 1 : 0;
  };
  return [...travels].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (rank(a) === 0 ? a.startDate.localeCompare(b.startDate) : b.endDate.localeCompare(a.endDate)),
  );
}

export function countdown(travel: Travel, now: Date = new Date()): string {
  const stage = travelStage(travel, now);
  const today = dateIn(travel.timeZone, now);
  if (stage === "planning" || stage === "before") return `D-${daysBetween(today, travel.startDate)}`;
  if (stage === "traveling") return `${daysBetween(travel.startDate, today) + 1}일째`;
  return STAGE_LABELS[stage];
}
