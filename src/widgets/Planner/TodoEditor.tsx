import {
  Button,
  Checkbox,
  DateField,
  Dialog,
  FormField,
  Select,
  TextArea,
  TextField,
} from "@fleetia/lagrange";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { localDay, number, record, text, type DataRecord, type ToolAction } from "../toolData";
import {
  clockLabel,
  dueDay,
  localDateTime,
  PERIODS,
  periodAnchor,
  repeatLabel,
  ruleOf,
  WEEKDAYS,
} from "./plannerData";
import * as s from "./planner.css";

export function TodoEditor({
  item,
  lists,
  act,
  busy,
  onClose,
  onReload,
  widgetId,
}: {
  item: DataRecord;
  lists: DataRecord[];
  act: ToolAction;
  busy: boolean;
  onClose: () => void;
  onReload?: () => void;
  widgetId?: string;
}): ReactElement {
  const titleRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(text(item.title));
  const [memo, setMemo] = useState(text(item.memo));
  const [listId, setListId] = useState(text(item.listId) || "default");
  const [period, setPeriod] = useState(text(item.planPeriod) || "none");
  const [anchor, setAnchor] = useState(text(item.planAnchor) || localDay());
  const [day, setDay] = useState(dueDay(item));
  const [time, setTime] = useState(typeof item.dueAt === "number" ? clockLabel(item.dueAt) : "");
  const originalRule = ruleOf(item);
  const [mode, setMode] = useState(text(originalRule.mode) || "none");
  const [unit, setUnit] = useState(text(originalRule.unit) || "week");
  const [interval, setInterval] = useState(number(originalRule.interval) || 1);
  const [weekdays, setWeekdays] = useState<number[]>(
    Array.isArray(originalRule.weekdays)
      ? originalRule.weekdays.filter((v): v is number => typeof v === "number")
      : [0, 2, 4],
  );
  const [monthlyMode, setMonthlyMode] = useState(text(originalRule.monthlyMode) || "day-of-month");
  const [nth, setNth] = useState(number(originalRule.nth) || 1);
  const [weekday, setWeekday] = useState(number(originalRule.weekday));
  const [times, setTimes] = useState(number(originalRule.timesPerWeek) || 3);
  const [scope, setScope] = useState("occurrence");
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [nextDates, setNextDates] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState("");
  const rule: DataRecord | null =
    mode === "none"
      ? null
      : {
          mode,
          unit: mode === "frequency" ? "week" : unit,
          interval: mode === "frequency" ? 1 : interval,
          ...(unit === "week" && mode === "calendar" ? { weekdays } : {}),
          ...(mode === "calendar" && ["month", "year"].includes(unit)
            ? {
                monthlyMode,
                ...(monthlyMode === "nth-weekday" ? { nth, weekday } : {}),
                dayOfMonth:
                  day === dueDay(item) && originalRule.dayOfMonth
                    ? originalRule.dayOfMonth
                    : Number(day.slice(-2)) || 1,
              }
            : {}),
          ...(mode === "frequency" ? { timesPerWeek: times } : {}),
          timeZone: text(originalRule.timeZone) || "local",
        };
  const input: DataRecord = {
    id: text(item.id),
    title,
    memo,
    listId,
    planPeriod: period,
    planAnchor: ["none", "someday"].includes(period) ? null : periodAnchor(period, anchor),
    dueDate: day && !time ? day : null,
    dueAt: day && time ? localDateTime(day, time) : null,
    repeat: "none",
    repeatRule: rule,
    scope,
  };
  const previewInput = JSON.stringify({
    id: item.id,
    dueDate: input.dueDate,
    dueAt: input.dueAt,
    repeat: "none",
    repeatRule: rule,
  });
  useEffect(() => {
    if (!widgetId || !isDesktop() || mode === "none" || mode === "frequency") {
      setNextDates([]);
      setPreviewError("");
      return;
    }
    let active = true;
    const timer = window.setTimeout(() => {
      void command<string[]>("preview_planner_recurrence", {
        id: widgetId,
        input: JSON.parse(previewInput),
      })
        .then((dates) => {
          if (active) {
            setNextDates(dates);
            setPreviewError("");
          }
        })
        .catch((cause: unknown) => {
          if (active) {
            setNextDates([]);
            setPreviewError(errorText(cause));
          }
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [previewInput, widgetId, mode]);
  const fingerprint = JSON.stringify({
    title,
    memo,
    listId,
    period,
    anchor,
    day,
    time,
    mode,
    unit,
    interval,
    weekdays,
    monthlyMode,
    nth,
    weekday,
    times,
    scope,
  });
  const initial = useRef(fingerprint);
  const dirty = initial.current !== fingerprint;
  function close(): void {
    if (busy) return;
    if (dirty) setConfirmClose(true);
    else onClose();
  }
  return (
    <Dialog
      isOpen
      title="할 일 편집"
      size="large"
      footer={
        <div className={s.actions}>
          <Button
            type="button"
            variant="quiet"
            size="compact"
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            삭제
          </Button>
          <div className={s.spacer} />
          <Button type="button" variant="quiet" disabled={busy} onClick={close}>
            취소
          </Button>
          <Button type="submit" form="planner-todo-editor" variant="primary" disabled={busy}>
            저장
          </Button>
        </div>
      }
      className={s.dialog}
      initialFocusRef={titleRef}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      closeLabel="편집 닫기"
    >
      <form
        id="planner-todo-editor"
        className={s.form}
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          if (time && (!day || input.dueAt === null)) {
            setError(
              "선택한 날짜에 같은 지역 시각이 존재하지 않습니다. 날짜와 시각을 다시 선택해 주세요.",
            );
            return;
          }
          if (mode === "calendar" && unit === "week" && weekdays.length === 0) {
            setError("반복할 요일을 하나 이상 선택해 주세요.");
            return;
          }
          if (await act("update", input)) onClose();
          else
            setError(
              "저장하지 못했어요. 입력은 유지했습니다. 다른 곳에서 변경했다면 최신 내용을 다시 불러와 확인해 주세요.",
            );
        }}
      >
        <fieldset className={s.form} disabled={busy} style={{ border: 0, padding: 0, margin: 0 }}>
          <TextField
            ref={titleRef}
            aria-label="할 일 제목"
            required
            maxLength={500}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <div className={s.fields}>
            <FormField label="목록" className={s.field}>
              <Select value={listId} onChange={(e) => setListId(e.target.value)}>
                {lists.map((list) => (
                  <option key={text(list.id)} value={text(list.id)}>
                    {text(list.name)}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="계획 기간" className={s.field}>
              <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
                <option value="none">분류 안 함</option>
                {PERIODS.map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className={s.field}>
              <FormField id="planner-todo-due-date" label="기한 · 첫 날짜" className={s.field}>
                {day ? (
                  <DateField
                    value={day}
                    onChange={(e) => {
                      setDay(e.target.value);
                      if (!e.target.value) setTime("");
                    }}
                  />
                ) : (
                  <Button
                    id="planner-todo-due-date"
                    aria-label="날짜 지정"
                    type="button"
                    variant="secondary"
                    onClick={() => setDay(localDay())}
                  >
                    날짜 지정
                  </Button>
                )}
              </FormField>
              {day && (
                <Button
                  type="button"
                  variant="quiet"
                  size="compact"
                  onClick={() => {
                    setDay("");
                    setTime("");
                  }}
                >
                  기한 지우기
                </Button>
              )}
            </div>
            <div className={s.field}>
              <FormField id="planner-todo-due-time" label="시각 (선택)" className={s.field}>
                {time ? (
                  <TextField type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                ) : (
                  <Button
                    id="planner-todo-due-time"
                    aria-label="시각 추가"
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      if (!day) setDay(localDay());
                      setTime("09:00");
                    }}
                  >
                    시각 추가
                  </Button>
                )}
              </FormField>
              {time && (
                <Button type="button" variant="quiet" size="compact" onClick={() => setTime("")}>
                  시각 지우기
                </Button>
              )}
            </div>
            {!["none", "someday"].includes(period) && (
              <FormField label="계획에 속하는 날짜" className={s.field}>
                <DateField required value={anchor} onChange={(e) => setAnchor(e.target.value)} />
              </FormField>
            )}
          </div>
          <div className={s.section}>
            <h3 className={s.heading}>반복</h3>
            <div className={s.actions} role="group" aria-label="반복 방식">
              {[
                ["none", "없음"],
                ["calendar", "날짜에 맞춰"],
                ["completion", "완료한 뒤"],
                ["frequency", "주 N회"],
              ].map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  variant="quiet"
                  size="compact"
                  aria-pressed={mode === value}
                  className={s.categoryButton}
                  onClick={() => {
                    setMode(value);
                    if (value === "completion") setUnit("day");
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
            {mode !== "none" && mode !== "frequency" && (
              <div className={s.actions}>
                {mode === "completion" && <span className={s.caption}>완료한 날부터</span>}
                <TextField
                  aria-label="반복 간격"
                  className={s.short}
                  type="number"
                  min={1}
                  max={365}
                  required
                  value={interval}
                  onChange={(e) => setInterval(Number(e.target.value))}
                />
                <Select
                  aria-label="반복 단위"
                  className={s.listSelect}
                  value={unit}
                  onChange={(e) => setUnit(e.target.value)}
                >
                  {[
                    ["day", "일"],
                    ["week", "주"],
                    ["month", "개월"],
                    ["year", "년"],
                  ].map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                      {mode === "completion" ? " 뒤" : "마다"}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {mode === "calendar" && unit === "week" && (
              <div className={s.actions} role="group" aria-label="반복 요일">
                {WEEKDAYS.map((label, i) => (
                  <Checkbox
                    key={label}
                    checked={weekdays.includes(i)}
                    onChange={(e) =>
                      setWeekdays((before) =>
                        e.target.checked ? [...before, i].sort() : before.filter((d) => d !== i),
                      )
                    }
                  >
                    {label}
                  </Checkbox>
                ))}
              </div>
            )}
            {mode === "calendar" && unit === "month" && (
              <div className={s.actions}>
                <Select
                  aria-label="매월 반복 기준"
                  value={monthlyMode}
                  onChange={(e) => setMonthlyMode(e.target.value)}
                >
                  <option value="day-of-month">첫 날짜와 같은 일</option>
                  <option value="last-day">매월 마지막 날</option>
                  <option value="nth-weekday">몇 번째 요일</option>
                </Select>
                {monthlyMode === "nth-weekday" && (
                  <>
                    <Select
                      aria-label="몇 번째"
                      value={nth}
                      onChange={(e) => setNth(Number(e.target.value))}
                    >
                      {[1, 2, 3, 4, 5, -1].map((n) => (
                        <option key={n} value={n}>
                          {n === -1 ? "마지막" : `${n}번째`}
                        </option>
                      ))}
                    </Select>
                    <Select
                      aria-label="월 반복 요일"
                      value={weekday}
                      onChange={(e) => setWeekday(Number(e.target.value))}
                    >
                      {WEEKDAYS.map((label, i) => (
                        <option key={label} value={i}>
                          {label}요일
                        </option>
                      ))}
                    </Select>
                  </>
                )}
              </div>
            )}
            {mode === "frequency" && (
              <div className={s.actions}>
                <span>일주일에</span>
                <TextField
                  className={s.short}
                  aria-label="주간 목표 횟수"
                  type="number"
                  min={1}
                  max={7}
                  required
                  value={times}
                  onChange={(e) => setTimes(Number(e.target.value))}
                />
                <span>회 · 요일은 정하지 않음</span>
              </div>
            )}
            {mode !== "none" && (
              <p className={s.preview}>
                {repeatLabel({ repeatRule: rule })} ·{" "}
                {mode === "frequency"
                  ? "하루 한 번 기록해요. 주간 기록은 기한과 별도로 보존합니다."
                  : mode === "completion"
                    ? "완료한 날짜를 기준으로 다음 회차를 만들어요."
                    : "기기의 지역 시각을 유지합니다. 건너뛴 회차는 완료로 세지 않아요."}
              </p>
            )}
            {nextDates.length > 0 && (
              <p className={s.caption}>
                {mode === "completion" ? "지금 완료하면" : "다음 회차"}:{" "}
                {nextDates
                  .map((value) =>
                    value.includes("T") ? new Date(value).toLocaleString("ko-KR") : value,
                  )
                  .join(" · ")}
              </p>
            )}
            {previewError && (
              <p className={s.error} role="status">
                {previewError}
              </p>
            )}
          </div>
          <FormField label="메모" className={s.field}>
            <TextArea
              rows={2}
              value={memo}
              maxLength={20000}
              onChange={(e) => setMemo(e.target.value)}
            />
          </FormField>
          <div className={s.actions}>
            <FormField label="변경 적용" className={s.field}>
              <Select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="occurrence">이번 회차</option>
                <option value="following">이번 및 이후 회차</option>
              </Select>
            </FormField>
            {(text(record(item.repeatRule).mode) === "calendar" ||
              (item.repeat && item.repeat !== "none")) && (
              <Button
                type="button"
                variant="quiet"
                size="compact"
                disabled={dirty}
                onClick={async () => {
                  if (await act("skip", { id: text(item.id) })) onClose();
                }}
              >
                이번 회차 건너뛰기
              </Button>
            )}
          </div>
          {error && (
            <div role="alert" className={s.error}>
              {error}
              {onReload && (
                <Button type="button" variant="quiet" onClick={onReload}>
                  최신 내용 다시 불러오기
                </Button>
              )}
            </div>
          )}
          {confirmClose ? (
            <div className={s.preview}>
              <p>저장하지 않은 변경을 버릴까요?</p>
              <div className={s.actions}>
                <Button type="button" variant="critical" onClick={onClose}>
                  변경 버리고 닫기
                </Button>
                <Button type="button" variant="secondary" onClick={() => setConfirmClose(false)}>
                  계속 편집
                </Button>
              </div>
            </div>
          ) : null}
          {confirmDelete ? (
            <div className={s.preview}>
              <p>이 회차를 삭제할까요? 다른 회차와 준비 자료는 유지됩니다.</p>
              <div className={s.actions}>
                <Button
                  type="button"
                  variant="critical"
                  onClick={async () => {
                    if (await act("delete", { id: text(item.id) })) onClose();
                  }}
                >
                  이 회차 삭제
                </Button>
                <Button type="button" variant="quiet" onClick={() => setConfirmDelete(false)}>
                  취소
                </Button>
              </div>
            </div>
          ) : null}
        </fieldset>
      </form>
    </Dialog>
  );
}
