import type { ReactElement } from "react";
import { Dialog } from "@comet/ui";
import { Button, DateField, FormField, Select } from "../../ui";
import { text, type DataRecord } from "../toolData";
import * as s from "./planner.css";

export type PlannerMovingTask = { id: string; date: string };

export function PlannerMoveTaskDialog({
  movingTask,
  items,
  hasTodo,
  busy,
  failure,
  onChange,
  onMove,
  onClose,
}: {
  movingTask: PlannerMovingTask;
  items: DataRecord[];
  hasTodo: boolean;
  busy: boolean;
  failure: { message: string } | null;
  onChange: (movingTask: PlannerMovingTask) => void;
  onMove: (item: DataRecord, date: string) => Promise<boolean>;
  onClose: () => void;
}): ReactElement {
  return (
    <Dialog
      isOpen
      title="할 일 옮기기"
      size="small"
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <form
        className={s.form}
        onSubmit={async (event) => {
          event.preventDefault();
          const item = items.find((value) => value.id === movingTask.id);
          if (item && (await onMove(item, movingTask.date))) onClose();
        }}
      >
        {failure && (
          <p role="alert" className={s.error}>
            {failure.message}
          </p>
        )}
        <FormField label="옮길 할 일">
          <Select
            value={movingTask.id}
            disabled={busy}
            onChange={(event) => onChange({ ...movingTask, id: event.target.value })}
          >
            {items
              .filter((item) => typeof item.completedAt !== "number")
              .map((item) => (
                <option key={text(item.id)} value={text(item.id)}>
                  {text(item.title)}
                </option>
              ))}
          </Select>
        </FormField>
        <FormField label="새 계획 날짜">
          <DateField
            required
            disabled={busy}
            value={movingTask.date}
            onChange={(event) => onChange({ ...movingTask, date: event.target.value })}
          />
        </FormField>
        <div className={s.actions}>
          <Button variant="quiet" disabled={busy} onClick={onClose}>
            취소
          </Button>
          <Button
            type="submit"
            disabled={
              busy ||
              !hasTodo ||
              !movingTask.date ||
              !items.some((item) => item.id === movingTask.id)
            }
          >
            선택한 날로 옮기기
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
