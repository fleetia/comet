import { useState, type ReactElement } from "react";
import { Button, Dialog, FormField, Select, TextInput } from "@comet/ui";
import { localDay, text, type DataRecord } from "../toolData";
import { envelopeTitle } from "../Planner/DiaryEnvelope";
import { HOME_ZONE, addDays, daysBetween, isTimeZone } from "./travelData";
import type { Travel } from "./travelTypes";
import * as s from "./travel.css";

export const ZONES: [string, string][] = [
  ["Asia/Seoul", "한국"],
  ["Asia/Tokyo", "일본"],
  ["Asia/Shanghai", "중국·대만"],
  ["Asia/Bangkok", "태국·베트남"],
  ["Asia/Singapore", "싱가포르·말레이시아"],
  ["Asia/Manila", "필리핀"],
  ["Australia/Sydney", "시드니"],
  ["Pacific/Guam", "괌·사이판"],
  ["Pacific/Honolulu", "하와이"],
  ["America/Los_Angeles", "미국 서부"],
  ["America/New_York", "미국 동부"],
  ["Europe/London", "영국"],
  ["Europe/Paris", "파리·서유럽"],
];
const CURRENCIES = ["KRW", "JPY", "USD", "EUR", "CNY", "TWD", "THB", "VND", "GBP", "AUD"];
export const NEW_ENVELOPE = "new";

export type TravelDraft = Omit<Travel, "id" | "finished" | "envelopeId"> & { envelopeId: string };

export function TravelEditor({
  travel,
  envelopes,
  busy,
  onSave,
  onDelete,
  onClose,
}: {
  travel?: Travel;
  envelopes: DataRecord[];
  busy: boolean;
  onSave: (draft: TravelDraft) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
  onClose: () => void;
}): ReactElement {
  const start = addDays(localDay(), 14);
  const [draft, setDraft] = useState<TravelDraft>(() => ({
    title: travel?.title ?? "",
    destination: travel?.destination ?? "",
    startDate: travel?.startDate ?? start,
    endDate: travel?.endDate ?? addDays(start, 1),
    timeZone: travel?.timeZone ?? HOME_ZONE,
    currency: travel?.currency ?? "KRW",
    budget: travel?.budget ?? 0,
    envelopeId: travel ? (travel.envelopeId ?? "") : NEW_ENVELOPE,
  }));
  const [budget, setBudget] = useState(draft.budget ? String(draft.budget) : "");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const zones = ZONES.some(([zone]) => zone === draft.timeZone)
    ? ZONES
    : [...ZONES, [draft.timeZone, draft.timeZone] as [string, string]];
  const caption = travel ? "여행 고치기" : "새 여행";
  function update(patch: Partial<TravelDraft>): void {
    setDraft((value) => ({ ...value, ...patch }));
  }
  async function save(): Promise<void> {
    const amount = Number(budget.replaceAll(",", "") || "0");
    if (!draft.title.trim()) return setError("여행 이름을 적어 주세요.");
    if (!Number.isSafeInteger(amount) || amount < 0) return setError("예산은 원 단위 숫자로 적어 주세요.");
    if (draft.endDate < draft.startDate) return setError("마지막 날은 첫날보다 빠를 수 없어요.");
    if (daysBetween(draft.startDate, draft.endDate) > 365) return setError("여행 기간은 1년 안으로 정해 주세요.");
    if (!isTimeZone(draft.timeZone)) return setError("시간대를 다시 골라 주세요.");
    setError("");
    if (await onSave({ ...draft, budget: amount })) onClose();
  }
  return (
    <>
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
          <FormField label="여행 이름" required>
            <TextInput
              value={draft.title}
              maxLength={100}
              placeholder="제주 가족 여행"
              disabled={busy}
              onChange={(event) => update({ title: event.target.value })}
            />
          </FormField>
          <FormField label="가는 곳">
            <TextInput
              value={draft.destination}
              maxLength={100}
              placeholder="제주"
              disabled={busy}
              onChange={(event) => update({ destination: event.target.value })}
            />
          </FormField>
          <div className={s.fieldRow}>
            <FormField label="첫날">
              <TextInput
                type="date"
                value={draft.startDate}
                disabled={busy}
                onChange={(event) => {
                  const next = event.target.value;
                  if (!next) return;
                  const span = daysBetween(draft.startDate, draft.endDate);
                  update({ startDate: next, endDate: addDays(next, Math.max(span, 0)) });
                }}
              />
            </FormField>
            <FormField label="마지막 날">
              <TextInput
                type="date"
                value={draft.endDate}
                min={draft.startDate}
                disabled={busy}
                onChange={(event) => event.target.value && update({ endDate: event.target.value })}
              />
            </FormField>
          </div>
          <div className={s.fieldRow}>
            <FormField label="그곳 시간대" description="일정은 이 시간대의 시각과 날짜로 적어요.">
              <Select
                value={draft.timeZone}
                disabled={busy}
                onChange={(event) => update({ timeZone: event.target.value })}
              >
                {zones.map(([zone, name]) => (
                  <option key={zone} value={zone}>
                    {name}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="결제 통화">
              <Select
                value={draft.currency}
                disabled={busy}
                onChange={(event) => update({ currency: event.target.value })}
              >
                {(CURRENCIES.includes(draft.currency)
                  ? CURRENCIES
                  : [...CURRENCIES, draft.currency]
                ).map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <FormField label="예산 (원)">
            <TextInput
              inputMode="numeric"
              value={budget}
              maxLength={16}
              placeholder="0 · 예산 없음"
              disabled={busy}
              onChange={(event) => setBudget(event.target.value)}
            />
          </FormField>
          <FormField label="준비 봉투" description="짐과 할 일은 준비 봉투에서 챙겨요.">
            <Select
              fill
              value={draft.envelopeId}
              disabled={busy}
              onChange={(event) => update({ envelopeId: event.target.value })}
            >
              {!travel && <option value={NEW_ENVELOPE}>새 봉투 만들기</option>}
              <option value="">연결 안 함</option>
              {envelopes.map((envelope) => (
                <option key={text(envelope.id)} value={text(envelope.id)}>
                  {envelopeTitle(envelope)}
                  {envelope.archived ? " · 보관함" : ""}
                </option>
              ))}
            </Select>
          </FormField>
          {error && (
            <p role="alert" className={s.caption}>
              {error}
            </p>
          )}
          <div className={s.formActions}>
            {onDelete && (
              <Button
                variant="danger"
                className={s.deleteAction}
                disabled={busy}
                onClick={() => setDeleting(true)}
              >
                여행 지우기
              </Button>
            )}
            <Button variant="ghost" disabled={busy} onClick={onClose}>
              취소
            </Button>
            <Button type="submit" disabled={busy}>
              {travel ? "저장" : "만들기"}
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog
        variant="confirm"
        isOpen={deleting}
        title="이 여행을 지울까요?"
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
        <p className={s.caption}>
          일정도 함께 지워져요. 연결한 준비 봉투는 그대로 남아요.
        </p>
      </Dialog>
    </>
  );
}
