import { useState, type ReactElement } from "react";
import { Button, Checkbox, Dialog, FormField, Select, TextInput, Textarea } from "@comet/ui";
import type { DataRecord } from "../toolData";
import type { DiaryLedgerCategory } from "../Planner/diaryLedgerTypes";
import {
  CURRENCIES,
  ME,
  amountText,
  lastRate,
  parseAmount,
  parseRate,
  personName,
  rateText,
  shareOf,
} from "./travelMoney";
import type { Expense, Share, TripData } from "./travelTypes";
import * as s from "./travel.css";

export function TravelExpenseEditor({
  trip,
  expense,
  categories,
  busy,
  today,
  onSave,
  onDelete,
  onClose,
}: {
  trip: TripData;
  expense?: Expense;
  categories: DiaryLedgerCategory[];
  busy: boolean;
  today: string;
  onSave: (input: DataRecord) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
  onClose: () => void;
}): ReactElement {
  const { travel } = trip;
  const linked = Boolean(expense?.bookingId);
  const everyone = [ME, ...trip.people.map((person) => person.id)];
  const [title, setTitle] = useState(expense?.title ?? "");
  const [date, setDate] = useState(expense?.date ?? (today >= travel.startDate && today <= travel.endDate ? today : travel.startDate));
  const [currency, setCurrency] = useState(expense?.currency ?? travel.currency);
  const [amount, setAmount] = useState(expense ? amountText(expense.amount, expense.currency) : "");
  const [rate, setRate] = useState(() => {
    const known = expense?.rate ?? lastRate(trip, expense?.currency ?? travel.currency);
    return known ? rateText(known) : "";
  });
  const [category, setCategory] = useState(expense?.category ?? categories[0]?.id ?? "other");
  const [paid, setPaid] = useState(expense?.paid ?? true);
  const [payer, setPayer] = useState(expense?.payer ?? ME);
  const [shares, setShares] = useState<Share[]>(
    expense?.shares ?? everyone.map((person) => ({ person, weight: 1 })),
  );
  const [memo, setMemo] = useState(expense?.memo ?? "");
  const [error, setError] = useState("");
  const caption = expense ? "비용 고치기" : "비용 더하기";
  const preview: Expense | null = (() => {
    const minor = parseAmount(amount, currency);
    const value = currency === "KRW" ? 10_000 : parseRate(rate);
    return minor && value ? { ...(expense ?? ({} as Expense)), amount: minor, currency, rate: value, shares } : null;
  })();

  function toggle(person: string, on: boolean): void {
    setShares((current) =>
      on ? [...current, { person, weight: 1 }] : current.filter((share) => share.person !== person),
    );
  }

  async function save(): Promise<void> {
    const minor = parseAmount(amount, currency);
    const rateValue = currency === "KRW" ? 10_000 : parseRate(rate);
    if (!title.trim()) return setError("무엇에 쓴 돈인지 적어 주세요.");
    if (!linked && !minor) return setError("금액을 숫자로 적어 주세요.");
    if (!linked && rateValue === null) return setError("환율을 적어 주세요. 1단위가 몇 원인지 입력해요.");
    if (!shares.length) return setError("나눌 사람을 한 명 이상 골라 주세요.");
    setError("");
    const input: DataRecord = {
      travelId: travel.id,
      title,
      date,
      amount: minor ?? expense?.amount ?? 0,
      currency,
      rate: rateValue ?? expense?.rate ?? 10_000,
      category,
      paid,
      payer,
      shares,
      memo,
      ...(expense ? { id: expense.id, expected: expense } : {}),
    };
    if (await onSave(input)) onClose();
  }

  return (
    <Dialog
      isOpen
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
        {linked && (
          <p className={s.caption}>예약에서 생긴 비용이에요. 금액·날짜·결제 여부는 예약에서 고쳐요.</p>
        )}
        <div className={s.fieldRow}>
          <FormField label="무엇에" required>
            <TextInput value={title} maxLength={200} placeholder="흑돼지 저녁" disabled={busy || linked} onChange={(event) => setTitle(event.target.value)} />
          </FormField>
          <FormField label="날짜">
            <TextInput type="date" value={date} disabled={busy || linked} onChange={(event) => event.target.value && setDate(event.target.value)} />
          </FormField>
        </div>
        <div className={s.fieldRow3}>
          <FormField label="금액">
            <TextInput inputMode="decimal" value={amount} maxLength={20} disabled={busy || linked} onChange={(event) => setAmount(event.target.value)} />
          </FormField>
          <FormField label="결제 통화">
            <Select
              value={currency}
              disabled={busy || linked}
              onChange={(event) => {
                const next = event.target.value;
                setCurrency(next);
                const known = lastRate(trip, next);
                setRate(known ? rateText(known) : "");
              }}
            >
              {(CURRENCIES.includes(currency) ? CURRENCIES : [...CURRENCIES, currency]).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="환율 (1단위 = 원)" description="입력한 환율은 이 기록에만 남아요.">
            <TextInput
              inputMode="decimal"
              value={currency === "KRW" ? "1" : rate}
              disabled={busy || linked || currency === "KRW"}
              onChange={(event) => setRate(event.target.value)}
            />
          </FormField>
        </div>
        <div className={s.fieldRow3}>
          <FormField label="결제">
            <Select value={paid ? "paid" : "onsite"} disabled={busy || linked} onChange={(event) => setPaid(event.target.value === "paid")}>
              <option value="paid">결제했어요</option>
              <option value="onsite">현장에서 낼 돈</option>
            </Select>
          </FormField>
          <FormField label="낸 사람">
            <Select value={payer} disabled={busy} onChange={(event) => setPayer(event.target.value)}>
              {everyone.map((person) => (
                <option key={person} value={person}>
                  {personName(trip, person)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField label="가계부 분류">
            <Select value={category} disabled={busy || linked} onChange={(event) => setCategory(event.target.value)}>
              {categories.map((value) => (
                <option key={value.id} value={value.id}>
                  {value.name}
                </option>
              ))}
            </Select>
          </FormField>
        </div>
        <fieldset className={s.list}>
          <legend className={s.sectionTitle}>나눌 사람과 몫</legend>
          {everyone.map((person) => {
            const share = shares.find((value) => value.person === person);
            return (
              <div key={person} className={s.inline}>
                <Checkbox
                  checked={Boolean(share)}
                  disabled={busy}
                  onChange={(event) => toggle(person, event.target.checked)}
                  label={personName(trip, person)}
                />
                <span className={s.grow} />
                {share && (
                  <>
                    <TextInput
                      type="number"
                      aria-label={`${personName(trip, person)} 몫`}
                      min={1}
                      max={100}
                      value={share.weight}
                      disabled={busy}
                      className={s.weight}
                      onChange={(event) => {
                        const weight = Math.max(1, Math.min(100, Number(event.target.value) || 1));
                        setShares((current) =>
                          current.map((value) => (value.person === person ? { ...value, weight } : value)),
                        );
                      }}
                    />
                    <span className={s.caption}>
                      {preview ? `${shareOf(preview, person).toLocaleString("ko-KR")}원` : ""}
                    </span>
                  </>
                )}
              </div>
            );
          })}
          <p className={s.caption}>가계부에는 결제한 비용 중 내 몫만 들어가요.</p>
        </fieldset>
        <FormField label="메모">
          <Textarea value={memo} rows={2} maxLength={2000} disabled={busy} onChange={(event) => setMemo(event.target.value)} />
        </FormField>
        {error && (
          <p role="alert" className={s.caption}>
            {error}
          </p>
        )}
        <div className={s.formActions}>
          {onDelete && !linked && (
            <Button
              variant="danger"
              className={s.deleteAction}
              disabled={busy}
              onClick={() => void onDelete().then((done) => done && onClose())}
            >
              지우기
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
  );
}
