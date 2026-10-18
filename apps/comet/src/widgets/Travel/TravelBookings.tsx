import { useEffect, useState, type ReactElement } from "react";
import { Button, TripInfoRow } from "@comet/ui";
import { command, errorText } from "../../hooks/useSnapshot";
import { HOME_ZONE, clock, dateIn, dayLabel, duration, instant } from "./travelData";
import { ZONES } from "./TravelEditor";
import { STATUS_LABELS, bookingPeriod, cancelLabel, kindLabel } from "./travelSummary";
import { formatAmount, maskConfirmation, toWon } from "./travelMoney";
import type { Booking, TripData } from "./travelTypes";
import * as s from "./travel.css";

function zoneName(zone: string | undefined, fallback: string): string {
  const value = zone ?? fallback;
  if (value === HOME_ZONE) return "한국 시각";
  return `${ZONES.find(([id]) => id === value)?.[1] ?? value} 시각`;
}

function price(booking: Booking): string {
  if (!booking.amount) return STATUS_LABELS[booking.status];
  const local = formatAmount(booking.amount, booking.currency);
  const krw = booking.currency === "KRW" ? "" : ` (약 ${toWon(booking.amount, booking.currency, booking.rate).toLocaleString("ko-KR")}원)`;
  return `${STATUS_LABELS[booking.status]} · ${local}${krw}`;
}

export function TravelBookings({
  trip,
  selectedId,
  busy,
  onSelect,
  onAdd,
  onDraft,
  onEdit,
  onFailure,
}: {
  trip: TripData;
  selectedId: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onDraft: () => void;
  onEdit: (booking: Booking) => void;
  onFailure: (message: string) => void;
}): ReactElement {
  const booking = trip.bookings.find((value) => value.id === selectedId);
  return booking ? (
    <BookingDetail
      trip={trip}
      booking={booking}
      busy={busy}
      onBack={() => onSelect("")}
      onEdit={() => onEdit(booking)}
      onFailure={onFailure}
    />
  ) : (
    <>
      <div className={s.heading}>
        <h2 className={s.pageTitle}>예약 {trip.bookings.length}건</h2>
        <p className={s.caption}>결제와 취소 마감을 한곳에서 확인해요.</p>
      </div>
      <section className={s.list} aria-label="예약 목록">
        {trip.bookings.length ? (
          [...trip.bookings]
            .sort((a, b) => `${a.startDate}${a.startTime ?? ""}`.localeCompare(`${b.startDate}${b.startTime ?? ""}`))
            .map((value) => (
              <TripInfoRow
                key={value.id}
                className={s.row}
                title={value.title.includes(kindLabel(value.kind)) ? value.title : `${kindLabel(value.kind)} · ${value.title}`}
                detail={[bookingPeriod(value), cancelLabel(value, dateIn(trip.travel.timeZone))]
                  .filter(Boolean)
                  .join(" · ")}
                value={value.amount ? `${STATUS_LABELS[value.status]} · ${formatAmount(value.amount, value.currency)}` : STATUS_LABELS[value.status]}
                onClick={() => onSelect(value.id)}
              />
            ))
        ) : (
          <p className={s.caption}>아직 예약이 없어요. 직접 적거나 확인서로 초안을 만들 수 있어요.</p>
        )}
      </section>
      <div className={s.actions}>
        <Button disabled={busy} onClick={onAdd}>
          예약 더하기
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onDraft}>
          확인서로 초안 만들기
        </Button>
      </div>
      <p className={s.footerRow}>
        <span />
        <span>초안은 설정한 AI가 확인서를 읽어 만들고, 저장하기 전에는 기록하지 않아요.</span>
      </p>
    </>
  );
}

function BookingDetail({
  trip,
  booking,
  busy,
  onBack,
  onEdit,
  onFailure,
}: {
  trip: TripData;
  booking: Booking;
  busy: boolean;
  onBack: () => void;
  onEdit: () => void;
  onFailure: (message: string) => void;
}): ReactElement {
  const [revealed, setRevealed] = useState(false);
  useEffect(() => {
    if (!revealed) return;
    // The full number shows briefly, then hides again on its own.
    const timer = window.setTimeout(() => setRevealed(false), 10_000);
    return () => window.clearTimeout(timer);
  }, [revealed]);
  const { travel } = trip;
  const moving = ["flight", "train", "bus"].includes(booking.kind);
  const startZone = booking.startZone ?? travel.timeZone;
  const minutes =
    booking.startTime && booking.endDate && booking.endTime
      ? Math.round(
          (instant(booking.endDate, booking.endTime, booking.endZone ?? travel.timeZone) -
            instant(booking.startDate, booking.startTime, startZone)) /
            60_000,
        )
      : null;
  const start = `${dayLabel(booking.startDate).replace(/ \(.\)$/, "")}${booking.startTime ? ` ${clock(booking.startTime)}` : ""}`;
  const what = moving ? "출발" : booking.kind === "stay" ? "체크인" : booking.kind === "car" ? "받기" : "";
  const end = booking.endDate
    ? `${booking.endDate === booking.startDate ? "" : `${dayLabel(booking.endDate).replace(/ \(.\)$/, "")} `}${booking.endTime ? clock(booking.endTime) : ""}`.trim()
    : "";
  const endWhat = moving ? "도착" : booking.kind === "stay" ? "체크아웃" : booking.kind === "car" ? "반납" : "끝";
  const nights =
    booking.kind === "stay" && booking.endDate
      ? Math.round((Date.parse(booking.endDate) - Date.parse(booking.startDate)) / 86_400_000)
      : 0;
  const open = (file: string) =>
    void command("travel_open_voucher", { travelId: travel.id, file }).catch((cause: unknown) =>
      onFailure(errorText(cause)),
    );
  return (
    <>
      <div className={s.heading}>
        <h2 className={s.pageTitle}>{booking.title}</h2>
        <p className={s.caption}>
          {[kindLabel(booking.kind), booking.vendor, travel.title, trip.people.length ? `${trip.people.length + 1}명` : ""]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <section className={s.list} aria-label="예약 상세">
        <TripInfoRow
          className={s.row}
          title={`${start}${what ? ` ${what}` : ""}`}
          detail={[
            end ? `${end} ${endWhat}` : "",
            minutes !== null && moving ? duration(minutes) : "",
            nights ? `${nights}박` : "",
          ]
            .filter(Boolean)
            .join(" · ") || undefined}
          value={zoneName(booking.startZone, travel.timeZone)}
        />
        <TripInfoRow
          className={s.row}
          title={booking.status === "paid" ? "미리 결제했어요" : booking.status === "onsite" ? "현장에서 결제해요" : "아직 결제하지 않았어요"}
          detail={
            booking.status === "paid"
              ? `${booking.paidDate ? `${dayLabel(booking.paidDate).replace(/ \(.\)$/, "")} 결제 · ` : ""}가계부에는 내 몫만 들어가요`
              : "아직 결제한 여행 비용에는 포함하지 않았어요."
          }
          value={booking.amount ? price(booking).replace(/^[^·]+· /, "") : "금액 없음"}
        />
        {booking.cancelDate ? (
          <TripInfoRow
            className={s.row}
            title={`무료 취소 · ${dayLabel(booking.cancelDate).replace(/ \(.\)$/, "")}${booking.cancelTime ? ` ${clock(booking.cancelTime)}` : ""}까지`}
            detail="취소 여부와 최종 조건은 예약한 곳에서 확인해요."
            value={cancelLabel(booking, dateIn(travel.timeZone))?.includes("오늘") ? "마감 오늘" : undefined}
          />
        ) : null}
        {(booking.place || booking.destination) && (
          <TripInfoRow
            className={s.row}
            title={moving ? `${booking.place || "출발지"} → ${booking.destination || "도착지"}` : booking.place}
            detail={booking.kind === "car" ? "정확한 주소는 예약 확인서에서 확인해요." : booking.memo.split("\n")[0] || undefined}
            value={kindLabel(booking.kind)}
          />
        )}
        <TripInfoRow
          className={s.row}
          title="예약번호"
          detail={booking.confirmation ? (revealed ? booking.confirmation : maskConfirmation(booking.confirmation)) : "적지 않았어요"}
          value="예약 정보"
        />
        {booking.vouchers.map((voucher) => (
          <TripInfoRow
            key={voucher.id}
            className={s.row}
            title={voucher.name}
            detail="바우처 · 이 컴퓨터의 데이터 폴더에만 있어요"
            value="열기"
            disabled={busy}
            onClick={() => open(voucher.file)}
          />
        ))}
      </section>
      <div className={s.actions}>
        {booking.confirmation && (
          <Button onClick={() => setRevealed((value) => !value)}>
            {revealed ? "예약번호 가리기" : "예약번호 보기"}
          </Button>
        )}
        <Button variant="ghost" onClick={onBack}>
          예약 목록으로
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onEdit}>
          예약 고치기
        </Button>
        {booking.link && (
          <Button
            variant="ghost"
            onClick={() =>
              void command("travel_open_link", { bookingId: booking.id }).catch((cause: unknown) =>
                onFailure(errorText(cause)),
              )
            }
          >
            확인 링크 열기
          </Button>
        )}
      </div>
      <p className={s.footerRow}>
        <span />
        <span>
          {booking.vouchers.length || booking.link
            ? `확인 링크 ${booking.link ? 1 : 0}개 · 바우처 ${booking.vouchers.length}개`
            : "등록된 확인 링크와 바우처가 없어요."}
        </span>
      </p>
    </>
  );
}
