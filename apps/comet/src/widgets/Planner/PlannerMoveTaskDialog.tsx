import { Dialog, Button, TextInput, FormField, Select } from "@comet/ui";
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import { record, text, type DataRecord } from "../toolData";
import * as s from "./planner.css";

export type PlannerMovingTask = { id: string; date: string };
export const PLANNER_MOVE_DRAFT_KEY = "comet:diary:planner-move-draft";

export function readPlannerMoveDraft(): {
  movingTask: PlannerMovingTask;
  source: DataRecord;
  widgetId: string;
} | null {
  try {
    const value = record(JSON.parse(localStorage.getItem(PLANNER_MOVE_DRAFT_KEY) || "null"));
    const movingTask = record(value.movingTask);
    const source = record(value.source);
    if (
      typeof movingTask.id !== "string" ||
      typeof movingTask.date !== "string" ||
      source.id !== movingTask.id ||
      typeof value.widgetId !== "string"
    )
      return null;
    return {
      movingTask: { id: movingTask.id, date: movingTask.date },
      source,
      widgetId: value.widgetId,
    };
  } catch {
    return null;
  }
}

export function PlannerMoveTaskDialog({
  movingTask,
  items,
  hasTodo,
  busy,
  failure,
  onChange,
  onMove,
  onClose,
  persistDraft = false,
  widgetId,
}: {
  movingTask: PlannerMovingTask;
  items: DataRecord[];
  hasTodo: boolean;
  busy: boolean;
  failure: { message: string } | null;
  onChange: (movingTask: PlannerMovingTask) => void;
  onMove: (item: DataRecord, date: string) => Promise<boolean>;
  onClose: () => void;
  persistDraft?: boolean;
  widgetId?: string;
}): ReactElement {
  const [restored] = useState(() => (persistDraft ? readPlannerMoveDraft() : null));
  const [source, setSource] = useState(
    () => restored?.source ?? items.find((item) => item.id === movingTask.id),
  );
  const [sourceWidget] = useState(() => restored?.widgetId ?? widgetId);
  const [storageError, setStorageError] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const current = items.find((item) => item.id === movingTask.id);
  const conflict =
    persistDraft &&
    (!source || sourceWidget !== widgetId || JSON.stringify(current) !== JSON.stringify(source));
  useLayoutEffect(() => {
    if (!persistDraft || !source || !sourceWidget) return;
    try {
      localStorage.setItem(
        PLANNER_MOVE_DRAFT_KEY,
        JSON.stringify({ movingTask, source, widgetId: sourceWidget }),
      );
      setStorageError(false);
    } catch {
      setStorageError(true);
    }
  }, [persistDraft, movingTask, source, sourceWidget]);
  function close(): void {
    if (persistDraft) {
      try {
        localStorage.removeItem(PLANNER_MOVE_DRAFT_KEY);
      } catch {
        setStorageError(true);
        return;
      }
    }
    onClose();
  }
  return (
    <Dialog
      isOpen
      title="할 일 옮기기"
      size="small"
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <form
        className={s.form}
        onSubmit={async (event) => {
          event.preventDefault();
          const item = items.find((value) => value.id === movingTask.id);
          if (
            !conflict &&
            !storageError &&
            item &&
            (await onMove(item, movingTask.date)) &&
            mounted.current
          )
            close();
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
        {conflict && (
          <p role="alert" className={s.error}>
            할 일이 바뀌었어요. 취소하고 최신 할 일을 확인해 주세요.
          </p>
        )}
        <FormField label="옮길 할 일">
          <Select
            fill
            value={movingTask.id}
            disabled={busy}
            onChange={(event) => {
              setSource(items.find((item) => item.id === event.target.value));
              onChange({ ...movingTask, id: event.target.value });
            }}
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
          <TextInput
            type="date"
            fill
            required
            disabled={busy}
            value={movingTask.date}
            onChange={(event) => onChange({ ...movingTask, date: event.target.value })}
          />
        </FormField>
        <div className={s.actions}>
          <Button variant="ghost" disabled={busy} onClick={close}>
            취소
          </Button>
          <Button
            type="submit"
            disabled={
              busy ||
              conflict ||
              storageError ||
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
