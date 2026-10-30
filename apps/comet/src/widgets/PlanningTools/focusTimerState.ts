import { localDay, number, record, rows, text, type DataRecord } from "../toolData";
import type { WidgetView } from "../types";
import { clockLabel, moveDay } from "../Planner/plannerData";
import { elapsedWithin, focusDuration, focusSessions, type FocusSession } from "./FocusTimerData";

export type Draft = {
  title: string;
  minutes: string;
  todoId: string;
  eventRef: DataRecord | null;
  noteRef: DataRecord | null;
  memo: string;
};

export type FocusTimerState = {
  presentation: "digits" | "dial";
  status: string;
  idle: boolean;
  completionPending: boolean;
  rest: boolean;
  todo: WidgetView | undefined;
  calendar: WidgetView | undefined;
  tasks: DataRecord[];
  selectedTodoId: string;
  linked: DataRecord | undefined;
  todoCompletionKey: string;
  remaining: number;
  duration: number;
  progress: number;
  sessions: FocusSession[];
  restDuration: number;
  longRestDuration: number;
  queue: DataRecord[];
  statusLabel: string;
  today: string;
  todayDurations: number[];
  activeRestDuration: number;
  phase: "ready" | "complete" | "rest-complete" | "rest" | "running";
  timeDescription: string;
  validDuration: boolean;
};

export function focusTimerState(
  data: DataRecord,
  draft: Draft,
  now: number,
  widgets: WidgetView[],
): FocusTimerState {
  const presentation = data.presentation === "digits" ? "digits" : "dial";
  const status = text(data.status) || "idle";
  const idle = status === "idle";
  const completionPending = data.completedFocusPending === true;
  const rest = data.mode === "rest";
  const todo = widgets.find((item) => item.kind === "todo");
  const calendar = widgets.find((item) => item.kind === "calendar");
  const allTasks = rows(record(todo?.data).items);
  const tasks = allTasks.filter((item) => item.completedAt === null);
  const selectedTodoId = tasks.some((item) => item.id === draft.todoId) ? draft.todoId : "";
  const linked = allTasks.find((item) => item.id === data.todoId);
  const todoCompletionKey = `${todo?.id}:${todo?.revision}:${text(linked?.id)}`;
  const remaining = Math.max(
    0,
    idle
      ? Math.round(Number(draft.minutes) * 60000) || 0
      : status === "running"
        ? Math.min(number(data.remainingMs), number(data.deadline) - now)
        : number(data.remainingMs),
  );
  const duration = idle ? Math.round(Number(draft.minutes) * 60000) : number(data.durationMs);
  const progress = duration > 0 ? Math.max(0, Math.min(1, remaining / duration)) : 0;
  const sessions = focusSessions(data, now);
  const restDuration = number(record(data.settings).restDurationMs) || 300000;
  const longRestDuration = number(record(data.settings).longRestDurationMs) || 900000;
  const queue = rows(data.queue);
  const statusLabel =
    status === "running"
      ? rest
        ? "휴식 중"
        : "집중 중"
      : status === "paused"
        ? rest
          ? "휴식 일시정지"
          : "집중 일시정지"
        : status === "finished"
          ? rest
            ? "쉬는 시간이 끝났어요."
            : "집중 시간이 끝났어요."
          : queue.length
            ? `다음 집중 '${text(queue[0].title)}'가 기다리고 있어요.`
            : "시작할 준비가 됐어요.";
  const lastSession = sessions.at(-1);
  const today = localDay(new Date(now));
  const dayStart = new Date(`${today}T00:00:00`).getTime();
  const dayEnd = new Date(`${moveDay(today, 1)}T00:00:00`).getTime();
  const todayDurations = sessions
    .map((session) => elapsedWithin(session, dayStart, dayEnd))
    .filter((elapsed) => elapsed > 0);
  const activeRestDuration = rest ? number(data.durationMs) : restDuration;
  const phase = completionPending
    ? "complete"
    : idle
      ? "ready"
      : status === "finished"
        ? rest
          ? "rest-complete"
          : "complete"
        : rest
          ? "rest"
          : "running";
  const timeDescription =
    phase === "complete"
      ? `${clockLabel(lastSession?.startedAt || now)} – ${clockLabel(lastSession?.endedAt || now)} · ${focusDuration(lastSession?.elapsedMs || 0)} 집중`
      : phase === "rest-complete"
        ? `쉬는 시간 ${focusDuration(number(data.durationMs))}이 끝났어요`
        : status === "paused"
          ? "준비되면 다시 시작해요"
          : idle
            ? `${clockLabel(now)} → ${clockLabel(now + remaining)}`
            : `${clockLabel(number(data.deadline) || now + remaining)}에 끝나요`;
  const validDuration = Number.isFinite(duration) && duration >= 1000 && duration <= 86400000;

  return {
    presentation,
    status,
    idle,
    completionPending,
    rest,
    todo,
    calendar,
    tasks,
    selectedTodoId,
    linked,
    todoCompletionKey,
    remaining,
    duration,
    progress,
    sessions,
    restDuration,
    longRestDuration,
    queue,
    statusLabel,
    today,
    todayDurations,
    activeRestDuration,
    phase,
    timeDescription,
    validDuration,
  };
}
