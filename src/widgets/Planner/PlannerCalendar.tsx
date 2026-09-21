import { Button } from "@fleetia/lagrange";
import { useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { localDay, text, type DataRecord } from "../toolData";
import { CalendarColors } from "./CalendarColors";
import { colorForEvent } from "./calendarColorData";
import { allDaySegments, monthDays, timedPlacements } from "./calendarLayout";
import {
  clockLabel,
  dayDate,
  eventsOn,
  eventStart,
  eventTime,
  moveDay,
  movePeriod,
  periodAnchor,
  WEEKDAYS,
} from "./plannerData";
import * as s from "./planner.css";

function CalendarIcon(): ReactElement {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M5 1.5v3M11 1.5v3M2 6.5h12M5 9h2M9 9h2M5 11.5h2"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function PlannerCalendar({
  day,
  setDay,
  events,
  selected,
  onSelect,
  connections,
  colors = {},
  onColorChange,
  busy = false,
  side,
}: {
  day: string;
  setDay: (day: string) => void;
  events: DataRecord[];
  selected: string;
  onSelect: (event: DataRecord) => void;
  connections: DataRecord[];
  colors?: DataRecord;
  onColorChange?: (input: { connectionId: string; calendarId: string; color: string }) => void;
  busy?: boolean;
  side: ReactNode;
}): ReactElement {
  const [view, setView] = useState("month");
  const weekStart = periodAnchor("week", day);
  const days = Array.from({ length: 7 }, (_, i) => moveDay(weekStart, i));
  const gridDays = monthDays(day);
  const weeks = Array.from({ length: gridDays.length / 7 }, (_, i) =>
    gridDays.slice(i * 7, i * 7 + 7),
  );
  const placements = days.map((date) => timedPlacements(eventsOn(events, date), date));
  const startHour = Math.floor(Math.min(9, ...placements.flat().map((item) => item.start)));
  const endHour = Math.ceil(Math.max(21, ...placements.flat().map((item) => item.finish)));
  const height = (endHour - startHour) * 44;
  const weekAllDay = allDaySegments(events, weekStart);
  const dailyEvents = eventsOn(events, day);
  const eventStyle = (event: DataRecord): CSSProperties =>
    ({ "--calendar-color": colorForEvent(event, connections, colors) }) as CSSProperties;
  function select(date: string, event?: DataRecord): void {
    setDay(date);
    if (event) onSelect(event);
  }
  function allDayBar(
    segment: ReturnType<typeof allDaySegments>[number],
    dates: string[],
  ): ReactElement {
    const { event, start, span, lane, continuesBefore, continuesAfter } = segment;
    return (
      <button
        type="button"
        className={s.allDayEvent}
        key={text(event.id)}
        aria-label={`종일 ${text(event.title)}`}
        aria-pressed={selected === event.id}
        title={`${text(event.title)} · ${text(event.startDate)}–${moveDay(text(event.endDate), -1)}`}
        data-continues-before={continuesBefore}
        data-continues-after={continuesAfter}
        style={{
          ...eventStyle(event),
          gridColumn: `${start + 1} / span ${span}`,
          gridRow: lane + 2,
        }}
        onClick={() => {
          const covered = dates.slice(start, start + span);
          const date =
            view === "month"
              ? (covered.find((date) => date === day) ??
                covered.find((date) => date.slice(0, 7) === day.slice(0, 7)) ??
                dates[start])
              : dates[start];
          select(date, event);
        }}
      >
        <CalendarIcon />
        <span className={s.ellipsis}>{text(event.title)}</span>
      </button>
    );
  }
  function timedRow(event: DataRecord, date: string, className = s.monthTimedEvent): ReactElement {
    return (
      <button
        type="button"
        key={text(event.id)}
        className={className}
        style={eventStyle(event)}
        aria-label={`${eventTime(event)} ${text(event.title)}`}
        aria-pressed={selected === event.id}
        title={`${eventTime(event)} ${text(event.title)}`}
        onClick={() => select(date, event)}
      >
        <span className={s.eventStripe} />
        <span className={s.ellipsis}>{text(event.title)}</span>
        <span className={s.eventTime}>{event.allDay ? "종일" : clockLabel(eventStart(event))}</span>
      </button>
    );
  }
  return (
    <>
      <div className={s.toolbar}>
        <strong className={s.calendarTitle}>
          {dayDate(day).getFullYear()}년 {dayDate(day).getMonth() + 1}월
        </strong>
        {view === "week" && (
          <span className={s.caption}>
            {dayDate(weekStart).getMonth() + 1}/{dayDate(weekStart).getDate()}–
            {dayDate(moveDay(weekStart, 6)).getMonth() + 1}/
            {dayDate(moveDay(weekStart, 6)).getDate()}
          </span>
        )}
        <div className={s.spacer} />
        <div className={s.viewSwitch} role="group" aria-label="캘린더 보기">
          {[
            ["week", "주"],
            ["month", "월"],
          ].map(([key, label]) => (
            <button
              type="button"
              key={key}
              className={s.viewButton}
              aria-pressed={view === key}
              onClick={() => setView(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={s.calendarNavigation}>
          <Button
            variant="quiet"
            size="compact"
            aria-label="이전 기간"
            onClick={() => setDay(movePeriod(day, view, -1))}
          >
            ‹
          </Button>
          <Button variant="quiet" size="compact" onClick={() => setDay(localDay())}>
            오늘
          </Button>
          <Button
            variant="quiet"
            size="compact"
            aria-label="다음 기간"
            onClick={() => setDay(movePeriod(day, view, 1))}
          >
            ›
          </Button>
        </div>
      </div>
      <div className={s.calendarLayout}>
        <div className={s.calendarMain}>
          {view === "month" ? (
            <div className={s.month} role="region" aria-label="월간 캘린더">
              <div className={s.dayHead}>
                {WEEKDAYS.map((label, i) => (
                  <span key={label} data-weekend={i >= 5}>
                    {label}
                  </span>
                ))}
              </div>
              {weeks.map((dates) => {
                const allDay = allDaySegments(events, dates[0]);
                const laneCount = Math.max(0, ...allDay.map((segment) => segment.lane + 1));
                return (
                  <div
                    className={s.monthWeek}
                    key={dates[0]}
                    style={{
                      gridTemplateRows: `30px ${laneCount ? `repeat(${laneCount}, 24px)` : ""} minmax(0, 1fr)`,
                    }}
                  >
                    {dates.map((date, index) => {
                      const daily = eventsOn(events, date);
                      const timed = daily.filter((event) => !event.allDay);
                      return (
                        <div
                          className={s.monthCell}
                          key={date}
                          data-outside={date.slice(0, 7) !== day.slice(0, 7)}
                          data-weekend={index >= 5}
                          data-selected={date === day}
                          style={{ gridColumn: index + 1, gridRow: "1 / -1" }}
                        >
                          <button
                            type="button"
                            className={s.monthDate}
                            aria-label={`${date} 일정 ${daily.length}개`}
                            aria-pressed={date === day}
                            aria-current={date === localDay() ? "date" : undefined}
                            onClick={() => select(date, daily[0])}
                          >
                            {dayDate(date).getDate()}
                          </button>
                          <div className={s.monthTimedList} style={{ marginTop: laneCount * 24 }}>
                            {timed.slice(0, 3).map((event) => timedRow(event, date))}
                            {timed.length > 3 && (
                              <button
                                type="button"
                                className={s.moreEvents}
                                aria-label={`${date} 일정 ${daily.length}개 모두 보기`}
                                onClick={() => select(date, timed[3])}
                              >
                                +{timed.length - 3}개 더 보기
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    {allDay.map((segment) => allDayBar(segment, dates))}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={s.weekScroll} role="region" aria-label="주간 캘린더">
              <div className={s.week}>
                <span />
                <div className={s.weekDayHead}>
                  {days.map((date, i) => (
                    <button
                      type="button"
                      key={date}
                      className={s.weekDate}
                      aria-pressed={date === day}
                      aria-current={date === localDay() ? "date" : undefined}
                      onClick={() => select(date, eventsOn(events, date)[0])}
                    >
                      <span className={s.caption}>{WEEKDAYS[i]}</span>
                      <span>{dayDate(date).getDate()}</span>
                    </button>
                  ))}
                </div>
                <span className={s.allDayLabel}>종일</span>
                <div
                  className={s.weekAllDay}
                  style={{
                    gridTemplateRows: `0px repeat(${Math.max(1, ...weekAllDay.map((segment) => segment.lane + 1))}, 24px)`,
                  }}
                >
                  {days.map((date, index) => (
                    <div
                      className={s.allDayCell}
                      key={date}
                      style={{ gridColumn: index + 1, gridRow: "1 / -1" }}
                    />
                  ))}
                  {weekAllDay.map((segment) => allDayBar(segment, days))}
                </div>
                <div className={s.timeColumn} style={{ height }}>
                  {Array.from({ length: endHour - startHour + 1 }, (_, i) => (
                    <span key={i} className={s.time} style={{ top: i * 44 }}>
                      {String(startHour + i).padStart(2, "0")}
                    </span>
                  ))}
                </div>
                {days.map((date, index) => (
                  <div
                    key={date}
                    className={s.weekColumn}
                    data-weekend={index >= 5}
                    style={{ height }}
                  >
                    {placements[index].map(({ event, start, finish, lane, laneCount }) => (
                      <button
                        type="button"
                        key={text(event.id)}
                        className={s.calendarEvent}
                        aria-label={`${eventTime(event)} ${text(event.title)}`}
                        aria-pressed={selected === event.id}
                        title={`${eventTime(event)} ${text(event.title)}`}
                        style={{
                          ...eventStyle(event),
                          top: (start - startHour) * 44,
                          height: Math.max(20, (finish - start) * 44),
                          left: `calc(${(lane / laneCount) * 100}% + 2px)`,
                          width: `calc(${100 / laneCount}% - 4px)`,
                        }}
                        onClick={() => select(date, event)}
                      >
                        <span className={s.ellipsis}>{text(event.title)}</span>
                        {(finish - start) * 44 >= 38 && (
                          <span className={s.weekEventTime}>{eventTime(event)}</span>
                        )}
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
          <p className={s.calendarFootnote}>
            기기 시간대 · {Intl.DateTimeFormat().resolvedOptions().timeZone}{" "}
            <span>마지막 갱신 기준 과거 30일~미래 365일</span>
          </p>
        </div>
        <aside className={s.column}>
          {onColorChange && (
            <section className={s.calendarSources}>
              <h3 className={s.heading}>캘린더</h3>
              <CalendarColors
                connections={connections}
                events={events}
                colors={colors}
                disabled={busy}
                onChange={onColorChange}
              />
            </section>
          )}
          <section className={s.section} aria-label="선택한 날짜 일정">
            <h3 className={s.heading}>
              {dayDate(day).toLocaleDateString("ko-KR", {
                month: "long",
                day: "numeric",
                weekday: "short",
              })}
            </h3>
            {dailyEvents.length ? (
              dailyEvents.map((event) => timedRow(event, day, s.agendaEvent))
            ) : (
              <p className={s.caption}>조회한 일정이 없어요.</p>
            )}
          </section>
          {side}
        </aside>
      </div>
    </>
  );
}
