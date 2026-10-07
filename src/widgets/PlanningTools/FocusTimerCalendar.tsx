import { Button, DateField, Dialog, FormField, TextField } from "@fleetia/lagrange";
import { useRef, useState, type ReactElement } from "react";
import { command, errorText } from "../../hooks/useSnapshot";
import { localDay, record, rows, text, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import {
  clockLabel,
  dayDate,
  eventsOn,
  eventTime,
  moveDay,
  periodAnchor,
  WEEKDAYS,
} from "../Planner/plannerData";
import { colorForEvent } from "../Planner/calendarColorData";
import { timedPlacements } from "../Planner/calendarLayout";
import { focusDuration, type FocusSession } from "./FocusTimerData";
import * as s from "./FocusTimer.css";

type Props = {
  calendar?: WidgetView;
  act: ToolAction;
  canPrepare: boolean;
  title: string;
  durationMs: number;
  noteRef: DataRecord | null;
  linkedEvent: DataRecord | null;
  sessions: FocusSession[];
  onPrepare: (event: DataRecord) => Promise<boolean>;
  onSession: (session: FocusSession) => void;
};

export function FocusTimerCalendar({
  calendar,
  act,
  canPrepare,
  title,
  durationMs,
  noteRef,
  linkedEvent,
  sessions,
  onPrepare,
  onSession,
}: Props): ReactElement {
  const [day, setDay] = useState(localDay());
  const [creating, setCreating] = useState(false);
  const [eventTitle, setEventTitle] = useState("");
  const [eventDay, setEventDay] = useState(localDay());
  const [endDay, setEndDay] = useState(localDay());
  const composing = useRef(false);
  const [start, setStart] = useState(() => clockLabel(Date.now()));
  const [end, setEnd] = useState(() => clockLabel(Date.now() + 30 * 60000));
  const [eventNote, setEventNote] = useState<DataRecord | null>(null);
  const [detail, setDetail] = useState<DataRecord | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const data = record(calendar?.data);
  const connections = rows(data.connections);
  const events = rows(data.events).filter(
    (event) =>
      !event.cancelled &&
      (event.connectionId === "local" ||
        connections.some((connection) => connection.id === event.connectionId)),
  );
  const daily = eventsOn(events, day);
  const placements = timedPlacements(daily, day);
  const weekStart = periodAnchor("week", day);
  const dayStart = new Date(`${day}T00:00:00`).getTime();
  const dayEnd = new Date(`${moveDay(day, 1)}T00:00:00`).getTime();
  const actual = sessions.flatMap((session) =>
    session.segments
      .filter((segment) => segment.startAt < dayEnd && segment.endAt > dayStart)
      .map((segment, index) => ({
        session,
        index,
        startAt: Math.max(dayStart, segment.startAt),
        endAt: Math.min(dayEnd, segment.endAt),
      })),
  );
  function hour(at: number): number {
    if (at >= dayEnd) return 24;
    const date = new Date(at);
    return date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
  }
  const firstHour = Math.max(
    0,
    Math.floor(
      Math.min(
        9,
        ...placements.map((item) => item.start),
        ...actual.map((item) => hour(item.startAt)),
      ),
    ),
  );
  const lastHour = Math.min(
    24,
    Math.ceil(
      Math.max(
        18,
        ...placements.map((item) => item.finish),
        ...actual.map((item) => hour(item.endAt)),
      ),
    ),
  );

  async function openSettings(): Promise<void> {
    setError("");
    try {
      await command("open_planner_settings", { kind: "calendar" });
    } catch (cause: unknown) {
      setError(errorText(cause));
    }
  }
  function importFocus(): void {
    setEventTitle(title);
    setEventNote(noteRef);
    const at = new Date(`${eventDay}T${start}:00`).getTime();
    if (Number.isFinite(at)) {
      const finish = new Date(at + durationMs);
      setEndDay(localDay(finish));
      setEnd(clockLabel(finish.getTime()));
    }
  }
  async function create(): Promise<void> {
    if (!calendar || busy) return;
    const startAt = new Date(`${eventDay}T${start}:00`).getTime();
    const endAt = new Date(`${endDay}T${end}:00`).getTime();
    if (
      !eventTitle.trim() ||
      !Number.isFinite(startAt) ||
      !Number.isFinite(endAt) ||
      endAt <= startAt ||
      localDay(new Date(startAt)) !== eventDay ||
      localDay(new Date(endAt)) !== endDay ||
      clockLabel(startAt) !== start ||
      clockLabel(endAt) !== end
    ) {
      setError("제목과 날짜를 확인하고, 종료 시간을 시작 시간보다 늦게 입력해 주세요.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const ok = await act(
        "create-event",
        {
          title: eventTitle.trim(),
          allDay: false,
          startAt,
          endAt,
          timeZone: "local",
          noteRef: eventNote,
        },
        calendar,
      );
      if (!ok) return;
      setDay(eventDay);
      setCreating(false);
      setEventTitle("");
      setEventNote(null);
      setNotice("Comet 캘린더에 일정을 등록했어요.");
    } catch (cause: unknown) {
      setError(errorText(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={s.pane} aria-label="집중 일정">
      <div className={s.heading}>
        <h2 className={s.headingText}>
          {dayDate(day).getMonth() + 1}월 {dayDate(day).getDate()}일
        </h2>
        <div className={s.row}>
          <Button variant="quiet" size="compact" onClick={() => setDay(localDay())}>
            오늘
          </Button>
          <Button
            variant="secondary"
            size="compact"
            onClick={() => {
              setCreating(true);
              setEventDay(day);
              setEndDay(day);
              setError("");
              setNotice("");
            }}
          >
            일정 추가
          </Button>
        </div>
      </div>
      <div className={s.heading}>
        <Button
          variant="quiet"
          size="compact"
          aria-label="이전 주"
          onClick={() => setDay(moveDay(day, -7))}
        >
          ‹
        </Button>
        <span className={s.quiet}>{day.slice(0, 7).replace("-", "년 ")}월</span>
        <Button
          variant="quiet"
          size="compact"
          aria-label="다음 주"
          onClick={() => setDay(moveDay(day, 7))}
        >
          ›
        </Button>
      </div>
      <div className={s.week} aria-label="날짜 선택">
        {WEEKDAYS.map((label, index) => {
          const date = moveDay(weekStart, index);
          return (
            <Button
              key={date}
              className={s.day}
              variant="quiet"
              size="compact"
              aria-pressed={date === day}
              aria-label={date}
              onClick={() => setDay(date)}
            >
              <span>{label}</span>
              <span>{dayDate(date).getDate()}</span>
            </Button>
          );
        })}
      </div>
      {creating &&
        (calendar ? (
          <form
            className={s.form}
            aria-label="일정 빠르게 등록"
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (composing.current || event.nativeEvent.isComposing || event.keyCode === 229)
              )
                event.preventDefault();
            }}
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <div className={s.heading}>
              <strong>새 일정</strong>
              <Button type="button" variant="quiet" size="compact" onClick={importFocus}>
                집중할 일 가져오기
              </Button>
            </div>
            <FormField label="일정 제목" required>
              <TextField
                value={eventTitle}
                maxLength={500}
                onChange={(event) => setEventTitle(event.target.value)}
              />
            </FormField>
            <div className={s.fields}>
              <FormField label="일정 날짜" required>
                <DateField
                  value={eventDay}
                  onChange={(event) => {
                    const next = event.target.value;
                    setEventDay(next);
                    if (endDay === eventDay || endDay < next) setEndDay(next);
                  }}
                />
              </FormField>
              <FormField label="종료 날짜" required>
                <DateField value={endDay} onChange={(event) => setEndDay(event.target.value)} />
              </FormField>
            </div>
            <div className={s.fields}>
              <FormField label="시작" required>
                <TextField
                  type="time"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </FormField>
              <FormField label="종료" required>
                <TextField
                  type="time"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </FormField>
            </div>
            {eventNote && <p className={s.quiet}>연결한 노트 · {text(eventNote.title)}</p>}
            <div className={s.row}>
              <span className={s.quiet}>Comet 캘린더</span>
              <Button variant="primary" disabled={busy} type="submit">
                일정 등록
              </Button>
              <Button
                type="button"
                variant="quiet"
                disabled={busy}
                onClick={() => setCreating(false)}
              >
                취소
              </Button>
            </div>
          </form>
        ) : (
          <div className={s.form}>
            <p>캘린더를 켜면 Comet에 일정을 등록할 수 있어요.</p>
            <Button variant="primary" onClick={() => void openSettings()}>
              캘린더 켜기
            </Button>
            <Button variant="quiet" onClick={() => setCreating(false)}>
              취소
            </Button>
          </div>
        ))}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
      {notice && <p className={s.quiet}>{notice}</p>}
      <h3 className={s.headingText}>등록된 일정</h3>
      {daily.length === 0 && <p className={s.empty}>등록된 일정이 없어요.</p>}
      <div className={s.activityList}>
        {daily.map((event) => (
          <div key={text(event.id)} className={s.item}>
            <Button
              variant="quiet"
              className={s.itemButton}
              onClick={() => setDetail(event)}
              aria-label={`${text(event.title)} 일정 상세`}
            >
              <span className={s.grow}>
                <span className={s.itemTitle}>{text(event.title)}</span>
                <span className={s.caption}>
                  {eventTime(event)} · {event.connectionId === "local" ? "Comet" : "연결한 캘린더"}
                </span>
              </span>
            </Button>
            <Button
              variant="quiet"
              size="compact"
              disabled={!canPrepare}
              onClick={() => void onPrepare(event)}
              aria-label={`${text(event.title)} 이 일정으로 집중 준비`}
            >
              {linkedEvent?.id === event.id ? "연결됨" : "집중 연결"}
            </Button>
          </div>
        ))}
      </div>
      <div className={s.heading}>
        <h3 className={s.headingText}>오늘의 시간</h3>
        <span className={s.quiet}>예정 · 실제 집중</span>
      </div>
      <div
        className={s.timeline}
        style={{ height: (lastHour - firstHour) * 44 + 12 }}
        aria-label="예정 일정과 실제 집중 시간"
      >
        {Array.from({ length: lastHour - firstHour + 1 }, (_, index) => (
          <div key={index} className={s.hour} style={{ top: index * 44 }}>
            <span className={s.hourLabel}>{firstHour + index}:00</span>
          </div>
        ))}
        {placements.map(({ event, start: begin, finish, lane, laneCount }) => (
          <button
            key={text(event.id)}
            type="button"
            className={s.timeBlock}
            style={{
              top: (begin - firstHour) * 44,
              height: Math.max(4, (finish - begin) * 44),
              left: `${(lane * 60) / laneCount}%`,
              width: `calc(${60 / laneCount}% - 5px)`,
              borderLeftColor: colorForEvent(event, connections, record(data.calendarColors)),
            }}
            aria-label={`${text(event.title)} ${eventTime(event)} 상세`}
            title={`${text(event.title)} · ${eventTime(event)}`}
            onClick={() => setDetail(event)}
          >
            {(finish - begin) * 44 > 20 && text(event.title)}
          </button>
        ))}
        {actual.map(({ session, index, startAt, endAt }) => (
          <button
            key={`${session.id}-${index}`}
            type="button"
            className={s.actualBlock}
            style={{
              top: (hour(startAt) - firstHour) * 44,
              height: Math.max(4, (hour(endAt) - hour(startAt)) * 44),
              left: "62%",
              width: "38%",
            }}
            aria-label={`${session.title} 실제 집중 ${focusDuration(endAt - startAt)}`}
            title={`${session.title} · ${focusDuration(endAt - startAt)}`}
            onClick={() => onSession(session)}
          >
            {endAt - startAt > 20 * 60000 &&
              (session.active ? "집중 중" : focusDuration(endAt - startAt))}
          </button>
        ))}
      </div>
      <Dialog
        isOpen={detail !== null}
        title={text(detail?.title) || "일정 상세"}
        closeLabel="일정 상세 닫기"
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
        size="small"
      >
        {detail && (
          <div className={s.pane}>
            <p>{eventTime(detail)}</p>
            <p className={s.quiet}>
              {detail.connectionId === "local" ? "Comet 캘린더" : "연결한 외부 캘린더 · 읽기 전용"}
            </p>
            {text(detail.location) && <p>{text(detail.location)}</p>}
            {text(detail.description) && <p className={s.prose}>{text(detail.description)}</p>}
            {text(record(detail.noteRef).title) && (
              <p>연결한 노트 · {text(record(detail.noteRef).title)}</p>
            )}
            <Button
              variant="primary"
              disabled={!canPrepare}
              onClick={async () => {
                if (await onPrepare(detail)) setDetail(null);
              }}
            >
              이 일정으로 집중 준비
            </Button>
            {!canPrepare && (
              <p className={s.quiet}>지금 집중을 마친 뒤 다음 집중을 준비할 수 있어요.</p>
            )}
          </div>
        )}
      </Dialog>
    </section>
  );
}
