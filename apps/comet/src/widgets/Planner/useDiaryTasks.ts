import { useState } from "react";
import { command } from "../../hooks/useSnapshot";
import { record, rows, text, type DataRecord } from "../toolData";
import type { WidgetView } from "../types";
import { preparationFocusInput } from "../PreparationTool/preparationData";
import { taskFocusInput } from "../PlanningTools/FocusTimerData";
import type { DiaryAction } from "./diaryTypes";
import { plannedDay, ruleOf } from "./plannerData";
import type { DiaryWidgetActions } from "./useDiaryWidgetActions";

export type DiaryCompletionUndo = {
  id: string;
  title: string;
  date: string;
  frequency: boolean;
};

export type DiaryTasks = {
  completionUndo: DiaryCompletionUndo | null;
  planTask: (item: DataRecord, toDate: string) => Promise<boolean>;
  createTask: (title: string, plannedDate: string | null) => Promise<string | null>;
  toggleTask: (item: DataRecord, date?: string) => Promise<boolean>;
  undoCompletion: () => Promise<void>;
  focusTask: (item: DataRecord) => Promise<void>;
  focusEnvelope: () => Promise<void>;
};

export function useDiaryTasks({
  actions: { latestWidgets, run, execute, act, ensureWidget },
  diaryAction,
  todo,
  timer,
  calendar,
  envelope,
  events,
  day,
  reload,
  setFailure,
  setNotice,
}: {
  actions: DiaryWidgetActions;
  diaryAction: DiaryAction;
  todo: WidgetView | undefined;
  timer: WidgetView | undefined;
  calendar: WidgetView | undefined;
  envelope: DataRecord | undefined;
  events: DataRecord[];
  day: string;
  reload: () => void;
  setFailure: (failure: string | null) => void;
  setNotice: (notice: string) => void;
}): DiaryTasks {
  const [completionUndo, setCompletionUndo] = useState<DiaryCompletionUndo | null>(null);

  function planTask(item: DataRecord, toDate: string): Promise<boolean> {
    const fromDate = plannedDay(item);
    if (fromDate === toDate) return Promise.resolve(true);
    return fromDate
      ? diaryAction("move-record", {
          todoId: text(item.id),
          fromDate,
          toDate,
          title: text(item.title),
        })
      : act("plan", { ids: [text(item.id)], date: toDate });
  }
  async function createTask(title: string, plannedDate: string | null): Promise<string | null> {
    const result = await run(async () => {
      const target = await ensureWidget("todo");
      return execute("add", { title, plannedDate }, target);
    });
    return result?.value ?? null;
  }
  async function toggleTask(item: DataRecord, date = day): Promise<boolean> {
    const frequency = ruleOf(item).mode === "frequency";
    const entry = rows(item.frequencyRecords).find((value) => value.date === date);
    const completed = frequency ? !!entry : typeof item.completedAt === "number";
    const ok = await act(
      frequency ? (entry ? "undo-frequency" : "record-frequency") : completed ? "undo" : "complete",
      {
        id: text(item.id),
        ...(frequency ? (entry ? { recordId: text(entry.id) } : { date }) : {}),
      },
    );
    if (ok)
      setCompletionUndo(
        completed ? null : { id: text(item.id), title: text(item.title), date, frequency },
      );
    return ok;
  }
  async function undoCompletion(): Promise<void> {
    if (!completionUndo || !todo) return;
    const { id, date, frequency } = completionUndo;
    const latest = latestWidgets.current.find((widget) => widget.id === todo.id) ?? todo;
    const item = rows(record(latest.data).items).find((value) => value.id === id);
    const entry = rows(item?.frequencyRecords).find((value) => value.date === date);
    if (frequency && !entry) {
      setFailure("최신 완료 기록을 불러온 뒤 다시 취소해 주세요.");
      reload();
      return;
    }
    if (
      await act(
        frequency ? "undo-frequency" : "undo",
        frequency ? { id, recordId: text(entry?.id) } : { id },
        latest,
      )
    )
      setCompletionUndo(null);
  }
  async function focusTask(item: DataRecord): Promise<void> {
    if (!timer) {
      await run(() => command("open_planner_settings", { kind: "focus-timer" }));
      return;
    }
    if (await act("start", taskFocusInput(item), timer)) {
      setNotice("25분 집중을 시작했어요. 할 일 완료는 직접 표시해 주세요.");
      await run(() => command("open_widget", { id: timer.id }));
    }
  }
  async function focusEnvelope(): Promise<void> {
    if (!envelope) return;
    if (!timer) {
      await run(() => command("open_planner_settings", { kind: "focus-timer" }));
      return;
    }
    const event = events.find((value) => value.id === envelope.eventId);
    if (await act("start", preparationFocusInput(envelope, event, calendar), timer)) {
      setNotice("봉투를 준비하는 25분 집중을 시작했어요.");
      await run(() => command("open_widget", { id: timer.id }));
    }
  }
  return {
    completionUndo,
    planTask,
    createTask,
    toggleTask,
    undoCompletion,
    focusTask,
    focusEnvelope,
  };
}
