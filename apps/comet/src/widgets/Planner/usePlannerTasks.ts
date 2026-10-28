import { useState } from "react";
import { command } from "../../hooks/useSnapshot";
import { record, rows, text, type DataRecord } from "../toolData";
import type { DiaryState } from "./diaryTypes";
import type { WidgetSnapshot } from "../types";
import { plannedDay, ruleOf } from "./plannerData";
import type { PlannerActions } from "./usePlannerActions";

export type PlannerCompletionUndo = {
  id: string;
  title: string;
  date: string;
  frequency: boolean;
};

export type PlannerTasks = {
  completionUndo: PlannerCompletionUndo | null;
  check: (item: DataRecord) => Promise<void>;
  undoCompletion: () => Promise<void>;
  moveTaskDate: (item: DataRecord, toDate: string | null) => Promise<boolean>;
};

export function usePlannerTasks({
  actions: { run, act, setFailure },
  items,
  recordingDay,
  reload,
}: {
  actions: PlannerActions;
  items: DataRecord[];
  /** The date a completion is recorded on: the plan date on the plans tab, otherwise the day. */
  recordingDay: string;
  reload: () => void;
}): PlannerTasks {
  const [completionUndo, setCompletionUndo] = useState<PlannerCompletionUndo | null>(null);

  async function moveTaskDate(item: DataRecord, toDate: string | null): Promise<boolean> {
    if (typeof item.completedAt === "number") return false;
    const fromDate = plannedDay(item);
    if (fromDate === (toDate || "")) return true;
    if (fromDate && toDate) {
      return run(async () => {
        const diary = await command<DiaryState>("get_diary");
        await command("update_diary", {
          expectedRevision: diary.revision,
          action: "move-record",
          input: { todoId: text(item.id), fromDate, toDate, title: text(item.title) },
        });
      });
    }
    return run(async () => {
      const snapshot = await command<WidgetSnapshot>("get_widgets");
      const todo = snapshot.widgets.find(
        (widget) => widget.kind === "todo",
      );
      const current = rows(record(todo?.data).items).find((value) => value.id === item.id);
      if (
        !todo ||
        !current ||
        typeof current.completedAt === "number" ||
        plannedDay(current) !== fromDate
      ) {
        throw new Error("이 할 일의 계획이 바뀌었어요. 최신 내용을 다시 불러와 확인해 주세요.");
      }
      await command("execute_widget", {
        request: {
          requestId: crypto.randomUUID(),
          instanceId: todo.id,
          expectedRevision: todo.revision,
          action: "plan",
          input: { ids: [text(item.id)], date: toDate },
        },
      });
    });
  }
  async function check(item: DataRecord): Promise<void> {
    const id = text(item.id);
    const date = recordingDay;
    const frequency = ruleOf(item).mode === "frequency";
    const existing = rows(item.frequencyRecords).find((entry) => entry.date === date);
    const completed = frequency ? !!existing : typeof item.completedAt === "number";
    const ok = await act(
      frequency
        ? completed
          ? "undo-frequency"
          : "record-frequency"
        : completed
          ? "undo"
          : "complete",
      frequency ? (existing ? { id, recordId: text(existing.id) } : { id, date }) : { id },
    );
    if (ok) setCompletionUndo(completed ? null : { id, title: text(item.title), date, frequency });
  }
  async function undoCompletion(): Promise<void> {
    if (!completionUndo) return;
    const { id, date, frequency } = completionUndo;
    const current = items.find((item) => item.id === id);
    const entry = rows(current?.frequencyRecords).find((value) => value.date === date);
    if (frequency && !entry) {
      setFailure({ message: "최신 완료 기록을 불러온 뒤 다시 취소해 주세요.", saving: false });
      reload();
      return;
    }
    if (
      await act(
        frequency ? "undo-frequency" : "undo",
        frequency ? { id, recordId: text(entry?.id) } : { id },
      )
    )
      setCompletionUndo(null);
  }
  return { completionUndo, check, undoCompletion, moveTaskDate };
}
