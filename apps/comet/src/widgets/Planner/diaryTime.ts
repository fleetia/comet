import type { CalendarRingSegment } from "@comet/ui";
import type { DiaryState } from "./diaryTypes";
import type { DiaryTimeCategory, DiaryTimeRecord } from "./diaryTimeTypes";

const defaultCategories: readonly DiaryTimeCategory[] = [
  { id: "work", name: "일", color: "work" },
  { id: "record", name: "기록", color: "record" },
  { id: "life", name: "생활", color: "life" },
  { id: "exercise", name: "운동", color: "exercise" },
  { id: "rest", name: "쉼", color: "rest" },
];
export function diaryTimeCategories(state: DiaryState): readonly DiaryTimeCategory[] {
  return state.timeCategories?.length ? state.timeCategories : defaultCategories;
}
export function diaryTimeRecords(state: DiaryState, date: string): DiaryTimeRecord[] {
  return (state.timeRecords ?? [])
    .filter((record) => record.date === date)
    .sort((a, b) => a.startMinute - b.startMinute || a.id.localeCompare(b.id));
}
export function timeInput(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}
export function parseTimeInput(value: string, end = false): number | null {
  if (end && value === "24:00") {
    return 1440;
  }
  if (!/^([01]\d|2[0-3]):[0-5]0$/.test(value)) {
    return null;
  }
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}
export function timeDuration(minutes: number): string {
  const whole = Math.floor(Math.max(0, minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  return hours ? `${hours}시간${rest ? ` ${rest}분` : ""}` : `${rest}분`;
}
export function manualTimeSegments(
  state: DiaryState,
  date: string,
  elapsedMinute = 1440,
): CalendarRingSegment[] {
  const categories = diaryTimeCategories(state);
  return diaryTimeRecords(state, date).flatMap((record) => {
    const category = categories.find((item) => item.id === record.categoryId);
    const title = record.title || category?.name || "시간 기록";
    const common = {
      color: category?.color ?? ("record" as const),
      label: `${timeInput(record.startMinute)}–${timeInput(record.endMinute)} · ${title}`,
      displayLabel: title,
      detail: category?.name ?? "시간 기록",
    };
    const split = Math.max(record.startMinute, Math.min(record.endMinute, elapsedMinute));
    const segments: CalendarRingSegment[] = [];
    if (split > record.startMinute) {
      segments.push({
        ...common,
        id: `manual:${record.id}`,
        startMinute: record.startMinute,
        endMinute: split,
      });
    }
    if (split < record.endMinute) {
      segments.push({
        ...common,
        id: `manual:${record.id}:planned`,
        startMinute: split,
        endMinute: record.endMinute,
        kind: "planned",
        detail: `${common.detail} · 예정`,
      });
    }
    return segments;
  });
}
export function recordedTimeMinutes(segments: readonly CalendarRingSegment[]): number {
  const ranges = segments
    .filter((segment) => segment.kind !== "event" && segment.kind !== "planned")
    .map((segment) => ({
      start: Math.max(0, segment.startMinute),
      end: Math.min(1440, segment.endMinute),
    }))
    .filter(
      (range) =>
        Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start,
    )
    .sort((a, b) => a.start - b.start);
  let total = 0;
  let end = 0;
  for (const range of ranges) {
    total += Math.max(0, range.end - Math.max(end, range.start));
    end = Math.max(end, range.end);
  }
  return total;
}
