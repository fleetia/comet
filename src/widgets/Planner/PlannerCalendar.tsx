import { Button } from "@fleetia/lagrange";
import { useState, type ReactElement, type ReactNode } from "react";
import { localDay, text, type DataRecord } from "../toolData";
import {
  dayDate,
  eventEnd,
  eventsOn,
  eventStart,
  eventTime,
  moveDay,
  movePeriod,
  periodAnchor,
  WEEKDAYS,
} from "./plannerData";
import * as s from "./planner.css";

export function PlannerCalendar({
  day,
  setDay,
  events,
  selected,
  onSelect,
  connections,
  side,
}: {
  day: string;
  setDay: (day: string) => void;
  events: DataRecord[];
  selected: string;
  onSelect: (event: DataRecord) => void;
  connections: DataRecord[];
  side: ReactNode;
}): ReactElement {
  const [view, setView] = useState("week");
  const weekStart = periodAnchor("week", day);
  const days = Array.from({ length: 7 }, (_, i) => moveDay(weekStart, i));
  const monthStart = periodAnchor("month", day);
  const monthGridStart = periodAnchor("week", monthStart);
  const nextMonth = movePeriod(day, "month", 1);
  const cellCount =
    periodAnchor("week", moveDay(nextMonth, -1)) === moveDay(monthGridStart, 28) ? 35 : 42;
  function hourOn(date: string, at: number): number {
    const begin = new Date(`${date}T00:00:00`).getTime(),
      end = new Date(`${moveDay(date, 1)}T00:00:00`).getTime();
    return at <= begin
      ? 0
      : at >= end
        ? 24
        : new Date(at).getHours() + new Date(at).getMinutes() / 60;
  }
  const segments = days.flatMap((date) =>
    eventsOn(events, date)
      .filter((event) => !event.allDay)
      .map((event) => ({
        start: hourOn(date, eventStart(event)),
        end: hourOn(date, eventEnd(event)),
      })),
  );
  const startHour = Math.floor(Math.min(9, ...segments.map((segment) => segment.start)));
  const endHour = Math.ceil(Math.max(21, ...segments.map((segment) => segment.end)));
  const height = (endHour - startHour) * 44;
  const provider = (event: DataRecord): string =>
    text(connections.find((c) => c.id === event.connectionId)?.provider);
  return (
    <>
      <div className={s.toolbar}>
        <strong>
          {dayDate(day).getFullYear()}년 {dayDate(day).getMonth() + 1}월
          {view === "week"
            ? ` ${dayDate(weekStart).getDate()}–${dayDate(moveDay(weekStart, 6)).getDate()}일`
            : ""}
        </strong>
        <Button
          variant="quiet"
          size="compact"
          aria-label="이전 기간"
          onClick={() => setDay(movePeriod(day, view, -1))}
        >
          ‹
        </Button>
        <Button variant="secondary" size="compact" onClick={() => setDay(localDay())}>
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
        <div className={s.spacer} />
        <div className={s.actions} role="group" aria-label="캘린더 보기">
          {[
            ["week", "주"],
            ["month", "월"],
          ].map(([key, label]) => (
            <Button
              key={key}
              variant="quiet"
              size="compact"
              className={s.categoryButton}
              aria-pressed={view === key}
              onClick={() => setView(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
      <div className={s.calendarLayout}>
        <div className={s.column}>
          {view === "month" ? (
            <>
              <div className={s.dayHead}>
                {WEEKDAYS.map((label) => (
                  <span key={label}>{label}</span>
                ))}
              </div>
              <div className={s.month}>
                {Array.from({ length: cellCount }, (_, i) => {
                  const date = moveDay(monthGridStart, i),
                    daily = eventsOn(events, date);
                  return (
                    <button
                      type="button"
                      className={s.monthCell}
                      data-outside={date.slice(0, 7) !== day.slice(0, 7)}
                      aria-label={`${date} 일정 ${daily.length}개`}
                      aria-pressed={date === day}
                      key={date}
                      onClick={() => {
                        setDay(date);
                        if (daily[0]) onSelect(daily[0]);
                      }}
                    >
                      <span>{dayDate(date).getDate()}</span>
                      {daily.slice(0, 3).map((e) => (
                        <span key={text(e.id)} className={s.ellipsis}>
                          {e.allDay ? "종일 " : `${eventTime(e).split("–")[0]} `}
                          {text(e.title)}
                        </span>
                      ))}
                      {daily.length > 3 && <span>+{daily.length - 3}</span>}
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <div className={s.week}>
                <span />
                <div className={s.dayHead} style={{ gridColumn: "2 / -1" }}>
                  {days.map((date, i) => (
                    <Button
                      key={date}
                      variant="quiet"
                      size="compact"
                      className={s.categoryButton}
                      aria-pressed={date === day}
                      onClick={() => {
                        setDay(date);
                        const first = eventsOn(events, date)[0];
                        if (first) onSelect(first);
                      }}
                    >
                      {WEEKDAYS[i]} {dayDate(date).getDate()}
                    </Button>
                  ))}
                </div>
                <span className={s.caption}>종일</span>
                {days.map((date) => (
                  <div key={date} className={s.allDay}>
                    {eventsOn(events, date)
                      .filter((e) => e.allDay)
                      .map((e) => (
                        <button
                          type="button"
                          className={s.eventButton}
                          key={text(e.id)}
                          aria-pressed={selected === e.id}
                          onClick={() => {
                            setDay(date);
                            onSelect(e);
                          }}
                        >
                          {text(e.title)}
                        </button>
                      ))}
                  </div>
                ))}
                <div className={s.timeColumn} style={{ height }}>
                  {Array.from({ length: endHour - startHour + 1 }, (_, i) => (
                    <span key={i} className={s.time} style={{ top: i * 44 }}>
                      {String(startHour + i).padStart(2, "0")}
                    </span>
                  ))}
                </div>
                {days.map((date) => {
                  const daily = eventsOn(events, date).filter((e) => !e.allDay);
                  const lanes: number[] = [];
                  const placements = daily.map((event) => {
                    const start = hourOn(date, eventStart(event)),
                      finish = hourOn(date, eventEnd(event));
                    let lane = lanes.findIndex((until) => until <= start);
                    if (lane === -1) lane = lanes.length;
                    lanes[lane] = finish;
                    return { event, start, finish, lane };
                  });
                  return (
                    <div key={date} className={s.weekColumn} style={{ height }}>
                      {placements.map(({ event, start, finish, lane }) => (
                        <button
                          type="button"
                          key={text(event.id)}
                          className={s.calendarEvent}
                          data-provider={provider(event)}
                          aria-label={`${eventTime(event)} ${text(event.title)}`}
                          aria-pressed={selected === event.id}
                          title={`${eventTime(event)} ${text(event.title)}`}
                          style={{
                            top: (start - startHour) * 44,
                            height: Math.max(18, (finish - start) * 44),
                            left: `${(lane / lanes.length) * 100}%`,
                            width: `${100 / lanes.length}%`,
                          }}
                          onClick={() => {
                            setDay(date);
                            onSelect(event);
                          }}
                        >
                          {text(event.title)}
                          <br />
                          {provider(event) === "google"
                            ? "Google"
                            : provider(event) === "apple"
                              ? "Apple"
                              : "구독"}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <p className={s.caption}>
            연결한 캘린더의 일정만 표시합니다. 기기 시간대:{" "}
            {Intl.DateTimeFormat().resolvedOptions().timeZone}
          </p>
          <p className={s.caption}>
            조회 범위는 마지막 갱신 기준 과거 30일~미래 365일입니다. 범위 밖은 원본 캘린더에서
            확인하세요.
          </p>
        </div>
        <aside className={s.column}>{side}</aside>
      </div>
    </>
  );
}
