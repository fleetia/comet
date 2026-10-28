import type { ReactElement } from "react";
import * as s from "./planner.css";

export function PlannerTodoEmpty({ message = "할 일 도구를 불러오지 못했어요." }: { message?: string }): ReactElement {
  return (
    <div className={s.empty}>
      <p>{message}</p>
    </div>
  );
}
