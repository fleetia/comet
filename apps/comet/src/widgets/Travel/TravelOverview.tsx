import type { ReactElement } from "react";
import { Button, TripInfoRow } from "@comet/ui";
import { won } from "../Planner/diaryLedgerData";
import { clock, dateIn, daysBetween, ordinalDay, plansOn, travelStage } from "./travelData";
import { planDetail } from "./TravelSchedule";
import type { Travel, TravelPlan, TravelStage } from "./travelTypes";
import * as s from "./travel.css";

const HEADINGS: Record<TravelStage, [string, string]> = {
  planning: ["여행 계획을 채워요", "날짜별 일정을 먼저 적어 두면 준비가 쉬워져요."],
  before: ["다녀올 준비를 한눈에", "준비 봉투와 첫날 이동부터 확인해요."],
  traveling: ["오늘의 여행", "오늘 일정과 다음 이동을 먼저 보여 드려요."],
  wrapping: ["다녀온 여행 정리", "정리를 마치면 끝난 여행으로 옮겨요."],
  done: ["다녀온 여행", "지난 여행이에요. 일정은 그대로 남아 있어요."],
};

export function TravelOverview({
  travel,
  plans,
  envelope,
  busy,
  onOpenDay,
  onOpenEnvelope,
  onFinish,
}: {
  travel: Travel;
  plans: TravelPlan[];
  envelope: { title: string; completed: number; total: number } | null;
  busy: boolean;
  onOpenDay: (date: string) => void;
  onOpenEnvelope: () => void;
  onFinish: (finished: boolean) => void;
}): ReactElement {
  const stage = travelStage(travel);
  const today = dateIn(travel.timeZone);
  const focusDay = stage === "traveling" ? today : travel.startDate;
  const upcoming = plansOn(plans, focusDay).slice(0, 4);
  const days = daysBetween(travel.startDate, travel.endDate) + 1;
  const [heading, caption] = HEADINGS[stage];
  return (
    <>
      <div className={s.heading}>
        <h2 className={s.pageTitle}>{heading}</h2>
        <p className={s.caption}>{caption}</p>
      </div>
      <TripInfoRow
        className={s.row}
        title={travel.budget ? `예산 ${won(travel.budget)}` : "예산을 정하지 않았어요"}
        detail={`${days === 1 ? "당일" : `${days - 1}박 ${days}일`} · 결제는 ${travel.currency}`}
        value={envelope ? `준비 ${envelope.completed}/${envelope.total}` : undefined}
      />
      <section className={s.list} aria-label={`${ordinalDay(travel, focusDay)} 일정`}>
        <h3 className={s.sectionTitle}>{ordinalDay(travel, focusDay)} 일정</h3>
        {upcoming.length ? (
          upcoming.map((plan) => (
            <TripInfoRow
              key={plan.id}
              className={s.row}
              title={`${plan.time ? `${clock(plan.time)}  ` : ""}${plan.title}`}
              detail={planDetail(plan, travel)}
              value={plan.kind === "move" ? "이동" : undefined}
            />
          ))
        ) : (
          <p className={s.caption}>아직 적은 일정이 없어요.</p>
        )}
      </section>
      {envelope ? (
        <TripInfoRow
          className={s.row}
          title={`준비 봉투 · ${envelope.title}`}
          detail="짐과 할 일은 준비 봉투에서 챙겨요."
          value={`${envelope.completed}/${envelope.total}`}
          onClick={onOpenEnvelope}
        />
      ) : (
        <p className={s.caption}>연결한 준비 봉투가 없어요. 여행 고치기에서 고를 수 있어요.</p>
      )}
      <div className={s.actions}>
        <Button onClick={() => onOpenDay(focusDay)}>
          {stage === "traveling" ? "오늘 일정" : "첫날 일정"}
        </Button>
        {stage === "wrapping" && (
          <Button variant="ghost" disabled={busy} onClick={() => onFinish(true)}>
            정리 마치기
          </Button>
        )}
        {stage === "done" && (
          <Button variant="ghost" disabled={busy} onClick={() => onFinish(false)}>
            다시 정리하기
          </Button>
        )}
      </div>
    </>
  );
}
