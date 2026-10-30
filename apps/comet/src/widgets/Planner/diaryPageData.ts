import type { FocusEvent, KeyboardEvent } from "react";
import { record, rows, text, type DataRecord } from "../toolData";
import type { WidgetView } from "../types";
import type { DiaryPageProps } from "./DiaryPage";
import type { DiaryEntry, DiaryMove } from "./diaryTypes";
import { eventsOn, plannedDay } from "./plannerData";

export type Draft = { source: DiaryEntry; text: string; time: string };
export type DiaryPageData = {
  day: string | null;
  referencedTasks: Set<string>;
  scheduledTasks: DataRecord[];
  dayEvents: DataRecord[];
  dayEnvelopes: DataRecord[];
  dayMoves: DiaryMove[];
  displayEntries: DiaryEntry[];
};

export function envelopeTitle(envelope: DataRecord | undefined): string {
  return text(envelope?.title) || text(envelope?.name) || text(envelope?.eventLabel) || "준비 봉투";
}

export function sameEntry(a: DiaryEntry, b: DiaryEntry): boolean {
  return (
    a.kind === b.kind &&
    a.text === b.text &&
    (a.time || "") === (b.time || "") &&
    a.refId === b.refId &&
    a.itemId === b.itemId
  );
}

export function movedDate(value: string, from: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString("ko-KR", {
    ...(value.slice(0, 4) !== from.slice(0, 4) ? { year: "numeric" } : {}),
    month: "long",
    day: "numeric",
  });
}

export function isComposing(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}

export function shouldSaveOnBlur(event: FocusEvent<HTMLElement>): boolean {
  return !(
    event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest("[data-diary-action]")
  );
}

export function getDiaryPageData(
  {
    page,
    date,
    items,
    events,
    envelopes,
    moves,
  }: Pick<DiaryPageProps, "page" | "date" | "items" | "events" | "envelopes" | "moves">,
  entries: DiaryEntry[],
  drafts: Record<string, Draft>,
): DiaryPageData {
  const day = page?.date === null ? null : date;
  const referencedTasks = new Set<string>();
  const uniqueEntries = entries.filter((entry) => {
    if (entry.kind !== "todo" || !entry.refId) return true;
    if (referencedTasks.has(entry.refId)) return false;
    referencedTasks.add(entry.refId);
    return true;
  });
  const scheduledTasks = day
    ? items.filter((item) => plannedDay(item) === day && !referencedTasks.has(text(item.id)))
    : [];
  const dayEvents = day ? eventsOn(events, day) : [];
  const dayEnvelopes = day
    ? envelopes.filter(
        (envelope) =>
          envelope.date === day && !text(envelope.eventId) && envelope.archived !== true,
      )
    : [];
  const dayMoves = moves.filter((move) => move.fromDate === day);
  const orphanDrafts = Object.values(drafts).filter(
    (draft) => !entries.some((entry) => entry.id === draft.source.id),
  );
  const displayEntries = [...uniqueEntries, ...orphanDrafts.map((draft) => draft.source)];

  return {
    day,
    referencedTasks,
    scheduledTasks,
    dayEvents,
    dayEnvelopes,
    dayMoves,
    displayEntries,
  };
}

export function getDiaryWidgetEntryData(
  entry: DiaryEntry,
  widgets: WidgetView[],
): {
  note: DataRecord | undefined | null;
  available: boolean;
  title: string;
} {
  const widget = widgets.find((value) => value.id === entry.refId);
  const note = entry.itemId
    ? rows(record(widget?.data).notes).find((value) => value.id === entry.itemId)
    : null;
  const available = !!widget && (!entry.itemId || !!note);
  const title = note ? text(note.title) || "메모" : entry.text;
  return { note, available, title };
}

export function getDiaryEntryData(
  entry: DiaryEntry,
  {
    drafts,
    entries,
    items,
    envelopes,
    dayMoves,
  }: {
    drafts: Record<string, Draft>;
    entries: DiaryEntry[];
    items: DataRecord[];
    envelopes: DataRecord[];
    dayMoves: DiaryMove[];
  },
): {
  draft: Draft | undefined;
  latest: DiaryEntry | undefined;
  conflict: boolean;
  item: DataRecord | undefined;
  envelope: DataRecord | undefined;
  moved: DiaryMove | undefined;
} {
  const draft = drafts[entry.id];
  const latest = entries.find((value) => value.id === entry.id);
  const conflict = !!draft && (!latest || !sameEntry(latest, draft.source));
  const item = items.find((value) => value.id === entry.refId);
  const envelope = envelopes.find((value) => value.id === entry.refId);
  const moved = dayMoves.filter((move) => move.todoId === entry.refId).at(-1);
  return { draft, latest, conflict, item, envelope, moved };
}
