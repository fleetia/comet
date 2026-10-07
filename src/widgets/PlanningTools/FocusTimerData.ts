import { number, record, rows, text, type DataRecord } from "../toolData";
import { dayDate, moveDay, movePeriod, periodAnchor, WEEKDAYS } from "../Planner/plannerData";

export type FocusSegment = { startAt: number; endAt: number };
export type FocusSession = {
  id: string;
  title: string;
  startedAt: number;
  endedAt: number;
  elapsedMs: number;
  outcome: string;
  memo: string;
  eventRef: DataRecord;
  noteRef: DataRecord;
  segments: FocusSegment[];
  active?: boolean;
};
export type FocusPeriod = "day" | "week" | "month" | "year";
export type FocusBucket = {
  key: string;
  label: string;
  startAt: number;
  endAt: number;
  elapsedMs: number;
  sessions: FocusSession[];
};

export function focusSessions(data: DataRecord, now: number): FocusSession[] {
  const saved = rows(data.sessions).map((session) => readSession(session));
  const current = record(data.activeSession);
  if (!text(current.id)) return saved;
  const active = readSession(current);
  const runningSince = number(current.runningSince);
  const endAt = Math.min(now, number(data.deadline) || now);
  const segments = [...active.segments];
  if (
    data.status === "running" &&
    data.mode !== "rest" &&
    runningSince > 0 &&
    endAt > runningSince
  ) {
    segments.push({ startAt: runningSince, endAt });
  }
  return [
    ...saved,
    {
      ...active,
      active: true,
      endedAt: now,
      segments,
      elapsedMs: segments.reduce((sum, segment) => sum + segment.endAt - segment.startAt, 0),
    },
  ];
}

function readSession(session: DataRecord): FocusSession {
  return {
    id: text(session.id),
    title: text(session.title) || "집중",
    startedAt: number(session.startedAt),
    endedAt: number(session.endedAt),
    elapsedMs: number(session.elapsedMs),
    outcome: text(session.outcome),
    memo: text(session.memo),
    eventRef: record(session.eventRef),
    noteRef: record(session.noteRef),
    segments: rows(session.segments)
      .map((segment) => ({ startAt: number(segment.startAt), endAt: number(segment.endAt) }))
      .filter((segment) => segment.endAt > segment.startAt),
  };
}

export function elapsedWithin(session: FocusSession, startAt: number, endAt: number): number {
  return session.segments.reduce(
    (sum, segment) =>
      sum + Math.max(0, Math.min(endAt, segment.endAt) - Math.max(startAt, segment.startAt)),
    0,
  );
}

export function focusBuckets(
  sessions: FocusSession[],
  period: FocusPeriod,
  day: string,
): FocusBucket[] {
  const anchor = period === "day" ? day : periodAnchor(period, day);
  const midnight = (date: string): number => new Date(`${date}T00:00:00`).getTime();
  const ranges: { key: string; label: string; startAt: number; endAt: number }[] = [];
  if (period === "day") {
    for (let hour = 0; hour < 24; hour += 4) {
      const start = new Date(`${day}T00:00:00`);
      const end = new Date(start);
      start.setHours(hour);
      end.setHours(hour + 4);
      ranges.push({
        key: `${day}-${hour}`,
        label: `${hour}시`,
        startAt: start.getTime(),
        endAt: end.getTime(),
      });
    }
  } else if (period === "week") {
    for (let index = 0; index < 7; index++) {
      const date = moveDay(anchor, index);
      ranges.push({
        key: date,
        label: WEEKDAYS[index],
        startAt: midnight(date),
        endAt: midnight(moveDay(date, 1)),
      });
    }
  } else if (period === "month") {
    const end = movePeriod(anchor, "month", 1);
    for (let date = anchor; date < end; date = moveDay(date, 1)) {
      ranges.push({
        key: date,
        label: String(dayDate(date).getDate()),
        startAt: midnight(date),
        endAt: midnight(moveDay(date, 1)),
      });
    }
  } else {
    for (let month = 0; month < 12; month++) {
      const date = movePeriod(anchor, "month", month);
      ranges.push({
        key: date,
        label: `${month + 1}월`,
        startAt: midnight(date),
        endAt: midnight(movePeriod(date, "month", 1)),
      });
    }
  }
  return ranges.map((range) => {
    const matching = sessions.filter(
      (session) => elapsedWithin(session, range.startAt, range.endAt) > 0,
    );
    return {
      ...range,
      sessions: matching,
      elapsedMs: matching.reduce(
        (sum, session) => sum + elapsedWithin(session, range.startAt, range.endAt),
        0,
      ),
    };
  });
}

export function focusDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}분`;
  return `${Math.floor(minutes / 60)}시간${minutes % 60 ? ` ${minutes % 60}분` : ""}`;
}

export function countdown(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}
