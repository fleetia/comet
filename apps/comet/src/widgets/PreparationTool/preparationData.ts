import { localDay, rows, text, type DataRecord } from "../toolData";
import { frequencyRecords, ruleOf } from "../Planner/plannerData";
import type { WidgetView } from "../types";

export function preparationProgress(
  envelope: DataRecord,
  items: DataRecord[],
  date = localDay(),
): { completed: number; total: number } {
  const ids = Array.isArray(envelope.todoIds)
    ? envelope.todoIds.filter((value): value is string => typeof value === "string")
    : [];
  const checks = rows(envelope.checks);
  return {
    total: ids.length + checks.length,
    completed:
      checks.filter((item) => item.done === true).length +
      items.filter(
        (item) =>
          ids.includes(text(item.id)) &&
          (ruleOf(item).mode === "frequency"
            ? frequencyRecords(item, date).some((entry) => entry.date === date)
            : typeof item.completedAt === "number"),
      ).length,
  };
}

export function preparationFocusInput(
  envelope: DataRecord,
  event?: DataRecord,
  calendar?: WidgetView,
): DataRecord {
  return {
    durationMs: 1500000,
    title: text(envelope.title) || text(envelope.eventLabel) || "준비 봉투",
    todoId: null,
    eventRef:
      event && calendar
        ? {
            calendarWidgetId: calendar.id,
            id: text(event.id),
            title: text(event.title),
            startAt: typeof event.startAt === "number" ? event.startAt : null,
            endAt: typeof event.endAt === "number" ? event.endAt : null,
            connectionId: text(event.connectionId),
            sourceId: text(event.sourceId),
            occurrenceId: text(event.occurrenceId),
          }
        : null,
    noteRef: null,
    memo: "",
  };
}
