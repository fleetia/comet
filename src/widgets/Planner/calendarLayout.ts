import { text, type DataRecord } from "../toolData";
import { eventEnd, eventStart, moveDay, movePeriod, periodAnchor } from "./plannerData";

type AllDaySegment = {
  event: DataRecord;
  start: number;
  span: number;
  lane: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
};

type TimedPlacement = {
  event: DataRecord;
  start: number;
  finish: number;
  lane: number;
  laneCount: number;
};

export function allDaySegments(events: DataRecord[], weekStart: string): AllDaySegment[] {
  const boundaries = Array.from({ length: 8 }, (_, i) =>
    new Date(`${moveDay(weekStart, i)}T00:00:00`).getTime(),
  );
  const segments = events
    .filter((event) => event.allDay === true && !event.cancelled)
    .map((event) => ({ event, begin: eventStart(event), end: eventEnd(event) }))
    .filter(({ begin, end }) => end > begin && begin < boundaries[7] && end > boundaries[0])
    .map(({ event, begin, end }) => {
      const start = Math.max(0, boundaries.findIndex((boundary) => boundary > begin) - 1);
      const finish = boundaries.findIndex((boundary) => boundary >= end);
      return {
        event,
        start,
        span: (finish < 0 ? 7 : finish) - start,
        lane: 0,
        continuesBefore: begin < boundaries[0],
        continuesAfter: end > boundaries[7],
        duration: end - begin,
      };
    })
    .sort(
      (a, b) =>
        a.start - b.start ||
        b.duration - a.duration ||
        text(a.event.id).localeCompare(text(b.event.id)),
    );
  const lanes: number[] = [];
  return segments.map(({ duration: _duration, ...segment }) => {
    const occupied = ((1 << segment.span) - 1) << segment.start;
    let lane = lanes.findIndex((mask) => (mask & occupied) === 0);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = (lanes[lane] || 0) | occupied;
    return { ...segment, lane };
  });
}

export function monthDays(day: string): string[] {
  const first = periodAnchor("week", periodAnchor("month", day));
  const last = moveDay(movePeriod(day, "month", 1), -1);
  const end = moveDay(periodAnchor("week", last), 7);
  const days: string[] = [];
  for (let date = first; date < end; date = moveDay(date, 1)) days.push(date);
  return days;
}

export function timedPlacements(events: DataRecord[], date: string): TimedPlacement[] {
  const dayStart = new Date(`${date}T00:00:00`).getTime();
  const dayEnd = new Date(`${moveDay(date, 1)}T00:00:00`).getTime();
  function hour(at: number): number {
    if (at <= dayStart) return 0;
    if (at >= dayEnd) return 24;
    const time = new Date(at);
    return time.getHours() + time.getMinutes() / 60 + time.getSeconds() / 3600;
  }
  const daily = events
    .filter((event) => !event.allDay && !event.cancelled)
    .map((event) => ({ event, begin: eventStart(event), end: eventEnd(event) }))
    .filter(({ begin, end }) =>
      end === begin
        ? begin >= dayStart && begin < dayEnd
        : end > begin && begin < dayEnd && end > dayStart,
    )
    .map(({ event, begin, end }) => ({
      event,
      begin: Math.max(dayStart, begin),
      end: Math.min(dayEnd, end),
    }))
    .sort(
      (a, b) =>
        a.begin - b.begin || b.end - a.end || text(a.event.id).localeCompare(text(b.event.id)),
    );
  const placements: TimedPlacement[] = [];
  let groupStart = 0;
  let groupEnd = dayStart;
  let lanes: number[] = [];
  function finishGroup(): void {
    for (let i = groupStart; i < placements.length; i++) placements[i].laneCount = lanes.length;
  }
  for (const { event, begin, end } of daily) {
    const occupiedEnd = end === begin ? end + 1 : end;
    if (begin >= groupEnd) {
      finishGroup();
      groupStart = placements.length;
      lanes = [];
    }
    groupEnd = Math.max(groupEnd, occupiedEnd);
    let lane = lanes.findIndex((until) => until <= begin);
    if (lane < 0) lane = lanes.length;
    lanes[lane] = occupiedEnd;
    const start = hour(begin);
    placements.push({ event, start, finish: Math.max(start, hour(end)), lane, laneCount: 0 });
  }
  finishGroup();
  return placements;
}
