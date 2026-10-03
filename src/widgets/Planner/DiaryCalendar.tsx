import { Button } from "@fleetia/lagrange";
import { useState, type DragEvent, type ReactElement } from "react";
import { hasWidgetDrag, readWidgetDrag, type WidgetDragPayload } from "../widgetDrag";
import { localDay, text, type DataRecord } from "../toolData";
import { allDaySegments, monthDays } from "./calendarLayout";
import {
  dayDate,
  eventStart,
  eventsOn,
  eventTime,
  frequencyRecords,
  moveDay,
  movePeriod,
  periodAnchor,
  plannedDay,
  ruleOf,
  WEEKDAYS,
} from "./plannerData";
import type { DiaryEntry, DiaryPage } from "./diaryTypes";
import * as s from "./diary.css";

type Appointment =
  | { source: "external"; event: DataRecord; at: number }
  | { source: "local"; entry: DiaryEntry; at: number };

function envelopeTitle(envelope: DataRecord): string {
  return text(envelope.title) || text(envelope.eventLabel) || "준비 봉투";
}
function completed(item: DataRecord, date: string): boolean {
  return ruleOf(item).mode === "frequency"
    ? frequencyRecords(item, date).some((entry) => entry.date === date)
    : typeof item.completedAt === "number";
}
export function diaryMonthDays(month: string): string[] {
  return monthDays(month);
}

export function MiniCalendar({
  day,
  month,
  pages,
  onMonth,
  onDay,
}: {
  day: string;
  month: string;
  pages: DiaryPage[];
  onMonth: (value: string) => void;
  onDay: (value: string) => void;
}): ReactElement {
  return (
    <section aria-label="날짜 찾기">
      <div className={s.miniHead}>
        <span className={s.miniTitle}>
          {dayDate(month).toLocaleDateString("ko-KR", { year: "numeric", month: "long" })}
        </span>
        <div className={s.miniActions}>
          <Button
            variant="quiet"
            size="compact"
            aria-label="목차 이전 달"
            onClick={() => onMonth(movePeriod(month, "month", -1))}
          >
            ‹
          </Button>
          <Button
            variant="quiet"
            size="compact"
            aria-label="목차 다음 달"
            onClick={() => onMonth(movePeriod(month, "month", 1))}
          >
            ›
          </Button>
        </div>
      </div>
      <div className={s.miniGrid}>
        {WEEKDAYS.map((label) => (
          <span key={label} className={s.miniWeekday}>
            {label}
          </span>
        ))}
        {monthDays(month).map((date) => (
          <button
            type="button"
            key={date}
            className={s.miniDay}
            aria-label={`${date} 기록 열기`}
            aria-pressed={date === day}
            aria-current={date === localDay() ? "date" : undefined}
            data-outside={date.slice(0, 7) !== month.slice(0, 7)}
            onClick={() => onDay(date)}
          >
            {dayDate(date).getDate()}
            {pages.some((page) => page.date === date && page.entries.length > 0) && (
              <span className={s.recordDot} aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

export type DiaryCalendarProps = {
  day: string;
  view: "month" | "week";
  pages: DiaryPage[];
  events: DataRecord[];
  items: DataRecord[];
  envelopes: DataRecord[];
  onDay: (date: string) => void;
  onEvent: (event: DataRecord, date: string) => void;
  onEnvelope: (id: string) => void;
  eventColor?: (event: DataRecord) => string;
  onCreateEvent?: (date: string) => void;
  onDropItem?: (payload: WidgetDragPayload, date: string) => void;
};

export function DiaryCalendar({
  day,
  view,
  pages,
  events,
  items,
  envelopes,
  onDay,
  onEvent,
  onEnvelope,
  eventColor,
  onCreateEvent,
  onDropItem,
}: DiaryCalendarProps): ReactElement {
  const [dropDate, setDropDate] = useState<string | null>(null);
  function dragOver(event: DragEvent<HTMLElement>, date: string): void {
    if (!onDropItem || !hasWidgetDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "link";
    setDropDate(date);
  }
  function drop(event: DragEvent<HTMLElement>, date: string): void {
    setDropDate(null);
    const payload = readWidgetDrag(event.dataTransfer);
    if (!payload || !onDropItem) return;
    event.preventDefault();
    event.stopPropagation();
    onDropItem(payload, date);
  }
  const visibleEvents = events.filter((event) => !event.cancelled);
  const openEnvelopes = envelopes.filter((envelope) => !envelope.archived);
  function pageFor(date: string): DiaryPage | undefined {
    return pages.find((page) => page.date === date);
  }
  function tasks(date: string): DataRecord[] {
    return items.filter((item) => plannedDay(item) === date);
  }
  function linkedCount(date: string): number {
    return (
      pageFor(date)?.entries.filter((entry) => entry.kind === "widget" || entry.kind === "envelope")
        .length ?? 0
    );
  }
  function linkedRow(date: string): ReactElement | null {
    const count = linkedCount(date);
    return count ? (
      <button
        key={`links:${date}`}
        type="button"
        className={s.calendarRow}
        aria-label={`${date} 연결 ${count}개 열기`}
        onClick={() => onDay(date)}
      >
        ↗ 연결 {count}개
      </button>
    ) : null;
  }
  function linked(event: DataRecord): DataRecord | undefined {
    return openEnvelopes.find((envelope) => envelope.eventId === event.id);
  }
  function datedEnvelopes(date: string): DataRecord[] {
    return openEnvelopes.filter((envelope) => !text(envelope.eventId) && envelope.date === date);
  }
  function appointments(date: string, includeAllDay: boolean): Appointment[] {
    const external: Appointment[] = eventsOn(visibleEvents, date)
      .filter((event) => includeAllDay || !event.allDay)
      .map((event) => ({ source: "external", event, at: eventStart(event) }));
    const local: Appointment[] = (pageFor(date)?.entries ?? [])
      .filter((entry) => entry.kind === "event")
      .map((entry) => ({
        source: "local",
        entry,
        at: new Date(`${date}T${entry.time || "00:00"}:00`).getTime(),
      }));
    return [...external, ...local].sort((a, b) => a.at - b.at);
  }
  function envelopeLink(envelope: DataRecord): ReactElement {
    return (
      <button
        type="button"
        className={s.envelopeLink}
        aria-label={`${envelopeTitle(envelope)} 준비 봉투 열기`}
        onClick={() => onEnvelope(text(envelope.id))}
      >
        ↗
      </button>
    );
  }
  function appointmentRow(appointment: Appointment, date: string): ReactElement {
    if (appointment.source === "local") {
      const { entry } = appointment;
      return (
        <button
          key={`local:${entry.id}`}
          type="button"
          className={s.calendarRow}
          aria-label={`${date} ${entry.text} 직접 적은 일정 열기`}
          title={`${entry.time || "종일"} ${entry.text}`}
          onClick={() => onDay(date)}
        >
          {entry.time || "○"} {entry.text}
        </button>
      );
    }
    const { event } = appointment;
    const envelope = linked(event);
    return (
      <div
        key={`external:${text(event.id)}`}
        className={s.eventRow}
        style={eventColor ? { borderLeftColor: eventColor(event) } : undefined}
      >
        <button
          type="button"
          className={s.calendarRow}
          title={`${eventTime(event)} ${text(event.title)}`}
          aria-label={`${eventTime(event)} ${text(event.title)} ${event.connectionId === "local" ? "Comet 일정" : "연결 일정"} 열기`}
          onClick={() => onEvent(event, date)}
        >
          {event.allDay ? "○" : eventTime(event).split("–")[0]} {text(event.title)}
        </button>
        {envelope && envelopeLink(envelope)}
      </div>
    );
  }
  function taskRow(item: DataRecord, date: string): ReactElement {
    return (
      <button
        key={`todo:${text(item.id)}`}
        type="button"
        className={s.calendarRow}
        onClick={() => onDay(date)}
        title={text(item.title)}
        aria-label={`${date} ${text(item.title)} 할 일 열기`}
      >
        <span aria-hidden="true">{completed(item, date) ? "✓" : "□"}</span> {text(item.title)}
      </button>
    );
  }
  function envelopeRow(envelope: DataRecord): ReactElement {
    return (
      <button
        key={`envelope:${text(envelope.id)}`}
        type="button"
        className={s.calendarRow}
        title={envelopeTitle(envelope)}
        aria-label={`${envelopeTitle(envelope)} 준비 봉투 열기`}
        onClick={() => onEnvelope(text(envelope.id))}
      >
        {envelopeTitle(envelope)} ↗
      </button>
    );
  }

  if (view === "week") {
    const start = periodAnchor("week", day);
    const dates = Array.from({ length: 7 }, (_, index) => moveDay(start, index));
    const reflectionDay = dates[6];
    const reflection = pageFor(reflectionDay)?.entries.find((entry) => entry.kind === "note");
    return (
      <section className={s.week} aria-label="주간 다이어리">
        {dates.map((date, index) => {
          const notes = pageFor(date)?.entries.filter((entry) => entry.kind === "note") ?? [];
          const hasContent =
            appointments(date, true).length > 0 ||
            tasks(date).length > 0 ||
            datedEnvelopes(date).length > 0 ||
            linkedCount(date) > 0 ||
            notes.length > 0;
          return (
            <section
              className={`${s.weekDay} ${dropDate === date ? s.dropActive : ""}`}
              key={date}
              aria-label={`${date} 기록`}
              onDragOver={(event) => dragOver(event, date)}
              onDragLeave={() => setDropDate(null)}
              onDrop={(event) => drop(event, date)}
            >
              <button
                type="button"
                className={s.weekTitle}
                aria-label={`${date} 하루 펼치기`}
                onClick={() => onDay(date)}
              >
                {dayDate(date).getDate()} {WEEKDAYS[index]}
                {date === localDay() && <span className={s.today}>오늘</span>}
              </button>
              {onCreateEvent && (
                <Button
                  variant="quiet"
                  size="compact"
                  aria-label={`${date} 일정 추가`}
                  onClick={() => onCreateEvent(date)}
                >
                  + 일정
                </Button>
              )}
              <div className={s.weekContent}>
                {appointments(date, true).map((appointment) => appointmentRow(appointment, date))}
                {datedEnvelopes(date).map(envelopeRow)}
                {tasks(date).map((item) => taskRow(item, date))}
                {linkedRow(date)}
                {notes.length > 0 && (
                  <button
                    type="button"
                    className={s.weekNote}
                    onClick={() => onDay(date)}
                    aria-label={`${date} 메모 이어 쓰기`}
                  >
                    {notes.map((entry) => entry.text).join("\n")}
                  </button>
                )}
                {!hasContent && (
                  <button type="button" className={s.weekNote} onClick={() => onDay(date)}>
                    ＋ 이날에 적기
                  </button>
                )}
              </div>
            </section>
          );
        })}
        <button
          type="button"
          className={s.weekReflection}
          onClick={() => onDay(reflectionDay)}
          aria-label="이번 주에 남길 말, 일요일 페이지에 이어 쓰기"
        >
          <strong>이번 주에 남길 말</strong>
          <span className={s.excerpt}>
            {reflection?.text || "한 주를 돌아보고, 일요일 페이지에 적어 보세요."}
          </span>
        </button>
      </section>
    );
  }

  const days = monthDays(day);
  const weeks = Array.from({ length: days.length / 7 }, (_, index) =>
    days.slice(index * 7, index * 7 + 7),
  );
  return (
    <section className={s.calendar} aria-label="월간 다이어리">
      <div className={s.weekday}>
        {WEEKDAYS.map((label) => (
          <span key={label}>{label}</span>
        ))}
      </div>
      {weeks.map((dates) => {
        const bars = allDaySegments(visibleEvents, dates[0]);
        const lanes = Math.max(0, ...bars.map((bar) => bar.lane + 1));
        return (
          <div
            className={s.monthWeek}
            key={dates[0]}
            style={{
              gridTemplateRows: `32px ${lanes ? `repeat(${lanes},26px)` : ""} minmax(68px,1fr)`,
            }}
          >
            {dates.map((date, index) => (
              <div
                key={date}
                className={`${s.cell} ${dropDate === date ? s.dropActive : ""}`}
                data-outside={date.slice(0, 7) !== day.slice(0, 7)}
                style={{ gridColumn: index + 1, gridRow: "1 / -1" }}
                onDoubleClick={() => onCreateEvent?.(date)}
                onDragOver={(event) => dragOver(event, date)}
                onDragLeave={() => setDropDate(null)}
                onDrop={(event) => drop(event, date)}
                title={onCreateEvent ? `${date} 빈 곳을 두 번 눌러 일정 추가` : undefined}
              >
                <button
                  type="button"
                  aria-label={`${date} 하루 펼치기`}
                  aria-pressed={date === day}
                  aria-current={date === localDay() ? "date" : undefined}
                  onClick={() => onDay(date)}
                  onDoubleClick={(event) => event.stopPropagation()}
                  className={`${s.date} ${s.dateButton}`}
                  data-today={date === localDay()}
                  data-selected={date === day}
                >
                  {dayDate(date).getDate()}
                </button>
              </div>
            ))}
            {bars.map(({ event, start, span, lane }) => {
              const envelope = linked(event);
              const color = eventColor?.(event);
              return (
                <div
                  key={text(event.id)}
                  className={s.allDay}
                  style={{
                    gridColumn: `${start + 1} / span ${span}`,
                    gridRow: lane + 2,
                    ...(color
                      ? {
                          backgroundColor: `color-mix(in srgb, ${color} 12%, white)`,
                          color: `color-mix(in srgb, ${color} 80%, #101015)`,
                        }
                      : {}),
                  }}
                >
                  <button
                    type="button"
                    className={s.allDayTitle}
                    onClick={() => onEvent(event, dates[start])}
                    title={text(event.title)}
                  >
                    {text(event.title)}
                  </button>
                  {envelope && envelopeLink(envelope)}
                </div>
              );
            })}
            {dates.map((date, index) => {
              const daily = appointments(date, false);
              const preparations = datedEnvelopes(date);
              const todo = tasks(date);
              const content = [
                ...daily.map((appointment) => appointmentRow(appointment, date)),
                ...preparations.map(envelopeRow),
                ...todo.map((item) => taskRow(item, date)),
                ...(linkedCount(date) ? [linkedRow(date)] : []),
              ];
              const notes =
                pageFor(date)?.entries.filter((entry) => entry.kind === "note").length ?? 0;
              return (
                <div
                  key={`rows-${date}`}
                  className={s.cellRows}
                  style={{ gridColumn: index + 1, gridRow: lanes + 2 }}
                  onDragOver={(event) => dragOver(event, date)}
                  onDragLeave={() => setDropDate(null)}
                  onDrop={(event) => drop(event, date)}
                >
                  {content.slice(0, 3)}
                  {content.length > 3 && (
                    <button
                      type="button"
                      className={s.calendarRow}
                      aria-label={`${date} ${content.length - 3}개 더 보기`}
                      onClick={() => onDay(date)}
                    >
                      + {content.length - 3}개 더 보기
                    </button>
                  )}
                  {notes > 0 && (
                    <button
                      type="button"
                      className={s.recordCount}
                      aria-label={`${date} 기록 ${notes}개 읽기`}
                      onClick={() => onDay(date)}
                    >
                      • 기록 {notes}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </section>
  );
}
