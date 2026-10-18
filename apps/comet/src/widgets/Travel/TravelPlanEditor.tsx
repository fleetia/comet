import { useState, type ReactElement } from "react";
import {
  Button,
  Dialog,
  FormField,
  SegmentedControl,
  Select,
  TextInput,
  Textarea,
} from "@comet/ui";
import type { DataRecord } from "../toolData";
import { ZONES } from "./TravelEditor";
import { duration, instant } from "./travelData";
import type { Travel, TravelPlan } from "./travelTypes";
import * as s from "./travel.css";

const KINDS = [
  { value: "plan", label: "일정" },
  { value: "move", label: "이동" },
];

export function TravelPlanEditor({
  travel,
  plan,
  date,
  busy,
  onSave,
  onDelete,
  onClose,
}: {
  travel: Travel;
  plan?: TravelPlan;
  date: string;
  busy: boolean;
  onSave: (input: DataRecord) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
  onClose: () => void;
}): ReactElement {
  const [kind, setKind] = useState<TravelPlan["kind"]>(plan?.kind ?? "plan");
  const [day, setDay] = useState(plan?.date ?? date);
  const [time, setTime] = useState(plan?.time ?? "");
  const [title, setTitle] = useState(plan?.title ?? "");
  const [place, setPlace] = useState(plan?.place ?? "");
  const [memo, setMemo] = useState(plan?.memo ?? "");
  const [arriveDate, setArriveDate] = useState(plan?.arriveDate ?? plan?.date ?? date);
  const [arriveTime, setArriveTime] = useState(plan?.arriveTime ?? "");
  const [departZone, setDepartZone] = useState(plan?.departZone ?? "");
  const [arriveZone, setArriveZone] = useState(plan?.arriveZone ?? "");
  const [error, setError] = useState("");
  const zones = [["", "여행 시간대"], ...ZONES.filter(([zone]) => zone !== travel.timeZone)];
  const minutes =
    kind === "move" && time && arriveTime && arriveDate
      ? (instant(arriveDate, arriveTime, arriveZone || travel.timeZone) -
          instant(day, time, departZone || travel.timeZone)) /
        60_000
      : null;
  const caption = plan ? "일정 고치기" : "일정 더하기";
  async function save(): Promise<void> {
    if (!title.trim()) return setError(kind === "move" ? "어디서 어디로 가는지 적어 주세요." : "무엇을 할지 적어 주세요.");
    if (kind === "move" && (!time || !arriveTime)) return setError("출발과 도착 시각을 적어 주세요.");
    if (minutes !== null && minutes < 0) return setError("도착이 출발보다 빨라요. 날짜와 시간대를 확인해 주세요.");
    setError("");
    const input: DataRecord = {
      travelId: travel.id,
      kind,
      date: day,
      time,
      title,
      place,
      memo,
      ...(kind === "move"
        ? {
            arriveDate,
            arriveTime,
            departZone: departZone || null,
            arriveZone: arriveZone || null,
          }
        : {}),
      ...(plan ? { id: plan.id, expected: plan } : {}),
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
        <SegmentedControl
          label="일정 종류"
          options={KINDS}
          value={kind}
          disabled={busy}
          onValueChange={(value) => setKind(value as TravelPlan["kind"])}
        />
        <FormField label={kind === "move" ? "구간" : "할 일"} required>
          <TextInput
            value={title}
            maxLength={200}
            placeholder={kind === "move" ? "김포 → 제주" : "애월 숙소 체크인"}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />
        </FormField>
        <div className={s.fieldRow}>
          <FormField label={kind === "move" ? "출발 날짜" : "날짜"}>
            <TextInput
              type="date"
              value={day}
              disabled={busy}
              onChange={(event) => event.target.value && setDay(event.target.value)}
            />
          </FormField>
          <FormField
            label={kind === "move" ? "출발 시각" : "시각"}
            description={kind === "plan" ? "비워 두면 그날 끝에 놓여요." : undefined}
          >
            <TextInput
              type="time"
              value={time}
              disabled={busy}
              onChange={(event) => setTime(event.target.value)}
            />
          </FormField>
        </div>
        {kind === "move" && (
          <>
            <div className={s.fieldRow}>
              <FormField label="도착 날짜">
                <TextInput
                  type="date"
                  value={arriveDate}
                  min={day}
                  disabled={busy}
                  onChange={(event) => event.target.value && setArriveDate(event.target.value)}
                />
              </FormField>
              <FormField label="도착 시각">
                <TextInput
                  type="time"
                  value={arriveTime}
                  disabled={busy}
                  onChange={(event) => setArriveTime(event.target.value)}
                />
              </FormField>
            </div>
            <div className={s.fieldRow}>
              <FormField label="출발지 시간대">
                <Select
                  value={departZone}
                  disabled={busy}
                  onChange={(event) => setDepartZone(event.target.value)}
                >
                  {zones.map(([zone, name]) => (
                    <option key={zone} value={zone}>
                      {name}
                    </option>
                  ))}
                </Select>
              </FormField>
              <FormField label="도착지 시간대">
                <Select
                  value={arriveZone}
                  disabled={busy}
                  onChange={(event) => setArriveZone(event.target.value)}
                >
                  {zones.map(([zone, name]) => (
                    <option key={zone} value={zone}>
                      {name}
                    </option>
                  ))}
                </Select>
              </FormField>
            </div>
            {minutes !== null && minutes >= 0 && (
              <p className={s.caption}>시차를 빼고 {duration(minutes)} 걸려요.</p>
            )}
          </>
        )}
        <FormField label="장소">
          <TextInput
            value={place}
            maxLength={200}
            placeholder="제주공항 인근"
            disabled={busy}
            onChange={(event) => setPlace(event.target.value)}
          />
        </FormField>
        <FormField label="메모">
          <Textarea
            value={memo}
            maxLength={2000}
            rows={3}
            disabled={busy}
            onChange={(event) => setMemo(event.target.value)}
          />
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
