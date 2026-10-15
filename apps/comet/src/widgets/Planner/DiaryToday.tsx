import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import {
  CalendarDayRing,
  CalendarSummaryCard,
  NoteCard,
  SegmentedControl,
  type CalendarRingSegment,
} from "@comet/ui";
import { localDay, record, text, type DataRecord } from "../toolData";
import type { WidgetView } from "../types";
import { elapsedWithin, focusDuration, focusSessions } from "../PlanningTools/FocusTimerData";
import {
  eventEnd,
  eventStart,
  eventsOn,
  eventTime,
  frequencyRecords,
  moveDay,
  plannedDay,
  ruleOf,
} from "./plannerData";
import type { DiaryAction, DiaryNote, DiaryState } from "./diaryTypes";
import { DiaryTimeEditor } from "./DiaryTimeEditor";
import {
  diaryTimeCategories,
  manualTimeSegments,
  recordedTimeMinutes,
  timeDuration,
} from "./diaryTime";
import { habitCompleted, habitScheduled } from "./diaryHabitData";
import * as s from "./diary.css";

export function DiaryToday({
  day,
  widgets,
  items,
  events,
  notes,
  busy,
  journal,
  onTask,
  onTasks,
  onEvent,
  onNotes,
  state,
  onDiaryAction,
  onDirtyChange,
  onHabits,
  onLedger,
  tab: selectedTab,
  onTabChange,
}: {
  day: string;
  widgets: WidgetView[];
  items: DataRecord[];
  events: DataRecord[];
  notes: DiaryNote[];
  busy: boolean;
  journal?: ReactNode;
  onTask: (item: DataRecord) => void;
  onTasks: () => void;
  onEvent: (event: DataRecord) => void;
  onNotes: (id: string) => void;
  state?: DiaryState;
  onDiaryAction?: DiaryAction;
  onDirtyChange?: (dirty: boolean) => void;
  onHabits?: () => void;
  onLedger?: () => void;
  tab?: "summary" | "journal";
  onTabChange?: (tab: "summary" | "journal") => void;
}): ReactElement {
  const [now, setNow] = useState(Date.now());
  const [localTab, setLocalTab] = useState<"summary" | "journal">("summary");
  const tab = selectedTab ?? localTab;
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  const start = new Date(`${day}T00:00:00`).getTime();
  const end = new Date(`${moveDay(day, 1)}T00:00:00`).getTime();
  const sessions = widgets
    .filter((widget) => widget.kind === "focus-timer")
    .flatMap((widget) => focusSessions(record(widget.data), now));
  const total = sessions.reduce((sum, session) => sum + elapsedWithin(session, start, end), 0);
  const appointments = eventsOn(events, day);
  const segments: CalendarRingSegment[] = [
    ...sessions
      .filter((session) => session.recordTimeline !== false)
      .flatMap((session) =>
        session.segments
          .filter((segment) => segment.startAt < end && segment.endAt > start)
          .map((segment, index) => ({
            id: `focus:${session.id}:${index}`,
            startMinute: (Math.max(start, segment.startAt) - start) / 60000,
            endMinute: Math.min(1440, (Math.min(end, segment.endAt) - start) / 60000),
            color: "focus" as const,
            kind: "focus" as const,
            label: `${session.title} · ${focusDuration(Math.min(end, segment.endAt) - Math.max(start, segment.startAt))}`,
            displayLabel: session.title,
            detail: "집중 · 자동",
          })),
      ),
    ...appointments
      .filter((event) => !event.allDay && eventEnd(event) > eventStart(event))
      .map((event) => ({
        id: `event:${text(event.id)}`,
        startMinute: Math.max(0, (eventStart(event) - start) / 60000),
        endMinute: Math.min(1440, (eventEnd(event) - start) / 60000),
        color: event.connectionId === "local" ? ("comet" as const) : ("google" as const),
        kind: "event" as const,
        label: `${eventTime(event)} · ${text(event.title)}`,
        displayLabel: text(event.title),
        detail: eventTime(event),
      })),
  ];
  const tasks = items.filter((item) => plannedDay(item) === day);
  const currentMinute = new Date(now).getHours() * 60 + new Date(now).getMinutes();
  const elapsed = day < localDay() ? 1440 : day > localDay() ? 0 : currentMinute;
  const manual = state ? manualTimeSegments(state, day, elapsed) : [];
  const habits = (state?.habits ?? []).filter(
    (habit) => !habit.archived && habitScheduled(habit, day),
  );
  const spent = (state?.ledgerEntries ?? []).filter(
    (entry) => entry.date === day && entry.kind === "expense",
  );
  const completedIds = new Set(
    tasks
      .filter((item) =>
        ruleOf(item).mode === "frequency"
          ? frequencyRecords(item, day).some((entry) => entry.date === day)
          : typeof item.completedAt === "number",
      )
      .map((item) => text(item.id)),
  );
  return (
    <div className={s.todayLayout}>
      {state && onDiaryAction ? (
        <DiaryTimeEditor
          key={day}
          className={s.todayRing}
          state={state}
          date={day}
          onAction={onDiaryAction}
          onDirtyChange={onDirtyChange}
          busy={busy}
          additionalSegments={segments}
          currentMinute={currentMinute}
          onAdditionalSegmentClick={(segment) => {
            const event = appointments.find((item) => `event:${text(item.id)}` === segment.id);
            if (event) onEvent(event);
          }}
        />
      ) : (
        <CalendarDayRing
          className={s.todayRing}
          layout="fill"
          currentMinute={
            day === localDay()
              ? new Date(now).getHours() * 60 + new Date(now).getMinutes()
              : undefined
          }
          currentTimeLabel={
            day === localDay()
              ? `지금 ${new Date(now).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })}`
              : undefined
          }
          showSegmentLabels
          segments={segments}
          centerLabel="집중한 시간"
          showCategoryControls={false}
          value={focusDuration(total)}
          caption="실제 집중한 시간 · 일정은 안쪽 링에 보여요"
          legend="집중한 시간　 ·　 연결된 일정"
        />
      )}
      <aside className={s.todaySummary} aria-label="오늘 요약">
        {journal && (
          <SegmentedControl
            label="오늘 보기"
            appearance="contained"
            value={tab}
            options={[
              { value: "summary", label: "요약" },
              { value: "journal", label: "한 줄 기록" },
            ]}
            onValueChange={(value) => {
              if (value !== "summary" && value !== "journal") return;
              setLocalTab(value);
              onTabChange?.(value);
            }}
          />
        )}
        <div hidden={tab !== "summary"} className={s.todaySummary}>
          <CalendarSummaryCard
            kind="categoryTime"
            title={state ? "분류별 시간" : "집중한 시간"}
            metrics={[
              ...(state
                ? diaryTimeCategories(state)
                    .map((category) => {
                      const minutes = recordedTimeMinutes(
                        manual.filter((segment) =>
                          state.timeRecords?.some(
                            (record) =>
                              record.categoryId === category.id &&
                              segment.id === `manual:${record.id}`,
                          ),
                        ),
                      );
                      return {
                        id: category.id,
                        label: category.name,
                        value: minutes * 60000,
                        valueLabel: timeDuration(minutes),
                        color: category.color,
                      };
                    })
                    .filter((metric) => metric.value > 0)
                : []),
              {
                id: "focus",
                label: "집중",
                value: total,
                valueLabel: focusDuration(total),
                color: "focus",
              },
            ]}
          />
          <CalendarSummaryCard
            kind="tasks"
            status={`${completedIds.size}/${tasks.length}`}
            tasks={tasks.slice(0, 5).map((item) => ({
              id: text(item.id),
              label: text(item.title),
              checked: completedIds.has(text(item.id)),
              disabled: busy || (ruleOf(item).mode === "frequency" && day > localDay()),
            }))}
            onViewAll={onTasks}
            onTaskChange={(id) => {
              const task = tasks.find((item) => item.id === id);
              if (task) onTask(task);
            }}
          >
            {!tasks.length && <p className={s.caption}>이날 계획한 할 일이 없어요.</p>}
          </CalendarSummaryCard>
          {state && (
            <>
              <CalendarSummaryCard
                kind="habits"
                onViewAll={onHabits}
                habits={habits.map((habit) => ({
                  id: habit.id,
                  label: habit.title,
                  done: habitCompleted(
                    habit,
                    state.habitChecks?.find(
                      (check) => check.habitId === habit.id && check.date === day,
                    ),
                  ),
                }))}
              >
                {!habits.length && <p className={s.caption}>이날 예정된 습관이 없어요.</p>}
              </CalendarSummaryCard>
              <CalendarSummaryCard
                kind="spending"
                amount={`${spent.reduce((sum, entry) => sum + entry.amount, 0).toLocaleString("ko-KR")}원`}
                description={`${spent.length}건`}
                onViewAll={onLedger}
              />
            </>
          )}
          <section className={s.summaryCard} aria-label="오늘 일정">
            <h3 className={s.summaryTitle}>오늘 일정</h3>
            {!appointments.length && <p className={s.caption}>이날 예정된 일정이 없어요.</p>}
            {appointments.map((event) => (
              <button
                key={text(event.id)}
                className={s.summaryEvent}
                onClick={() => onEvent(event)}
              >
                <span className={s.caption}>{eventTime(event)}</span>
                <span>{text(event.title)}</span>
              </button>
            ))}
          </section>
          {notes.slice(0, 2).map((note) => (
            <NoteCard
              key={note.id}
              title={note.title}
              description={note.body.split(/\r?\n/)[0]}
              layout="preview"
              onClick={() => onNotes(note.id)}
            />
          ))}
        </div>
        {journal && (
          <div hidden={tab !== "journal"} className={s.todayJournal}>
            {journal}
          </div>
        )}
      </aside>
    </div>
  );
}
