import { Button } from "@fleetia/lagrange";
import { useId, useRef, useState, type ReactElement } from "react";
import { frequencyRecords, ruleOf } from "../Planner/plannerData";
import { localDay, number, rows, text, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import * as c from "../../lagrange.css";
import * as s from "../tools.css";

function todayInZone(now: number, timeZone: string): string {
  if (timeZone === "local") return localDay(new Date(now));
  try {
    const parts = new Intl.DateTimeFormat("en", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const part = (type: string): string => parts.find((part) => part.type === type)?.value ?? "";
    return `${part("year")}-${part("month")}-${part("day")}`;
  } catch {
    return "";
  }
}

type Attempt = { date: string; revision: number; status: "pending" | "saved" | "failed" };

/** Recording is always an explicit click; retries keep the date the user saw on that click. */
export function FrequencyRecordAction({
  item,
  todo,
  now,
  act,
}: {
  item: DataRecord;
  todo: WidgetView;
  now: number;
  act: ToolAction;
}): ReactElement {
  const descriptionId = useId();
  const pending = useRef(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const rule = ruleOf(item);
  const timeZone = text(rule.timeZone) || "local";
  const today = todayInZone(now, timeZone);
  const date = attempt?.date ?? today;
  const recorded = rows(item.frequencyRecords).some((record) => record.date === date);
  // Bridge the successful response and its snapshot, but honor a later explicit undo.
  const saved = recorded || (attempt?.status === "saved" && todo.revision <= attempt.revision);
  const busy = attempt?.status === "pending";
  const count = date ? frequencyRecords(item, date).length : 0;
  const limit = number(rule.timesPerWeek) || 1;
  const full = count >= limit;
  const invalidDate = !today || !date || date > today;
  const disabled = busy || saved || full || invalidDate;

  async function save(): Promise<void> {
    if (pending.current || disabled) return;
    pending.current = true;
    const request = { date, revision: todo.revision };
    setAttempt({ ...request, status: "pending" });
    try {
      const ok = await act("record-frequency", { id: text(item.id), date }, todo);
      setAttempt({ ...request, status: ok ? "saved" : "failed" });
    } catch {
      setAttempt({ ...request, status: "failed" });
    } finally {
      pending.current = false;
    }
  }

  return (
    <div className={s.body}>
      <p id={descriptionId} className={c.quiet}>
        기록 날짜: <time dateTime={date}>{date || "확인할 수 없음"}</time> ·{" "}
        {timeZone === "local" ? "이 컴퓨터의 시간대" : timeZone} 기준 · 해당 주{" "}
        {count + (saved && !recorded ? 1 : 0)}/{limit}회
      </p>
      <Button
        variant="secondary"
        disabled={disabled}
        aria-describedby={descriptionId}
        onClick={() => void save()}
      >
        {text(item.title)}{" "}
        {busy
          ? "기록 중…"
          : saved
            ? "기록됨"
            : full
              ? "이번 주 목표 달성"
              : date === today
                ? "오늘 1회 기록"
                : `${date} 1회 기록`}
      </Button>
      {invalidDate && (
        <p role="alert" className={c.error}>
          {today
            ? "미래 날짜에는 기록할 수 없어요. 컴퓨터의 날짜와 시간을 확인해 주세요."
            : "할 일의 반복 시간대를 확인해 주세요. 기록 날짜를 정할 수 없어요."}
        </p>
      )}
      {attempt?.status === "failed" && !saved && !full && !invalidDate && (
        <p role="alert" className={c.error}>
          저장 여부를 확인하지 못했어요. 같은 날짜로 다시 시도해 주세요.
        </p>
      )}
    </div>
  );
}
