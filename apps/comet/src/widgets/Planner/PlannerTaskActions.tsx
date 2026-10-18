import type { ReactElement } from "react";
import { Button } from "../../ui";
import { localDay, type DataRecord } from "../toolData";
import { plannedDay } from "./plannerData";
import * as s from "./planner.css";

export function PlannerTaskActions({
  currentTask,
  day,
  busy,
  showWrap,
  onFocus,
  onRemove,
  onWrap,
}: {
  currentTask: DataRecord | undefined;
  day: string;
  busy: boolean;
  /** Shows day close here when the diary header does not already offer it. */
  showWrap: boolean;
  onFocus: () => Promise<void>;
  onRemove: () => void;
  onWrap: () => void;
}): ReactElement {
  return (
    <div className={s.actions}>
      <Button variant="secondary" size="compact" disabled={!currentTask || busy} onClick={onFocus}>
        25분 집중
      </Button>
      <Button
        variant="quiet"
        size="compact"
        disabled={!currentTask || plannedDay(currentTask) !== day || busy}
        onClick={onRemove}
      >
        {day === localDay() ? "오늘에서 빼기" : "선택 날짜에서 빼기"}
      </Button>
      {showWrap && <div className={s.spacer} />}
      {showWrap && (
        <Button variant="quiet" size="compact" onClick={onWrap}>
          하루 마무리
        </Button>
      )}
    </div>
  );
}
