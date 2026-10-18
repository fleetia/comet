import { useState, type ReactElement } from "react";
import { Button, Dialog, FormField, Select, TextInput, Textarea } from "@comet/ui";
import { command, errorText } from "../../hooks/useSnapshot";
import type { DataRecord } from "../toolData";
import type { DiaryLedgerCategory } from "../Planner/diaryLedgerTypes";
import { ZONES } from "./TravelEditor";
import { BOOKING_KINDS, STATUS_LABELS } from "./travelSummary";
import {
  CURRENCIES,
  amountText,
  lastRate,
  parseAmount,
  parseRate,
  rateText,
} from "./travelMoney";
import type { Booking, TripData, Voucher } from "./travelTypes";
import * as s from "./travel.css";

/** Fields an AI draft may fill; everything stays editable and nothing is saved until 저장. */
export type BookingDraft = Partial<Record<keyof Booking, string>> & { voucher?: Voucher };

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function draftValue(value: string | undefined, pattern: RegExp): string {
  return value && pattern.test(value) ? value : "";
}

export function TravelBookingEditor({
  trip,
  booking,
  draft,
  categories,
  busy,
  today,
  onSave,
  onDelete,
  onClose,
}: {
  trip: TripData;
  booking?: Booking;
  draft?: BookingDraft;
  categories: DiaryLedgerCategory[];
  busy: boolean;
  today: string;
  onSave: (input: DataRecord) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
  onClose: () => void;
}): ReactElement {
  const { travel } = trip;
  const initialKind =
    (BOOKING_KINDS.find((value) => value.value === draft?.kind)?.value ?? booking?.kind) || "stay";
  const initialCurrency =
    booking?.currency ?? (draft?.currency && /^[A-Z]{3}$/.test(draft.currency) ? draft.currency : travel.currency);
  const [kind, setKind] = useState<Booking["kind"]>(initialKind);
  const [title, setTitle] = useState(booking?.title ?? draft?.title ?? "");
  const [vendor, setVendor] = useState(booking?.vendor ?? draft?.vendor ?? "");
  const [confirmation, setConfirmation] = useState(booking?.confirmation ?? draft?.confirmation ?? "");
  const [status, setStatus] = useState<Booking["status"]>(
    booking?.status ?? (draft?.status && draft.status in STATUS_LABELS ? (draft.status as Booking["status"]) : "paid"),
  );
  const [paidDate, setPaidDate] = useState(booking?.paidDate ?? today);
  const [currency, setCurrency] = useState(initialCurrency);
  const [amount, setAmount] = useState(
    booking ? (booking.amount ? amountText(booking.amount, booking.currency) : "") : (draft?.amount ?? ""),
  );
  const [rate, setRate] = useState(() => {
    const known = booking?.rate ?? lastRate(trip, initialCurrency);
    return known ? rateText(known) : "";
  });
  const [category, setCategory] = useState(
    booking?.category ??
      (BOOKING_KINDS.find((value) => value.value === initialKind)?.category ?? categories[0]?.id ?? "other"),
  );
  const [startDate, setStartDate] = useState(
    booking?.startDate ?? (draftValue(draft?.startDate, DATE) || travel.startDate),
  );
  const [startTime, setStartTime] = useState(booking?.startTime ?? draftValue(draft?.startTime, TIME));
  const [startZone, setStartZone] = useState(booking?.startZone ?? "");
  const [endDate, setEndDate] = useState(booking?.endDate ?? draftValue(draft?.endDate, DATE));
  const [endTime, setEndTime] = useState(booking?.endTime ?? draftValue(draft?.endTime, TIME));
  const [endZone, setEndZone] = useState(booking?.endZone ?? "");
  const [place, setPlace] = useState(booking?.place ?? draft?.place ?? "");
  const [destination, setDestination] = useState(booking?.destination ?? draft?.destination ?? "");
  const [cancelDate, setCancelDate] = useState(booking?.cancelDate ?? draftValue(draft?.cancelDate, DATE));
  const [cancelTime, setCancelTime] = useState(booking?.cancelTime ?? draftValue(draft?.cancelTime, TIME));
  const [link, setLink] = useState(
    booking?.link ?? (draft?.link && /^https?:\/\//.test(draft.link) ? draft.link : ""),
  );
  const [memo, setMemo] = useState(booking?.memo ?? "");
  const [vouchers, setVouchers] = useState<Voucher[]>(
    booking?.vouchers ?? (draft?.voucher ? [draft.voucher] : []),
  );
  const [attaching, setAttaching] = useState(false);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const moving = ["flight", "train", "bus", "car"].includes(kind);
  const caption = booking ? "예약 고치기" : draft ? "확인서로 만든 예약 초안" : "예약 더하기";
  const zones = [["", "여행 시간대"], ...ZONES.filter(([zone]) => zone !== travel.timeZone)];

  function chooseCurrency(next: string): void {
    setCurrency(next);
    const known = lastRate(trip, next);
    if (known) setRate(rateText(known));
    else if (next !== currency) setRate("");
  }

  async function attach(): Promise<void> {
    setAttaching(true);
    try {
      const added = await command<Voucher[]>("travel_attach_vouchers", { travelId: travel.id });
      setVouchers((current) => [...current, ...added].slice(0, 20));
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setAttaching(false);
    }
  }

  async function save(): Promise<void> {
    const minor = amount.trim() ? parseAmount(amount, currency) : 0;
    if (!title.trim()) return setError("예약 이름을 적어 주세요.");
    if (minor === null) return setError(`금액은 ${currency === "KRW" ? "원 단위 숫자" : "숫자(소수점 둘째 자리까지)"}로 적어 주세요.`);
    const rateValue = currency === "KRW" ? 10_000 : parseRate(rate);
    if (minor && rateValue === null) return setError("환율을 적어 주세요. 1단위가 몇 원인지 입력해요.");
    if (endTime && !endDate) return setError("끝나는 시각에는 날짜가 필요해요.");
    if (cancelTime && !cancelDate) return setError("무료 취소 마감 시각에는 날짜가 필요해요.");
    setError("");
    const input: DataRecord = {
      travelId: travel.id,
      kind,
      title,
      vendor,
      confirmation,
      status,
      paidDate: status === "paid" ? paidDate : null,
      amount: minor,
      currency,
      rate: rateValue ?? 10_000,
      category,
      startDate,
      startTime,
      startZone: startZone || null,
      endDate: endDate || null,
      endTime,
      endZone: endZone || null,
      place,
      destination: moving ? destination : "",
      cancelDate: cancelDate || null,
      cancelTime,
      link: link.trim(),
      memo,
      vouchers,
      ...(booking ? { id: booking.id, expected: booking } : {}),
    };
    if (await onSave(input)) onClose();
  }

  return (
    <>
      <Dialog
        isOpen
        size="large"
        title={caption}
        closeLabel={`${caption} 닫기`}
        onOpenChange={(open) => {
          if (!open && !busy) onClose();
        }}
      >
        <form
          className={s.form}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {draft && (
            <p className={s.caption}>
              AI가 확인서에서 읽은 값이에요. 금액·날짜·예약번호를 확인한 뒤 저장해야 기록돼요.
            </p>
          )}
          <div className={s.fieldRow}>
            <FormField label="종류">
              <Select
                value={kind}
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.value as Booking["kind"];
                  setKind(next);
                  if (!booking) {
                    const preset = BOOKING_KINDS.find((value) => value.value === next)?.category;
                    if (preset && categories.some((value) => value.id === preset)) setCategory(preset);
                  }
                }}
              >
                {BOOKING_KINDS.map((value) => (
                  <option key={value.value} value={value.value}>
                    {value.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="이름" required>
              <TextInput
                value={title}
                maxLength={200}
                placeholder={moving ? "가는 항공 · 김포 → 제주" : "애월 숙소"}
                disabled={busy}
                onChange={(event) => setTitle(event.target.value)}
              />
            </FormField>
          </div>
          <div className={s.fieldRow}>
            <FormField label="예약한 곳">
              <TextInput
                value={vendor}
                maxLength={200}
                disabled={busy}
                onChange={(event) => setVendor(event.target.value)}
              />
            </FormField>
            <FormField label="예약번호" description="화면에는 끝 4자리만 보여요.">
              <TextInput
                value={confirmation}
                maxLength={100}
                autoComplete="off"
                disabled={busy}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </FormField>
          </div>
          <div className={s.fieldRow}>
            <FormField label={moving ? "출발" : kind === "stay" ? "체크인" : "시작"}>
              <div className={s.inline}>
                <TextInput
                  type="date"
                  aria-label="시작 날짜"
                  value={startDate}
                  disabled={busy}
                  onChange={(event) => event.target.value && setStartDate(event.target.value)}
                />
                <TextInput
                  type="time"
                  aria-label="시작 시각"
                  value={startTime}
                  disabled={busy}
                  onChange={(event) => setStartTime(event.target.value)}
                />
              </div>
            </FormField>
            <FormField label={moving ? "도착" : kind === "stay" ? "체크아웃" : "끝"}>
              <div className={s.inline}>
                <TextInput
                  type="date"
                  aria-label="끝 날짜"
                  value={endDate}
                  min={startDate}
                  disabled={busy}
                  onChange={(event) => setEndDate(event.target.value)}
                />
                <TextInput
                  type="time"
                  aria-label="끝 시각"
                  value={endTime}
                  disabled={busy}
                  onChange={(event) => setEndTime(event.target.value)}
                />
              </div>
            </FormField>
          </div>
          {moving && (
            <div className={s.fieldRow}>
              <FormField label="출발지 시간대">
                <Select value={startZone} disabled={busy} onChange={(event) => setStartZone(event.target.value)}>
                  {zones.map(([zone, name]) => (
                    <option key={zone} value={zone}>
                      {name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="도착지 시간대">
                <Select value={endZone} disabled={busy} onChange={(event) => setEndZone(event.target.value)}>
                  {zones.map(([zone, name]) => (
                    <option key={zone} value={zone}>
                      {name}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
          )}
          <div className={s.fieldRow}>
            <FormField label={moving ? (kind === "car" ? "받는 곳" : "출발지") : "장소·주소"}>
              <TextInput value={place} maxLength={300} disabled={busy} onChange={(event) => setPlace(event.target.value)} />
            </FormField>
            {moving ? (
              <FormField label={kind === "car" ? "반납하는 곳" : "도착지"}>
                <TextInput
                  value={destination}
                  maxLength={300}
                  disabled={busy}
                  onChange={(event) => setDestination(event.target.value)}
                />
              </FormField>
            ) : (
              <FormField label="확인 링크">
                <TextInput type="url" value={link} maxLength={2000} disabled={busy} onChange={(event) => setLink(event.target.value)} />
              </FormField>
            )}
          </div>
          <div className={s.fieldRow}>
            <FormField label="결제">
              <Select
                value={status}
                disabled={busy}
                onChange={(event) => setStatus(event.target.value as Booking["status"])}
              >
                {Object.entries(STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
            {status === "paid" ? (
              <FormField label="결제한 날" description="가계부에는 이 날짜로 내 몫이 들어가요.">
                <TextInput type="date" value={paidDate} disabled={busy} onChange={(event) => event.target.value && setPaidDate(event.target.value)} />
              </FormField>
            ) : (
              <FormField label="가계부" description="결제 완료로 바꾸면 내 몫이 가계부에 들어가요.">
                <span className={s.caption}>아직 기록하지 않아요</span>
              </FormField>
            )}
          </div>
          <div className={s.fieldRow3}>
            <FormField label="금액">
              <TextInput
                inputMode="decimal"
                value={amount}
                maxLength={20}
                placeholder="0 · 없음"
                disabled={busy}
                onChange={(event) => setAmount(event.target.value)}
              />
            </FormField>
            <FormField label="결제 통화">
              <Select value={currency} disabled={busy} onChange={(event) => chooseCurrency(event.target.value)}>
                {(CURRENCIES.includes(currency) ? CURRENCIES : [...CURRENCIES, currency]).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="환율 (1단위 = 원)">
              <TextInput
                inputMode="decimal"
                value={currency === "KRW" ? "1" : rate}
                disabled={busy || currency === "KRW"}
                placeholder="예: 9.12"
                onChange={(event) => setRate(event.target.value)}
              />
            </FormField>
          </div>
          <div className={s.fieldRow}>
            <FormField label="가계부 분류">
              <Select value={category} disabled={busy} onChange={(event) => setCategory(event.target.value)}>
                {categories.map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="무료 취소 마감" description="하루 전 저녁에 한 번 알려 드려요.">
              <div className={s.inline}>
                <TextInput
                  type="date"
                  aria-label="무료 취소 마감 날짜"
                  value={cancelDate}
                  disabled={busy}
                  onChange={(event) => setCancelDate(event.target.value)}
                />
                <TextInput
                  type="time"
                  aria-label="무료 취소 마감 시각"
                  value={cancelTime}
                  disabled={busy}
                  onChange={(event) => setCancelTime(event.target.value)}
                />
              </div>
            </FormField>
          </div>
          {moving && (
            <FormField label="확인 링크">
              <TextInput type="url" value={link} maxLength={2000} disabled={busy} onChange={(event) => setLink(event.target.value)} />
            </FormField>
          )}
          <FormField label="메모">
            <Textarea value={memo} rows={2} maxLength={2000} disabled={busy} onChange={(event) => setMemo(event.target.value)} />
          </FormField>
          <section className={s.list} aria-label="바우처">
            <h3 className={s.sectionTitle}>바우처 {vouchers.length}개</h3>
            {vouchers.map((voucher) => (
              <div key={voucher.id} className={s.inline}>
                <span className={s.grow}>{voucher.name}</span>
                <Button
                  variant="ghost"
                  size="small"
                  disabled={busy}
                  onClick={() => setVouchers((current) => current.filter((value) => value.id !== voucher.id))}
                >
                  빼기
                </Button>
              </div>
            ))}
            <div>
              <Button variant="ghost" size="small" disabled={busy || attaching || vouchers.length >= 20} onClick={() => void attach()}>
                {attaching ? "붙이는 중" : "PDF·이미지 붙이기"}
              </Button>
            </div>
          </section>
          {error && (
            <p role="alert" className={s.caption}>
              {error}
            </p>
          )}
          <div className={s.formActions}>
            {onDelete && (
              <Button variant="danger" className={s.deleteAction} disabled={busy} onClick={() => setDeleting(true)}>
                예약 지우기
              </Button>
            )}
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              취소
            </Button>
            <Button type="submit" disabled={busy}>
              저장
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        variant="confirm"
        isOpen={deleting}
        title="이 예약을 지울까요?"
        onOpenChange={setDeleting}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setDeleting(false)}>
              취소
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() =>
                void onDelete?.().then((done) => {
                  setDeleting(false);
                  if (done) onClose();
                })
              }
            >
              지우기
            </Button>
          </>
        }
      >
        <p className={s.caption}>이 예약에서 생긴 비용과 가계부 기록도 함께 지워져요. 붙인 바우처 파일은 정리돼요.</p>
      </Dialog>
    </>
  );
}
