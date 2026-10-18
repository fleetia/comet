import { Dialog, Button, Checkbox, TextInput, FormField, Select } from "@comet/ui";
import { useState, type Dispatch, type ReactElement, type SetStateAction } from "react";
import { localDay, text, type DataRecord, type ToolAction } from "../toolData";
import { moveDay, repeatLabel, ruleOf } from "./plannerData";
import * as s from "./planner.css";

type Destination = "next-day" | "date" | "inbox";

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
}): ReactElement {
  const [destination, setDestination] = useState<Destination>("next-day");
  const nextDay = moveDay(day, 1);
  const selected = remaining.filter((item) => rollIds.includes(text(item.id)));
  const skips = selected.filter(wrapsToNextOccurrence);
  const moves = selected.filter((item) => !wrapsToNextOccurrence(item));
  async function finish(): Promise<void> {
    for (const item of skips) {
      if (!(await act("skip", { id: text(item.id) }))) return;
    }
    if (moves.length) {
      const ids = moves.map((item) => text(item.id));
      const moved =
        destination === "inbox"
          ? await act("plan", { ids, date: null, planPeriod: "none" })
          : await act("plan", { ids, date: destination === "next-day" ? nextDay : rollDate });
      if (!moved) return;
    }
    onOpenChange(false);
  }
  function toggle(id: string, checked: boolean): void {
    onRollIdsChange((old) => (checked ? [...old, id] : old.filter((value) => value !== id)));
  }
  const close = (): void => {
    if (!busy) onOpenChange(false);
  };
  return (
    <Dialog
      isOpen={isOpen}
      title={day === localDay() ? "오늘은 여기까지" : `${day} 하루 마무리`}
      size="small"
      onOpenChange={(open) => {
        if (!busy) onOpenChange(open);
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
            disabled={busy || !selected.length || (moves.length > 0 && destination === "date" && !rollDate)}
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
