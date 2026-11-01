import { useEffect, useState } from "react";
import { command } from "../../hooks/useSnapshot";
import { record, rows, text, type DataRecord } from "../toolData";
import type { WidgetSnapshot } from "../types";
import type { DiaryWidgetActions } from "./useDiaryWidgetActions";

export type DiaryCalendarDraft = {
  date: string;
  event?: DataRecord;
  revision?: number;
  reloadKey?: number;
  values?: CalendarEditorValues;
};

export type CalendarEditorValues = {
  title: string;
  allDay: boolean;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  location: string;
  description: string;
  moveTogether: boolean;
};

const CALENDAR_DRAFT_KEY = "comet:diary-calendar-draft";

function readCalendarDraft(): DiaryCalendarDraft | null {
  try {
    const value = record(JSON.parse(localStorage.getItem(CALENDAR_DRAFT_KEY) ?? "null"));
    const fields = record(value.values);
    if (typeof value.date !== "string" || typeof fields.allDay !== "boolean" ||
        typeof fields.moveTogether !== "boolean" ||
        ["title", "startDate", "endDate", "startTime", "endTime", "location", "description"]
          .some((key) => typeof fields[key] !== "string") ||
        (value.event !== undefined && (!value.event || typeof value.event !== "object" || Array.isArray(value.event)))) return null;
    return value as DiaryCalendarDraft;
  } catch {
    return null;
  }
}

function clearCalendarDraft(): void {
  try { localStorage.removeItem(CALENDAR_DRAFT_KEY); } catch { /* Storage may be unavailable. */ }
}

export type DiaryCalendarEvents = {
  selectedEvent: DataRecord | null;
  setSelectedEvent: (event: DataRecord | null) => void;
  calendarDraft: DiaryCalendarDraft | null;
  setCalendarDraft: (draft: DiaryCalendarDraft | null) => void;
  calendarDirty: boolean;
  setCalendarDirty: (dirty: boolean) => void;
  saveCalendarEvent: (input: DataRecord, deleting?: boolean) => Promise<boolean>;
  reloadCalendarEvent: () => Promise<boolean>;
  persistCalendarDraft: (values: CalendarEditorValues, dirty: boolean) => boolean;
};

const EVENT_FIELDS = [
  "title",
  "allDay",
  "startDate",
  "endDate",
  "startAt",
  "endAt",
  "timeZone",
  "location",
  "description",
  "cancelled",
  "connectionId",
];

export function useDiaryCalendarEvents({
  actions: { latestWidgets, run, ensureWidget },
  reload,
}: {
  actions: DiaryWidgetActions;
  reload: () => void;
}): DiaryCalendarEvents {
  const [selectedEvent, setSelectedEvent] = useState<DataRecord | null>(null);
  const [calendarDraft, updateCalendarDraft] = useState<DiaryCalendarDraft | null>(readCalendarDraft);
  const [calendarDirty, setCalendarDirty] = useState(false);

  function setCalendarDraft(draft: DiaryCalendarDraft | null): void {
    clearCalendarDraft();
    updateCalendarDraft(draft);
  }
  function persistCalendarDraft(values: CalendarEditorValues, dirty: boolean): boolean {
    if (!calendarDraft) return true;
    try {
      if (dirty) localStorage.setItem(CALENDAR_DRAFT_KEY, JSON.stringify({ ...calendarDraft, values }));
      else localStorage.removeItem(CALENDAR_DRAFT_KEY);
      return true;
    } catch {
      return false;
    }
  }

  async function saveCalendarEvent(input: DataRecord, deleting = false): Promise<boolean> {
    if (!calendarDraft) return false;
    const draft = calendarDraft;
    return Boolean(
      await run(async () => {
        const fresh = await command<WidgetSnapshot>("get_widgets");
        latestWidgets.current = fresh.widgets;
        const target = await ensureWidget("calendar");
        if (draft.event) {
          const current = rows(record(target.data).events).find(
            (event) => event.id === draft.event?.id,
          );
          if (!current || EVENT_FIELDS.some((field) => current[field] !== draft.event?.[field])) {
            throw new Error(
              "이 일정이 다른 화면에서 바뀌었어요. 초안을 확인한 뒤 최신 일정을 다시 열어 주세요.",
            );
          }
        }
        await command("execute_widget", {
          request: {
            requestId: crypto.randomUUID(),
            instanceId: target.id,
            expectedRevision: target.revision,
            action: deleting ? "delete-event" : draft.event ? "update-event" : "create-event",
            input: { ...input, ...(draft.event ? { id: text(draft.event.id) } : {}) },
          },
        });
        reload();
      }),
    );
  }
  async function reloadCalendarEvent(): Promise<boolean> {
    if (!calendarDraft?.event) return false;
    const draft = calendarDraft;
    return Boolean(
      await run(async () => {
        const fresh = await command<WidgetSnapshot>("get_widgets");
        latestWidgets.current = fresh.widgets;
        const widget = fresh.widgets.find((value) => value.kind === "calendar");
        const event = rows(record(widget?.data).events).find(
          (value) => value.id === draft.event?.id,
        );
        if (!widget || !event || event.connectionId !== "local")
          throw new Error("원본 일정을 찾을 수 없어요. 작성 중인 내용은 유지돼요.");
        setCalendarDraft({
          date: draft.date,
          event,
          revision: widget.revision,
          reloadKey: (draft.reloadKey ?? 0) + 1,
        });
      }),
    );
  }
  return {
    selectedEvent,
    setSelectedEvent,
    calendarDraft,
    setCalendarDraft,
    calendarDirty,
    setCalendarDirty,
    saveCalendarEvent,
    reloadCalendarEvent,
    persistCalendarDraft,
  };
}

/** Ticks once a second while the weekly calendar shows the current time. */
export function useCalendarClock(active: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [active]);
  return now;
}
