import { Button } from "@comet/ui";
import type { ReactElement } from "react";
import { number, text, type DataRecord } from "../toolData";
import { clockLabel, dueDay } from "./plannerData";
import * as s from "./planner.css";

/** Tasks beside the planner calendar, split by whether the selected day gave them a time. */
export function PlannerTimedTasks({
  day,
  items,
  remaining,
  renderCheck,
  onEdit,
}: {
  day: string;
  items: DataRecord[];
  remaining: DataRecord[];
  renderCheck: (item: DataRecord) => ReactElement;
  onEdit: (item: DataRecord) => void;
}): ReactElement {
  return (
    <section className={s.section}>
      <h3 className={s.heading}>시간을 정한 할 일</h3>
      {items
        .filter(
          (item) =>
            typeof item.completedAt !== "number" &&
            typeof item.dueAt === "number" &&
            dueDay(item) === day,
        )
        .sort((a, b) => number(a.dueAt) - number(b.dueAt))
        .map((item) => (
          <div key={text(item.id)} className={s.actions}>
            <span className={s.caption}>{clockLabel(number(item.dueAt))}</span>
            {renderCheck(item)}
            <Button
              variant="ghost"
              size="small"
              aria-label={`${text(item.title)} 시간 수정`}
              onClick={() => onEdit(item)}
            >
              수정
            </Button>
          </div>
        ))}
      <h3 className={s.heading}>아직 시간을 정하지 않은 일</h3>
      {remaining
        .filter((item) => typeof item.dueAt !== "number")
        .map((item) => (
          <div key={text(item.id)} className={s.actions}>
            {renderCheck(item)}
            <Button
              variant="ghost"
              size="small"
              aria-label={`${text(item.title)} 시간 잡기`}
              onClick={() => onEdit(item)}
            >
              시간 잡기
            </Button>
          </div>
        ))}
      <p className={s.caption}>내장 할 일의 기한만 바뀝니다. 외부 일정은 수정하지 않아요.</p>
    </section>
  );
}
