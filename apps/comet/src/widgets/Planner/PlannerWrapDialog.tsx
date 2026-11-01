import { Dialog, Button, Checkbox, TextInput, FormField, Select } from "@comet/ui";
import {
  useLayoutEffect,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactElement,
  type SetStateAction,
} from "react";
import { localDay, record, rows, text, type DataRecord, type ToolAction } from "../toolData";
import { moveDay, repeatLabel, ruleOf } from "./plannerData";
import * as s from "./planner.css";

type Destination = "next-day" | "date" | "inbox";
export const PLANNER_WRAP_DRAFT_KEY = "comet:diary:planner-wrap-draft";
type WrapDraft = {
  day: string;
  rollIds: string[];
  rollDate: string;
  destination: Destination;
  source: DataRecord[];
  widgetId: string;
  attempted: boolean;
};
export function readPlannerWrapDraft(): WrapDraft | null {
  try {
    const value = record(JSON.parse(localStorage.getItem(PLANNER_WRAP_DRAFT_KEY) || "null"));
    if (
      typeof value.day !== "string" ||
      typeof value.rollDate !== "string" ||
      typeof value.widgetId !== "string" ||
      !Array.isArray(value.rollIds) ||
      !value.rollIds.every((id) => typeof id === "string") ||
      !Array.isArray(value.source) ||
      !["next-day", "date", "inbox"].includes(text(value.destination))
    )
      return null;
    const destination = value.destination;
    if (destination !== "next-day" && destination !== "date" && destination !== "inbox")
      return null;
    return {
      day: value.day,
      rollDate: value.rollDate,
      rollIds: value.rollIds as string[],
      destination,
      source: rows(value.source),
      widgetId: value.widgetId,
      attempted: value.attempted === true,
    };
  } catch {
    return null;
  }
}

/** A calendar-based repeat moves to its next occurrence instead of to another day. */
export function wrapsToNextOccurrence(item: DataRecord): boolean {
  return ruleOf(item).mode === "calendar";
}

function dayLabel(day: string): string {
  return new Date(`${day}T00:00:00`).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });
}

export function PlannerWrapDialog({
  isOpen,
  day,
  completedCount,
  focusLabel,
  habits,
  remaining,
  rollIds,
  rollDate,
  busy,
  failure,
  act,
  onOpenChange,
  onRollIdsChange,
  onRollDateChange,
  persistDraft = false,
  widgetId,
}: {
  isOpen: boolean;
  day: string;
  completedCount: number;
  /** Formatted focus time of the day; omitted when no focus timer is in use. */
  focusLabel?: string;
  /** Scheduled habits of the day; omitted outside the diary. */
  habits?: { done: number; total: number };
  remaining: DataRecord[];
  rollIds: string[];
  rollDate: string;
  busy: boolean;
  failure: { message: string } | null;
  act: ToolAction;
  onOpenChange: (open: boolean) => void;
  onRollIdsChange: Dispatch<SetStateAction<string[]>>;
  onRollDateChange: (date: string) => void;
  persistDraft?: boolean;
  widgetId?: string;
}): ReactElement {
  const [restored] = useState(() => (persistDraft ? readPlannerWrapDraft() : null));
  const [destination, setDestination] = useState<Destination>(restored?.destination ?? "next-day");
  const [source, setSource] = useState(() => restored?.source ?? remaining);
  const [sourceDay, setSourceDay] = useState(() => restored?.day ?? day);
  const [sourceWidget, setSourceWidget] = useState(() => restored?.widgetId ?? widgetId);
  const [attempted, setAttempted] = useState(restored?.attempted ?? false);
  const [storageError, setStorageError] = useState(false);
  const pending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const nextDay = moveDay(day, 1);
  const selected = remaining.filter((item) => rollIds.includes(text(item.id)));
  const skips = selected.filter(wrapsToNextOccurrence);
  const moves = selected.filter((item) => !wrapsToNextOccurrence(item));
  const conflict =
    persistDraft &&
    (sourceDay !== day ||
      sourceWidget !== widgetId ||
      rollIds.some((id) => {
        const before = source.find((item) => item.id === id);
        const current = remaining.find((item) => item.id === id);
        return !before || !current || JSON.stringify(before) !== JSON.stringify(current);
      }));
  const draft = {
    day: sourceDay,
    rollIds,
    rollDate,
    destination,
    source,
    widgetId: sourceWidget,
    attempted,
  };
  useLayoutEffect(() => {
    if (!persistDraft || !isOpen || !sourceWidget) return;
    try {
      localStorage.setItem(PLANNER_WRAP_DRAFT_KEY, JSON.stringify(draft));
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [
    persistDraft,
    isOpen,
    sourceDay,
    rollIds,
    rollDate,
    destination,
    source,
    sourceWidget,
    attempted,
  ]);
  async function finish(): Promise<void> {
    if (pending.current || conflict || storageError || attempted) return;
    pending.current = true;
    if (persistDraft) {
      try {
        localStorage.setItem(PLANNER_WRAP_DRAFT_KEY, JSON.stringify({ ...draft, attempted: true }));
        setAttempted(true);
      } catch {
        setStorageError(true);
        pending.current = false;
        return;
      }
    }
    try {
      for (const item of skips) {
        if (!(await act("skip", { id: text(item.id) })) || !mounted.current) return;
      }
      if (moves.length) {
        const ids = moves.map((item) => text(item.id));
        const moved =
          destination === "inbox"
            ? await act("plan", { ids, date: null, planPeriod: "none" })
            : await act("plan", { ids, date: destination === "next-day" ? nextDay : rollDate });
        if (!moved || !mounted.current) return;
      }
      if (mounted.current) close();
    } finally {
      pending.current = false;
    }
  }
  function toggle(id: string, checked: boolean): void {
    onRollIdsChange((old) => (checked ? [...old, id] : old.filter((value) => value !== id)));
  }
  const close = (): void => {
    if (busy) return;
    if (persistDraft) {
      try {
        localStorage.removeItem(PLANNER_WRAP_DRAFT_KEY);
      } catch {
        setStorageError(true);
        return;
      }
    }
    onOpenChange(false);
  };
  return (
    <Dialog
      isOpen={isOpen}
      title={day === localDay() ? "오늘은 여기까지" : `${day} 하루 마무리`}
      size="small"
      onOpenChange={(open) => {
        if (!busy && !open) close();
      }}
      closeLabel="하루 마무리 닫기"
      footer={
        <>
          <Button variant="ghost" type="button" disabled={busy} onClick={close}>
            그대로 마치기
          </Button>
          <div className={s.spacer} />
          <Button variant="ghost" type="button" disabled={busy} onClick={close}>
            취소
          </Button>
          <Button
            type="submit"
            form="planner-wrap"
            variant="primary"
            disabled={
              busy ||
              conflict ||
              attempted ||
              storageError ||
              !selected.length ||
              (moves.length > 0 && destination === "date" && !rollDate)
            }
          >
            {selected.length}개 옮기고 마치기
          </Button>
        </>
      }
    >
      <form
        id="planner-wrap"
        className={s.form}
        onSubmit={(e) => {
          e.preventDefault();
          void finish();
        }}
      >
        {failure && (
          <p role="alert" className={s.error}>
            {failure.message}
          </p>
        )}
        {storageError && (
          <p role="alert" className={s.error}>
            이 기기에 초안을 저장하거나 지우지 못했어요.
          </p>
        )}
        {(conflict || attempted) && (
          <div>
            <p role="alert" className={s.error}>
              할 일이나 처리 결과가 바뀌었을 수 있어요. 최신 내용을 확인하고 다시 골라 주세요.
            </p>
            <Button
              type="button"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setSource(remaining);
                setSourceDay(day);
                setSourceWidget(widgetId);
                setAttempted(false);
                onRollIdsChange([]);
              }}
            >
              최신 내용 확인하고 다시 고르기
            </Button>
          </div>
        )}
        <p className={s.caption}>{dayLabel(day)}</p>
        <dl className={s.wrapStats} aria-label="하루 요약">
          <div className={s.wrapStat}>
            <dt>끝낸 일</dt>
            <dd>{completedCount}개</dd>
          </div>
          {focusLabel !== undefined && (
            <div className={s.wrapStat}>
              <dt>집중한 시간</dt>
              <dd>{focusLabel}</dd>
            </div>
          )}
          {habits && habits.total > 0 && (
            <div className={s.wrapStat}>
              <dt>채운 습관</dt>
              <dd>
                {habits.done}/{habits.total}
              </dd>
            </div>
          )}
        </dl>
        <strong className={s.wrapHeading}>못 한 일 · {remaining.length}개</strong>
        {remaining.length === 0 && <p className={s.caption}>남은 일이 없어요.</p>}
        {remaining.map((item) => {
          const id = text(item.id);
          const repeat = wrapsToNextOccurrence(item);
          return (
            <div key={id} className={s.wrapItem}>
              <Checkbox
                checked={rollIds.includes(id)}
                onChange={(e) => toggle(id, e.target.checked)}
                label={text(item.title)}
                description={repeat ? repeatLabel(item) : text(item.memo) || undefined}
              />
              {repeat && <span className={s.caption}>다음 회차로</span>}
            </div>
          );
        })}
        {moves.length > 0 && (
          <FormField label="옮길 날짜" className={s.field}>
            <Select
              fill
              value={destination}
              onChange={(e) => setDestination(e.target.value as Destination)}
            >
              <option value="next-day">내일 · {dayLabel(nextDay)}</option>
              <option value="date">날짜 고르기…</option>
              <option value="inbox">수집함 · 날짜 없음</option>
            </Select>
          </FormField>
        )}
        {moves.length > 0 && destination === "date" && (
          <FormField label="날짜" className={s.field}>
            <TextInput
              type="date"
              fill
              required
              value={rollDate}
              onChange={(e) => onRollDateChange(e.target.value)}
            />
          </FormField>
        )}
        <p className={s.caption}>
          반복하는 일은 다음 회차로 넘어가고, 수집함으로 보내면 날짜 없이 남아요. 고르지 않은 일은{" "}
          {dayLabel(day)}에 그대로 남아요.
        </p>
      </form>
    </Dialog>
  );
}
