import type { ReactElement } from "react";
import { Button, TripInfoRow } from "@comet/ui";
import { won } from "../Planner/diaryLedgerData";
import { clock, dateIn, daysBetween, ordinalDay, plansOn, travelStage } from "./travelData";
import { costSummary } from "./travelMoney";
import { deadlines } from "./travelSummary";
import { MapSketch } from "./TravelMap";
import { planDetail } from "./TravelSchedule";
import type { TravelStage, TravelTab, TripData } from "./travelTypes";
import * as s from "./travel.css";

const HEADINGS: Record<TravelStage, [string, string]> = {
  planning: ["여행 계획을 채워요", "예산 대비 남은 예약과 날짜별 일정을 채워 가요."],
  before: ["다녀올 준비를 한눈에", "가까운 마감과 첫 이동부터 확인해요."],
  traveling: ["오늘의 여행", "다음 이동과 오늘 일정, 빠른 지출을 먼저 보여 드려요."],
  wrapping: ["다녀온 여행 정리", "사진과 비용을 정리하고 여행 페이지를 만들어요."],
  done: ["다녀온 여행", "지난 여행이에요. 기록은 그대로 남아 있어요."],
};

export function TravelOverview({
  trip,
  days,
  envelope,
  busy,
  onOpen,
  onOpenDay,
  onOpenBooking,
  onOpenEnvelope,
  onFinish,
  onExport,
}: {
  trip: TripData;
  days: string[];
  envelope: { title: string; completed: number; total: number } | null;
  busy: boolean;
  onOpen: (tab: TravelTab) => void;
  onOpenDay: (date: string) => void;
  onOpenBooking: (id: string) => void;
  onOpenEnvelope: () => void;
  onFinish: (finished: boolean) => void;
  onExport: () => void;
}): ReactElement {
  const { travel } = trip;
  const stage = travelStage(travel);
  const today = dateIn(travel.timeZone);
  const focusDay = stage === "traveling" ? today : travel.startDate;
  const upcoming = plansOn(trip.plans, focusDay).slice(0, 3);
  const nights = daysBetween(travel.startDate, travel.endDate);
  const summary = costSummary(trip);
  const near = deadlines(trip).slice(0, 2);
  const [heading, caption] = HEADINGS[stage];
  const wrapping = stage === "wrapping" || stage === "done";
  return (
    <>
      <div className={s.heading}>
        <h2 className={s.pageTitle}>{heading}</h2>
        <p className={s.caption}>{caption}</p>
      </div>
      <TripInfoRow
        className={s.row}
        title={
          summary.budgetPercent !== null
            ? `예산의 ${summary.budgetPercent}%를 썼어요`
            : summary.paid
              ? `${won(summary.paid)} 결제했어요`
              : "아직 결제한 돈이 없어요"
        }
        detail={[
          `결제한 돈 ${won(summary.paid)}${travel.budget ? ` / 예산 ${won(travel.budget)}` : ""}`,
          nights ? `${nights}박 ${nights + 1}일` : "당일",
        ].join(" · ")}
        value={envelope ? `준비 ${envelope.completed}/${envelope.total}` : undefined}
        onClick={() => onOpen("costs")}
      />
      <div className={s.columns}>
        <MapSketch trip={trip} days={days} compact />
        <section className={s.list} aria-label={wrapping ? "정리할 것" : "가까운 마감과 일정"}>
          {near.map((item) => (
            <TripInfoRow
              key={item.key}
              className={s.row}
              title={item.title}
              detail={item.detail}
              value={item.value}
              onClick={() => onOpenBooking(item.bookingId)}
            />
          ))}
          {!near.length &&
            upcoming.map((plan) => (
              <TripInfoRow
                key={plan.id}
                className={s.row}
                title={`${plan.time ? `${clock(plan.time)}  ` : ""}${plan.title}`}
                detail={planDetail(plan, travel) || ordinalDay(travel, plan.date)}
                value={plan.kind === "move" ? "이동" : undefined}
                onClick={() => onOpenDay(plan.date)}
              />
            ))}
          {!near.length && !upcoming.length && (
            <p className={s.caption}>가까운 마감과 {ordinalDay(travel, focusDay)} 일정이 아직 없어요.</p>
          )}
          {envelope && (
            <TripInfoRow
              className={s.row}
              title={`준비 봉투 · ${envelope.title}`}
              detail="짐과 할 일은 준비 봉투에서 챙겨요."
              value={`${envelope.completed}/${envelope.total}`}
              onClick={onOpenEnvelope}
            />
          )}
        </section>
      </div>
      {!trip.plans.some((plan) => plan.lat !== undefined) && <p className={s.caption}>장소에 위치를 붙이면 여기에 그린 지도가 생겨요.</p>}
      <div className={s.actions}>
        {wrapping ? (
          <>
            <Button disabled={busy} onClick={() => onOpen("photos")}>
              사진 정리 · {trip.photos.length}장
            </Button>
            <Button variant="ghost" disabled={busy} onClick={onExport}>
              여행 페이지 만들기
            </Button>
            {stage === "wrapping" ? (
              <Button variant="ghost" disabled={busy} onClick={() => onFinish(true)}>
                정리 마치기
              </Button>
            ) : (
              <Button variant="ghost" disabled={busy} onClick={() => onFinish(false)}>
                다시 정리하기
              </Button>
            )}
          </>
        ) : (
          <>
            <Button onClick={() => onOpen("bookings")}>예약 {trip.bookings.length}건 보기</Button>
            <Button variant="ghost" onClick={() => onOpenDay(focusDay)}>
              {stage === "traveling" ? "오늘 일정" : "첫날 일정"}
            </Button>
            <Button variant="ghost" onClick={() => onOpen("map")}>
              지도 크게 보기
            </Button>
          </>
        )}
      </div>
      {!envelope && <p className={s.caption}>연결한 준비 봉투가 없어요. 고치기에서 고를 수 있어요.</p>}
    </>
  );
}
