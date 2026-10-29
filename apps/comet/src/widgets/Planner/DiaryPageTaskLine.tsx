import { Button, Checkbox, DeadlineChip, TextInput } from "@comet/ui";
import type { ReactElement } from "react";
import { text, type DataRecord } from "../toolData";
import { deadlineChipLabel, isOverdue, frequencyRecords, plannedDay, ruleOf } from "./plannerData";
import { TaskReadOnlyDetails } from "./TodoEditor";
import { useDiaryPageTaskLine } from "./useDiaryPageTaskLine";
import * as s from "./diaryPage.css";

export function DiaryPageTaskLine({
  item,
  date,
  busy,
  onToggle,
  onEdit,
  onFocus,
  onQueue,
  onMove,
  onRemove,
}: {
  item: DataRecord;
  date: string;
  busy: boolean;
  onToggle: (item: DataRecord) => void;
  onEdit: (item: DataRecord) => void;
  onFocus?: (item: DataRecord) => void;
  onQueue?: (item: DataRecord) => void;
  onMove: (item: DataRecord, toDate: string) => Promise<boolean>;
  onRemove?: () => void;
}): ReactElement {
  const {
    expanded,
    moving,
    destination,
    failure,
    saving,
    toggleExpanded,
    toggleMoving,
    cancelMove,
    setDestination,
    submitMove,
  } = useDiaryPageTaskLine({ item, date, busy, onMove });
  const done =
    ruleOf(item).mode === "frequency"
      ? frequencyRecords(item, date).some((entry) => entry.date === date)
      : typeof item.completedAt === "number";
  return (
    <>
      <div className={s.row}>
        <Checkbox
          aria-label={text(item.title)}
          title="완료 상태 바꾸기"
          checked={done}
          disabled={busy || saving}
          onChange={() => onToggle(item)}
        />
        <button
          type="button"
          className={`${s.taskTitle} ${done ? s.completed : ""}`}
          aria-label={`${text(item.title)} 상세 보기`}
          aria-expanded={expanded}
          onClick={toggleExpanded}
        >
          {text(item.title)}
        </button>
        <div className={s.rowActions}>
          <Button
            size="small"
            variant="ghost"
            disabled={busy || saving}
            onClick={() => onEdit(item)}
            aria-label={`${text(item.title)} 편집`}
          >
            편집
          </Button>
          {!done && (
            <Button
              size="small"
              variant="ghost"
              disabled={busy || saving}
              onClick={toggleMoving}
              aria-label={`${text(item.title)} 날짜 옮기기`}
            >
              옮기기
            </Button>
          )}
          {onRemove && (
            <Button
              variant="ghost"
              size="small"
              disabled={busy || saving}
              onClick={onRemove}
              aria-label={`${text(item.title)} 페이지에서 빼기`}
              title="할 일은 남고 이 페이지의 연결만 지웁니다."
            >
              연결 빼기
            </Button>
          )}
        </div>
      </div>
      <p className={s.taskMeta}>
        계획 · {plannedDay(item) || "미지정"}
        {deadlineChipLabel(item) && (
          <DeadlineChip overdue={isOverdue(item)}>{deadlineChipLabel(item)}</DeadlineChip>
        )}
      </p>
      {!!text(item.memo) && (
        <p className={s.memoPreview}>메모 · {text(item.memo).split(/\r?\n/)[0]} · 상세 보기</p>
      )}
      {expanded && (
        <>
          <TaskReadOnlyDetails item={item} />
          {onFocus && !done && (
            <Button
              variant="ghost"
              size="small"
              disabled={busy || saving}
              onClick={() => onFocus(item)}
            >
              25분 집중 시작
            </Button>
          )}
          {onQueue && !done && (
            <Button
              variant="ghost"
              size="small"
              disabled={busy || saving}
              onClick={() => onQueue(item)}
            >
              다음 집중에 추가
            </Button>
          )}
        </>
      )}
      {moving && (
        <form className={s.controls} onSubmit={submitMove}>
          <TextInput
            type="date"
            fill
            className={s.date}
            aria-label={`${text(item.title)} 옮길 날짜`}
            required
            value={destination}
            disabled={busy || saving}
            onChange={(event) => setDestination(event.target.value)}
          />
          <Button
            type="submit"
            size="small"
            disabled={busy || saving || !destination || destination === date}
          >
            이 날짜로 옮기기
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="small"
            disabled={busy || saving}
            onClick={cancelMove}
          >
            취소
          </Button>
        </form>
      )}
      {failure && (
        <p role="alert" className={s.error}>
          {failure}
        </p>
      )}
    </>
  );
}
