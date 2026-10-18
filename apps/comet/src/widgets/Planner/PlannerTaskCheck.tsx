import type { ReactElement } from "react";
import { Checkbox } from "../../ui";
import { localDay, number, rows, text, type DataRecord } from "../toolData";
import { TaskReadOnlyDetails } from "./TodoEditor";
import { dueLabel, frequencyRecords, plannedDay, ruleOf } from "./plannerData";
import * as s from "./planner.css";

export function PlannerTaskCheck({
  item,
  recordingDay,
  selected,
  busy,
  onSelect,
  onCheck,
}: {
  item: DataRecord;
  recordingDay: string;
  selected: boolean;
  busy: boolean;
  onSelect: (id: string) => void;
  onCheck: (item: DataRecord) => Promise<void>;
}): ReactElement {
  const frequency = ruleOf(item).mode === "frequency";
  return (
    <div className={s.taskSummary}>
      <div className={s.actions}>
        <span onClick={(event) => event.stopPropagation()}>
          <Checkbox
            className={s.taskCheck}
            aria-label={text(item.title)}
            title="완료 상태 바꾸기"
            children={null}
            aria-labelledby={undefined}
            disabled={busy || (frequency && recordingDay > localDay())}
            checked={
              frequency
                ? rows(item.frequencyRecords).some((entry) => entry.date === recordingDay)
                : typeof item.completedAt === "number"
            }
            onChange={() => void onCheck(item)}
          />
        </span>
        <button
          type="button"
          className={s.taskTitle}
          aria-label={`${text(item.title)} 상세 보기`}
          aria-expanded={selected}
          onClick={() => onSelect(text(item.id))}
        >
          {text(item.title)}
          {frequency && (
            <span className={s.caption}>
              {" "}
              · {frequencyRecords(item, recordingDay).length}/{number(ruleOf(item).timesPerWeek)}회
            </span>
          )}
        </button>
      </div>
      <p className={s.caption}>
        계획 · {plannedDay(item) || "날짜 없음"}　{dueLabel(item) || "기한 없음"}
      </p>
      {!!text(item.memo) && (
        <span className={s.memoPreview}>
          메모 · {text(item.memo).split(/\r?\n/)[0]} · 상세 보기
        </span>
      )}
      {selected && <TaskReadOnlyDetails item={item} />}
    </div>
  );
}
