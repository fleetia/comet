import { won } from "../Planner/diaryLedgerData";
import {
  HOME_ZONE,
  STAGE_LABELS,
  clock,
  countdown,
  dateIn,
  dayLabel,
  daysBetween,
  instant,
  ordinalDay,
  periodLabel,
  plansOn,
  travelDays,
  travelStage,
  zoneNote,
} from "./travelData";
import { nearestPlan, fromMicro } from "./travelGeo";
import {
  costSummary,
  formatAmount,
  maskConfirmation,
  personName,
  settle,
} from "./travelMoney";
import type { Booking, Photo, TripData } from "./travelTypes";

export const BOOKING_KINDS: { value: Booking["kind"]; label: string; category: string }[] = [
  { value: "flight", label: "항공", category: "transport" },
  { value: "train", label: "기차", category: "transport" },
  { value: "bus", label: "버스", category: "transport" },
  { value: "stay", label: "숙소", category: "housing" },
  { value: "car", label: "렌터카", category: "transport" },
  { value: "ticket", label: "입장권", category: "culture" },
  { value: "food", label: "식당", category: "food" },
  { value: "other", label: "기타", category: "other" },
];
export const STATUS_LABELS: Record<Booking["status"], string> = {
  paid: "결제 완료",
  onsite: "현장 결제",
  unpaid: "결제 남음",
};

export function kindLabel(kind: Booking["kind"]): string {
  return BOOKING_KINDS.find((value) => value.value === kind)?.label ?? "예약";
}

export function bookingPeriod(booking: Booking): string {
  const start = `${dayLabel(booking.startDate).replace(/ \(.\)$/, "")}${booking.startTime ? ` ${clock(booking.startTime)}` : ""}`;
  if (!booking.endDate) return start;
  const sameDay = booking.endDate === booking.startDate;
  const end = `${sameDay ? "" : dayLabel(booking.endDate).replace(/ \(.\)$/, "")}${booking.endTime ? ` ${clock(booking.endTime)}` : ""}`.trim();
  return end ? `${start} – ${end}` : start;
}

export function cancelLabel(booking: Booking, today: string): string | null {
  if (!booking.cancelDate) return null;
  const until = booking.cancelTime ? ` ${clock(booking.cancelTime)}` : "";
  const left = daysBetween(today, booking.cancelDate);
  if (left < 0) return "무료 취소 기간이 지났어요";
  const day = left === 0 ? "오늘" : left === 1 ? "내일" : dayLabel(booking.cancelDate).replace(/ \(.\)$/, "");
  return `무료 취소 ${day}${until}까지`;
}

export type Deadline = { key: string; title: string; detail: string; value: string; bookingId: string };

/** What the overview shows first: free-cancel deadlines still open, then on-site payments. */
export function deadlines(trip: TripData, now: Date = new Date()): Deadline[] {
  const today = dateIn(trip.travel.timeZone, now);
  const cancel = trip.bookings
    .filter((booking) => booking.cancelDate && booking.cancelDate >= today)
    .sort((a, b) => (a.cancelDate ?? "").localeCompare(b.cancelDate ?? ""))
    .map((booking) => ({
      key: `cancel:${booking.id}`,
      title: `${booking.title} 무료 취소 마감`,
      detail: `${cancelLabel(booking, today)}${trip.travel.timeZone === HOME_ZONE ? " · 한국 시각" : ""}`,
      value: "예약 보기",
      bookingId: booking.id,
    }));
  const pay = trip.bookings
    .filter((booking) => booking.status !== "paid" && booking.amount > 0)
    .map((booking) => ({
      key: `pay:${booking.id}`,
      title: `${booking.title} ${booking.status === "onsite" ? "현장 결제" : "결제 남음"}`,
      detail: bookingPeriod(booking),
      value: formatAmount(booking.amount, booking.currency),
      bookingId: booking.id,
    }));
  return [...cancel, ...pay];
}

export type WidgetLine = { title: string; description: string; value: string; meta: string };

/** The nearest trip that is not finished: upcoming first, then one being wrapped up. */
export function widgetTrip<T extends { travel: TripData["travel"] }>(trips: T[], now: Date = new Date()): T | undefined {
  const open = trips.filter((trip) => travelStage(trip.travel, now) !== "done");
  const active = open
    .filter((trip) => travelStage(trip.travel, now) !== "wrapping")
    .sort((a, b) => a.travel.startDate.localeCompare(b.travel.startDate));
  return active[0] ?? open.sort((a, b) => b.travel.endDate.localeCompare(a.travel.endDate))[0];
}

export function widgetLine(
  trip: TripData | undefined,
  envelope: { completed: number; total: number } | null,
  now: Date = new Date(),
): WidgetLine {
  if (!trip) return { title: "다가오는 여행이 없어요", description: "누르면 여행 창에서 새 여행을 만들어요", value: "", meta: "" };
  const { travel } = trip;
  const stage = travelStage(travel, now);
  const summary = costSummary(trip);
  const today = dateIn(travel.timeZone, now);
  if (stage === "traveling") {
    const nowAt = now.getTime();
    const next = plansOn(trip.plans, today).find(
      (plan) => plan.time && instant(plan.date, plan.time, plan.departZone ?? travel.timeZone) > nowAt,
    );
    const nights = daysBetween(travel.startDate, travel.endDate);
    const minutes = next?.time
      ? Math.round((instant(next.date, next.time, next.departZone ?? travel.timeZone) - nowAt) / 60_000)
      : 0;
    return {
      title: next?.time ? `${next.kind === "move" ? "다음 이동" : "다음 일정"} · ${clock(next.time)}` : travel.title,
      description: next
        ? `${next.title} · ${minutes < 60 ? `${minutes}분` : `${Math.floor(minutes / 60)}시간`} 뒤`
        : "오늘 남은 일정이 없어요",
      value: countdown(travel, now),
      meta: nights ? `${nights}박 ${nights + 1}일` : "당일",
    };
  }
  if (stage === "wrapping") {
    const settlements = settle(trip).length;
    return {
      title: `${travel.title} 정리`,
      description: [`사진 ${trip.photos.length}장`, settlements ? `정산 ${settlements}건` : ""]
        .filter(Boolean)
        .join(" · "),
      value: "정리",
      meta: `남은 것 ${settlements + (trip.photos.length ? 0 : 1)}`,
    };
  }
  const soon = trip.bookings.find((booking) => booking.cancelDate === today);
  const unpaid = trip.bookings.filter((booking) => booking.status === "unpaid").length;
  const parts =
    stage === "planning"
      ? [unpaid ? `예약 ${unpaid}개 결제 남음` : "", summary.budgetPercent !== null ? `예산 ${summary.budgetPercent}%` : ""]
      : [envelope ? `준비 ${envelope.completed}/${envelope.total}` : "", soon ? "취소 마감 오늘" : ""];
  return {
    title: travel.title,
    description: parts.filter(Boolean).join(" · ") || periodLabel(travel),
    value: countdown(travel, now),
    meta: "출발까지",
  };
}

/** Where an imported photo belongs: the trip's local date and the plan within 300 m. */
export function placePhoto(
  meta: { path: string; takenAt?: string | null; offsetMinutes?: number | null; lat?: number | null; lng?: number | null },
  trip: TripData,
  thumb?: string,
): Partial<Photo> & { path: string } {
  let takenAt = meta.takenAt ?? undefined;
  if (takenAt && typeof meta.offsetMinutes === "number") {
    // The camera's clock had a known offset, so the moment can be moved into the trip's zone.
    const utc = Date.parse(`${takenAt}:00Z`) - meta.offsetMinutes * 60_000;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: trip.travel.timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(new Date(utc));
    const part = (type: string) => parts.find((value) => value.type === type)?.value ?? "";
    takenAt = `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
  }
  const at = fromMicro(meta.lat ?? undefined, meta.lng ?? undefined);
  return {
    path: meta.path,
    ...(thumb ? { thumb } : {}),
    ...(takenAt ? { takenAt, date: takenAt.slice(0, 10) } : {}),
    ...(at ? { lat: meta.lat ?? undefined, lng: meta.lng ?? undefined } : {}),
    ...(at ? { planId: nearestPlan(at, trip.plans)?.id } : {}),
  };
}

/** The trip page exported to the data folder. Booking numbers keep only the last four. */
export function tripPage(trip: TripData): string {
  const { travel } = trip;
  const lines = [
    `# ${travel.title}`,
    "",
    `${periodLabel(travel)}${travel.destination ? ` · ${travel.destination}` : ""} · ${
      travel.timeZone === HOME_ZONE ? "한국 시각" : `그곳 시각 (${zoneNote(travel.timeZone)})`
    } · ${STAGE_LABELS[travelStage(travel)]}`,
    "",
    "## 날짜별 일정",
  ];
  for (const date of travelDays(travel, trip.plans)) {
    const plans = plansOn(trip.plans, date);
    lines.push("", `### ${ordinalDay(travel, date)} · ${dayLabel(date)}`);
    if (!plans.length) lines.push("- 적은 일정이 없어요");
    for (const plan of plans) {
      const extra = [plan.place, plan.memo.split("\n")[0]].filter(Boolean).join(" · ");
      lines.push(`- ${plan.time ? `${clock(plan.time)} ` : ""}${plan.title}${extra ? ` — ${extra}` : ""}`);
    }
  }
  if (trip.bookings.length) {
    lines.push("", "## 예약");
    for (const booking of trip.bookings) {
      const number = maskConfirmation(booking.confirmation);
      lines.push(
        `- ${kindLabel(booking.kind)} · ${booking.title} — ${bookingPeriod(booking)} · ${STATUS_LABELS[booking.status]}${
          booking.amount ? ` ${formatAmount(booking.amount, booking.currency)}` : ""
        }${number ? ` · 예약번호 ${number}` : ""}`,
      );
    }
  }
  const summary = costSummary(trip);
  lines.push("", "## 비용", "", `- 결제한 돈 ${won(summary.paid)}${travel.budget ? ` / 예산 ${won(travel.budget)}` : ""}`);
  if (summary.onsiteCount) lines.push(`- 현장에서 낼 돈 ${won(summary.onsite)} (${summary.onsiteCount}건)`);
  lines.push(`- 1인당 ${won(summary.perPerson)}`);
  for (const item of settle(trip)) {
    lines.push(`- 정산: ${personName(trip, item.from)} → ${personName(trip, item.to)} ${won(item.amount)}`);
  }
  if (trip.people.length) {
    lines.push("", "## 함께 간 사람", "", `- 나, ${trip.people.map((person) => person.name).join(", ")}`);
  }
  if (trip.photos.length) {
    lines.push("", "## 사진", "");
    const cover = trip.photos.find((photo) => photo.cover);
    if (cover) lines.push(`- 대표 사진: ${cover.path}`);
    const byDay = new Map<string, number>();
    for (const photo of trip.photos) byDay.set(photo.date ?? "날짜 없음", (byDay.get(photo.date ?? "날짜 없음") ?? 0) + 1);
    for (const [date, count] of byDay) lines.push(`- ${date === "날짜 없음" ? date : dayLabel(date)}: ${count}장`);
    lines.push("", "원본은 처음 있던 자리에 그대로 있어요.");
  }
  return `${lines.join("\n")}\n`;
}
