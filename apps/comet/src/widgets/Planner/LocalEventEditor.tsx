import {
  Button,
  Checkbox,
  DateField,
  Dialog,
  FormField,
  TextArea,
  TextField,
} from "@fleetia/lagrange";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { localDay, text, type DataRecord } from "../toolData";
import {
  clockLabel,
  dayDate,
  deviceTimeZone,
  localDateTime,
  moveDay,
  overlappingEvents,
} from "./plannerData";
import * as s from "./planner.css";

export function LocalEventEditor({
  event,
  events = [],
  day,
  busy,
  onSave,
  onDelete,
  onReload,
  onClose,
  onDirtyChange,
}: {
  event?: DataRecord;
  events?: DataRecord[];
  day: string;
  busy: boolean;
  onSave: (input: DataRecord) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
  onReload?: () => Promise<boolean>;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}): ReactElement {
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(text(event?.title));
  const [allDay, setAllDay] = useState(event ? Boolean(event.allDay) : true);
  const [startDate, setStartDate] = useState(
    typeof event?.startAt === "number"
      ? localDay(new Date(event.startAt))
      : text(event?.startDate) || day,
  );
  const [endDate, setEndDate] = useState(
    typeof event?.endAt === "number"
      ? localDay(new Date(event.endAt))
      : event?.allDay && text(event.endDate)
        ? moveDay(text(event.endDate), -1)
        : day,
  );
  const [startTime, setStartTime] = useState(
    typeof event?.startAt === "number" ? clockLabel(event.startAt) : "09:00",
  );
  const [endTime, setEndTime] = useState(
    typeof event?.endAt === "number" ? clockLabel(event.endAt) : "10:00",
  );
  const [location, setLocation] = useState(text(event?.location));
  const [description, setDescription] = useState(text(event?.description));
  const [error, setError] = useState("");
  const [validationError, setValidationError] = useState("");
  const [moveTogether, setMoveTogether] = useState(false);
  const [confirmation, setConfirmation] = useState<"close" | "delete" | "reload" | null>(null);
  const [working, setWorking] = useState(false);
  const pending = useRef(false);
  const fingerprint = JSON.stringify({
    title,
    allDay,
    startDate,
    endDate,
    startTime,
    endTime,
    location,
    description,
  });
  useEffect(() => setValidationError(""), [fingerprint]);
  const baseline = useRef(fingerprint);
  const dirty = fingerprint !== baseline.current;
  const disabled = busy || working;
  const report = useRef(onDirtyChange);
  report.current = onDirtyChange;
  useEffect(() => {
    report.current?.(dirty);
  }, [dirty]);
  useEffect(
    () => () => {
      report.current?.(false);
    },
    [],
  );

  function close(): void {
    if (disabled || pending.current) {
      return;
    }
    if (dirty) {
      setConfirmation("close");
    } else {
      onClose();
    }
  }

  async function persist(action: () => Promise<boolean>, failure: string): Promise<void> {
    if (disabled || pending.current) {
      return;
    }
    pending.current = true;
    setWorking(true);
    setError("");
    try {
      if (await action()) {
        onClose();
      } else {
        setError(failure);
      }
    } catch {
      setError(failure);
    } finally {
      pending.current = false;
      setWorking(false);
    }
  }

  async function reload(): Promise<void> {
    if (!onReload || disabled || pending.current) {
      return;
    }
    pending.current = true;
    setWorking(true);
    setError("");
    const failure = "최신 일정을 불러오지 못했어요. 입력은 유지했습니다.";
    try {
      if (!(await onReload())) {
        setError(failure);
      }
    } catch {
      setError(failure);
    } finally {
      pending.current = false;
      setWorking(false);
    }
  }

  function save(): void {
    setValidationError("");
    if (!title.trim()) {
      setValidationError("일정 제목을 입력해 주세요.");
      titleRef.current?.focus();
      return;
    }
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(startDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(endDate) ||
      localDay(dayDate(startDate)) !== startDate ||
      localDay(dayDate(endDate)) !== endDate
    ) {
      setValidationError("시작 날짜와 종료 날짜를 확인해 주세요.");
      return;
    }
    const startAt = allDay ? null : localDateTime(startDate, startTime);
    const endAt = allDay ? null : localDateTime(endDate, endTime);
    if (!allDay && (startAt === null || endAt === null)) {
      setValidationError(
        "선택한 날짜에 해당 시각이 존재하지 않아요. 날짜와 시각을 다시 선택해 주세요.",
      );
      return;
    }
    if (allDay ? endDate < startDate : Number(endAt) <= Number(startAt)) {
      setValidationError("종료는 시작보다 뒤로 정해 주세요. 종일 일정은 같은 날에 끝날 수 있어요.");
      return;
    }
    void persist(
      () =>
        onSave({
          title: title.trim(),
          allDay,
          startDate: allDay ? startDate : null,
          endDate: allDay ? moveDay(endDate, 1) : null,
          startAt,
          endAt,
          timeZone: allDay ? null : "local",
          location: location.trim() || null,
          description: description || null,
        }),
      "저장하지 못했어요. 입력은 유지했습니다. 최신 일정을 확인한 뒤 다시 시도해 주세요.",
    );
  }

  function changeStart(nextDate: string, nextTime: string): void {
    if (moveTogether) {
      if (allDay && nextDate && startDate && endDate >= startDate) {
        const days = Math.round(
          (Date.parse(`${nextDate}T12:00:00Z`) - Date.parse(`${startDate}T12:00:00Z`)) / 86400000,
        );
        if (Number.isFinite(days)) setEndDate(moveDay(endDate, days));
      } else if (!allDay) {
        const before = localDateTime(startDate, startTime);
        const after = localDateTime(nextDate, nextTime);
        const end = localDateTime(endDate, endTime);
        if (before !== null && after !== null && end !== null && end > before) {
          const shifted = end + after - before;
          const shiftedDate = localDay(new Date(shifted));
          const shiftedTime = clockLabel(shifted);
          if (localDateTime(shiftedDate, shiftedTime) !== shifted) {
            setValidationError(
              "시간대 전환으로 종료 시각이 두 번 나타나요. 길이 유지를 끄고 시각을 직접 확인해 주세요.",
            );
            return;
          }
          setEndDate(shiftedDate);
          setEndTime(shiftedTime);
        }
      }
    }
    setStartDate(nextDate);
    setStartTime(nextTime);
  }
  const overlaps = overlappingEvents(
    {
      id: event?.id ?? null,
      startDate: allDay ? startDate : null,
      endDate: allDay ? moveDay(endDate, 1) : null,
      startAt: allDay ? null : localDateTime(startDate, startTime),
      endAt: allDay ? null : localDateTime(endDate, endTime),
    },
    events,
  );
  const displayedError = validationError || error;

  return (
    <Dialog
      isOpen
      title={event ? "일정 편집" : "새 일정"}
      className={s.dialog}
      initialFocusRef={titleRef}
      onOpenChange={(open) => {
        if (!open) {
          close();
        }
      }}
      closeLabel="일정 편집 닫기"
      footer={
        <div className={s.actions}>
          {event && onDelete && (
            <Button
              type="button"
              variant="quiet"
              disabled={disabled}
              onClick={() => setConfirmation("delete")}
            >
              삭제
            </Button>
          )}
          <span className={s.spacer} />
          <Button type="button" variant="quiet" disabled={disabled} onClick={close}>
            취소
          </Button>
          <Button type="submit" form="local-event-editor" variant="primary" disabled={disabled}>
            {event ? "저장" : "추가"}
          </Button>
        </div>
      }
    >
      <form
        id="local-event-editor"
        className={s.form}
        onSubmit={(submit) => {
          submit.preventDefault();
          save();
        }}
      >
        <fieldset
          className={s.form}
          disabled={disabled}
          style={{ border: 0, padding: 0, margin: 0 }}
        >
          <FormField label="일정 제목" className={s.field}>
            <TextField
              ref={titleRef}
              required
              maxLength={500}
              value={title}
              onChange={(change) => setTitle(change.target.value)}
            />
          </FormField>
          <p className={s.caption}>Comet 일정 · 이 기기에 저장</p>
          <Checkbox checked={allDay} onChange={(change) => setAllDay(change.target.checked)}>
            종일
          </Checkbox>
          <Checkbox
            checked={moveTogether}
            onChange={(change) => setMoveTogether(change.target.checked)}
          >
            시작 변경 시 종료도 함께 이동 · 길이 유지
          </Checkbox>
          <div className={s.fields}>
            <FormField label="시작 날짜" className={s.field}>
              <DateField
                required
                value={startDate}
                onChange={(change) => changeStart(change.target.value, startTime)}
              />
            </FormField>
            <FormField label="종료 날짜" className={s.field}>
              <DateField
                required
                value={endDate}
                onChange={(change) => setEndDate(change.target.value)}
              />
            </FormField>
            {!allDay && (
              <>
                <FormField label="시작 시각" className={s.field}>
                  <TextField
                    type="time"
                    required
                    value={startTime}
                    onChange={(change) => changeStart(startDate, change.target.value)}
                  />
                </FormField>
                <FormField label="종료 시각" className={s.field}>
                  <TextField
                    type="time"
                    required
                    value={endTime}
                    onChange={(change) => setEndTime(change.target.value)}
                  />
                </FormField>
              </>
            )}
          </div>
          {!allDay && <p className={s.caption}>기기 시간대: {deviceTimeZone()}</p>}
          <FormField label="장소" className={s.field}>
            <TextField
              value={location}
              maxLength={2000}
              onChange={(change) => setLocation(change.target.value)}
            />
          </FormField>
          <p className={s.caption}>이 일정의 안건 · Enter는 줄바꿈</p>
          <FormField label="메모" className={s.field}>
            <TextArea
              rows={3}
              value={description}
              maxLength={20000}
              onChange={(change) => setDescription(change.target.value)}
            />
          </FormField>
          {overlaps.length > 0 && (
            <p role="status" className={s.caption}>
              겹치는 일정 {overlaps.length}개:{" "}
              {overlaps.map((value) => text(value.title)).join(" · ")}. 현재 읽어 온 일정 기준이며,
              그대로 저장할 수 있어요.
            </p>
          )}
          {displayedError && (
            <div role="alert" className={s.error}>
              <p>{displayedError}</p>
              {event && onReload && (
                <Button type="button" variant="quiet" onClick={() => setConfirmation("reload")}>
                  최신 일정 다시 열기
                </Button>
              )}
            </div>
          )}
          {confirmation && (
            <div className={s.preview} role="group" aria-label="일정 변경 확인">
              <p>
                {confirmation === "close" && "저장하지 않은 변경을 버릴까요?"}
                {confirmation === "delete" && "이 일정을 삭제할까요?"}
                {confirmation === "reload" && "입력한 변경을 버리고 최신 일정을 다시 열까요?"}
              </p>
              <div className={s.actions}>
                <Button
                  type="button"
                  variant="critical"
                  onClick={() => {
                    if (confirmation === "close") {
                      onClose();
                    } else if (confirmation === "reload") {
                      void reload();
                    } else if (onDelete) {
                      void persist(onDelete, "삭제하지 못했어요. 일정과 입력은 유지했습니다.");
                    }
                  }}
                >
                  {confirmation === "close" && "변경 버리고 닫기"}
                  {confirmation === "delete" && "일정 삭제"}
                  {confirmation === "reload" && "변경 버리고 다시 열기"}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setConfirmation(null)}>
                  계속 편집
                </Button>
              </div>
            </div>
          )}
        </fieldset>
      </form>
    </Dialog>
  );
}
