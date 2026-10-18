import { Button } from "@comet/ui";
import type { ReactElement } from "react";
import * as s from "./planner.css";

export function PlannerTodoEmpty({
  installed,
  busy,
  onEnable,
  message,
}: {
  installed: boolean;
  busy: boolean;
  onEnable: () => Promise<void>;
  message?: string;
}): ReactElement {
  return (
    <div className={s.empty}>
      <p>
        {message ??
          (installed
            ? "할 일 사용이 꺼져 있어요. 켜면 저장한 항목을 다시 볼 수 있어요."
            : "할 일을 설치하면 계정 없이 수집함을 사용할 수 있어요.")}
      </p>
      <Button variant="primary" disabled={busy} onClick={() => void onEnable()}>
        {installed ? "할 일 켜기" : "할 일 설치"}
      </Button>
    </div>
  );
}
