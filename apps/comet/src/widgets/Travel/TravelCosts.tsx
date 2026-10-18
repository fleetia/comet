import type { ReactElement } from "react";
import { Button, TripInfoRow } from "@comet/ui";
import { won } from "../Planner/diaryLedgerData";
import { dayLabel } from "./travelData";
import { costSummary, formatAmount, personName, settle, toWon } from "./travelMoney";
import type { Expense, Transfer, TripData } from "./travelTypes";
import * as s from "./travel.css";

export function TravelCosts({
  trip,
  busy,
  onAdd,
  onEdit,
  onSent,
  onUndoSent,
}: {
  trip: TripData;
  busy: boolean;
  onAdd: () => void;
  onEdit: (expense: Expense) => void;
  onSent: (from: string, to: string, amount: number) => void;
  onUndoSent: (transfer: Transfer) => void;
}): ReactElement {
  const summary = costSummary(trip);
  const settlements = settle(trip);
  const onsite = trip.expenses.filter((expense) => !expense.paid);
  const people = trip.people.length + 1;
  const expenses = [...trip.expenses].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <>
      <div className={s.heading}>
        <h2 className={s.pageTitle}>비용과 정산</h2>
        <p className={s.caption}>결제한 돈과 현장에서 낼 돈을 나눠 보여요.</p>
      </div>
      <TripInfoRow
        className={s.row}
        title={`${won(summary.paid)} 결제했어요`}
        detail={[
          trip.travel.budget ? `예산 ${won(trip.travel.budget)}` : "예산 없음",
          summary.budgetPercent !== null ? `${summary.budgetPercent}%` : "",
          `${people}명 · 1인당 ${won(summary.perPerson)}`,
        ]
          .filter(Boolean)
          .join(" · ")}
        value={summary.remaining !== null ? `남은 예산 ${won(summary.remaining)}` : undefined}
      />
      {onsite.length > 0 && (
        <TripInfoRow
          className={s.row}
          title="현장에서 낼 돈"
          detail={`${onsite.map((expense) => expense.title).slice(0, 2).join(", ")}${
            onsite.length > 2 ? ` 외 ${onsite.length - 2}건` : ""
          } · 아직 결제한 돈에 포함하지 않았어요.`}
          value={won(summary.onsite)}
        />
      )}
      <section className={s.list} aria-label="정산">
        <h3 className={s.sectionTitle}>정산</h3>
        {settlements.map((item) => (
          <div key={`${item.from}:${item.to}`} className={s.settleRow}>
            <TripInfoRow
              className={s.row}
              title={`${personName(trip, item.from)} → ${personName(trip, item.to)}`}
              detail="함께 쓴 돈 중 보낼 몫"
              value={`${won(item.amount)} · 보낼 돈`}
            />
            <Button size="small" disabled={busy} onClick={() => onSent(item.from, item.to, item.amount)}>
              보냄 표시
            </Button>
          </div>
        ))}
        {trip.transfers.map((transfer) => (
          <div key={transfer.id} className={s.settleRow}>
            <TripInfoRow
              className={s.row}
              title={`${personName(trip, transfer.from)} → ${personName(trip, transfer.to)}`}
              detail={`${dayLabel(transfer.date)} 보낸 금액을 표시했어요.`}
              value={`${won(transfer.amount)} · 보냄`}
            />
            <Button variant="ghost" size="small" disabled={busy} onClick={() => onUndoSent(transfer)}>
              되돌리기
            </Button>
          </div>
        ))}
        {!settlements.length && !trip.transfers.length && (
          <p className={s.caption}>
            {trip.people.length ? "보낼 돈이 없어요." : "함께 가는 사람을 적으면 누가 누구에게 보낼지 알려 드려요."}
          </p>
        )}
      </section>
      <section className={s.list} aria-label="비용 목록">
        <h3 className={s.sectionTitle}>쓴 돈 {trip.expenses.length}건</h3>
        {expenses.map((expense) => (
          <TripInfoRow
            key={expense.id}
            className={s.row}
            title={expense.title}
            detail={[
              dayLabel(expense.date),
              `${personName(trip, expense.payer)} 냄`,
              expense.paid ? "" : "현장 결제",
              expense.bookingId ? "예약" : "",
            ]
              .filter(Boolean)
              .join(" · ")}
            value={
              expense.currency === "KRW"
                ? won(expense.amount)
                : `${formatAmount(expense.amount, expense.currency)} · ${won(toWon(expense.amount, expense.currency, expense.rate))}`
            }
            disabled={busy}
            onClick={() => onEdit(expense)}
          />
        ))}
      </section>
      <div className={s.actions}>
        <Button disabled={busy} onClick={onAdd}>
          쓴 돈 적기
        </Button>
      </div>
      <p className={s.caption}>송금을 마친 뒤 보냄으로 표시해요. 가계부에는 결제한 비용 중 내 몫만 들어가요.</p>
    </>
  );
}
