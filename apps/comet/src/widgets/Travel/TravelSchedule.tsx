import type { ReactElement } from "react";
import { Button, TripInfoRow } from "@comet/ui";
import {
  HOME_ZONE,
  clock,
  dayLabel,
  duration,
  moveMinutes,
  ordinalDay,
  plansOn,
  zoneNote,
} from "./travelData";
import { formatAmount } from "./travelMoney";
import { kindLabel } from "./travelSummary";
import type { Booking, Travel, TravelPlan } from "./travelTypes";
import * as s from "./travel.css";

export function planDetail(plan: TravelPlan, travel: Travel): string {
  if (plan.kind === "move" && plan.arriveTime) {
    const minutes = moveMinutes(plan, travel);
    const nextDay = plan.arriveDate && plan.arriveDate !== plan.date ? `${dayLabel(plan.arriveDate)} ` : "";
    return [`도착 ${nextDay}${clock(plan.arriveTime)}`, minutes !== null && `이동 ${duration(minutes)}`, plan.place]
      .filter(Boolean)
      .join(" · ");
  }
  return [plan.place, plan.memo.split("\n")[0]].filter(Boolean).join(" · ");
}

export function planValue(plan: TravelPlan, bookings: Booking[]): string | undefined {
  const booking = bookings.find((value) => value.id === plan.bookingId);
  if (booking) {
    return booking.status !== "paid" && booking.amount
      ? formatAmount(booking.amount, booking.currency)
      : `${kindLabel(booking.kind)} 예약`;
  }
  return plan.kind === "move" ? "이동" : undefined;
}

export function TravelSchedule({
  travel,
  plans,
  bookings,
  days,
  date,
  busy,
  onSelectDay,
  onAdd,
  onEdit,
}: {
  travel: Travel;
  plans: TravelPlan[];
  bookings: Booking[];
  days: string[];
  date: string;
  busy: boolean;
  onSelectDay: (date: string) => void;
  onAdd: () => void;
  onEdit: (plan: TravelPlan) => void;
}): ReactElement {
  const at = days.indexOf(date);
  const previous = at > 0 ? days[at - 1] : undefined;
  const next = at >= 0 && at < days.length - 1 ? days[at + 1] : undefined;
  const list = plansOn(plans, date);
  const place = travel.destination || "여행지";
  return (
    <>
      <div className={s.heading}>
        <h2 className={s.pageTitle}>
          {ordinalDay(travel, date)} · {dayLabel(date)}
        </h2>
        <p className={s.caption}>
          모든 시각은 여행지 시각이에요.{" "}
          {travel.timeZone === HOME_ZONE
            ? `${place}와 한국의 시차는 없어요.`
            : `${place}는 ${zoneNote(travel.timeZone)}.`}
        </p>
      </div>
      <section className={s.list} aria-label={`${dayLabel(date)} 일정`}>
        {list.length ? (
          list.map((plan) => (
            <TripInfoRow
              key={plan.id}
              className={s.row}
              title={`${plan.time ? `${clock(plan.time)}  ` : ""}${plan.title}`}
              detail={planDetail(plan, travel) || undefined}
              value={planValue(plan, bookings)}
              disabled={busy}
              onClick={() => onEdit(plan)}
            />
          ))
        ) : (
          <p className={s.caption}>이날 일정이 아직 없어요.</p>
        )}
      </section>
      <div className={s.actions}>
        <Button disabled={busy} onClick={onAdd}>
          일정 더하기
        </Button>
        {previous && (
          <Button variant="ghost" onClick={() => onSelectDay(previous)}>
            {ordinalDay(travel, previous)} 일정
          </Button>
        )}
        {next && (
          <Button variant="ghost" onClick={() => onSelectDay(next)}>
            {ordinalDay(travel, next)} 일정
          </Button>
        )}
      </div>
    </>
  );
}
