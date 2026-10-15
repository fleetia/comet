import {
  Fragment,
  useId,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type JSX,
  type ReactNode,
} from "react";
import { Icon } from "@comet/icon";
import { tokens } from "@comet/token";
import { Checkbox } from "../controls";
import {
  classes,
  cssVar,
  colorStyle,
  plannerColors,
  progressStyle,
  type PlannerColor,
} from "./shared";
import * as styles from "./planner.css";

export type CalendarDayNumberProps = HTMLAttributes<HTMLSpanElement> & { today?: boolean };
export function CalendarDayNumber({
  today = true,
  children,
  className,
  ...props
}: CalendarDayNumberProps): JSX.Element {
  return (
    <span {...props} className={classes(styles.dayNumber, today && styles.todayNumber, className)}>
      {children}
    </span>
  );
}

export type CalendarDayHeaderProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  weekday: ReactNode;
  day: ReactNode;
  today?: boolean;
};
export function CalendarDayHeader({
  weekday,
  day,
  today = false,
  className,
  type = "button",
  ...props
}: CalendarDayHeaderProps): JSX.Element {
  return (
    <button
      {...props}
      type={type}
      aria-current={today ? "date" : undefined}
      className={classes(
        styles.resetButton,
        styles.dayHeader,
        today && styles.todayHeader,
        className,
      )}
    >
      <span className={today ? styles.headerTodayLabel : styles.secondary}>{weekday}</span>
      <CalendarDayNumber today={today} className={styles.headerNumber}>
        {day}
      </CalendarDayNumber>
    </button>
  );
}

export type CalendarTimedEventProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "color" | "title" | "children"
> & { title: ReactNode; time?: ReactNode; color?: PlannerColor; selected?: boolean };
export function CalendarTimedEvent({
  title,
  time,
  color = "comet",
  selected = false,
  className,
  style,
  type = "button",
  ...props
}: CalendarTimedEventProps): JSX.Element {
  return (
    <button
      {...props}
      type={type}
      aria-pressed={selected}
      style={colorStyle(color, style)}
      className={classes(styles.timedEvent, selected && styles.timedSelected, className)}
    >
      <span aria-hidden className={styles.eventDot} />
      <span className={styles.muted}>{time}</span> <span className={styles.ellipsis}>{title}</span>
    </button>
  );
}

export type CalendarEvent = Omit<CalendarTimedEventProps, "onClick"> & { id: string };
export type CalendarDayCellProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  day: ReactNode;
  dateLabel: string;
  today?: boolean;
  otherMonth?: boolean;
  holiday?: ReactNode;
  events?: readonly CalendarEvent[];
  overflowCount?: number;
  disabled?: boolean;
  onDayClick?: () => void;
  onEventClick?: (event: CalendarEvent) => void;
  onOverflowClick?: () => void;
};
export function CalendarDayCell({
  day,
  dateLabel,
  today = false,
  otherMonth = false,
  holiday,
  events = [],
  overflowCount = 0,
  disabled = false,
  onDayClick,
  onEventClick,
  onOverflowClick,
  className,
  ...props
}: CalendarDayCellProps): JSX.Element {
  return (
    <div
      {...props}
      className={classes(styles.dayCell, otherMonth && styles.otherMonthCell, className)}
    >
      <div className={styles.cellHeader}>
        <button
          type="button"
          disabled={disabled}
          className={classes(
            styles.dateButton,
            otherMonth && styles.otherMonth,
            !!holiday && styles.holiday,
          )}
          aria-label={`${dateLabel} 하루 보기`}
          aria-current={today ? "date" : undefined}
          onClick={onDayClick}
        >
          <CalendarDayNumber today={today}>{day}</CalendarDayNumber>
        </button>
        {holiday && <span className={classes(styles.muted, styles.holiday)}>{holiday}</span>}
      </div>
      {events.map(({ id, ...event }) => (
        <CalendarTimedEvent
          key={id}
          {...event}
          disabled={disabled || event.disabled}
          onClick={() => onEventClick?.({ id, ...event })}
        />
      ))}
      {overflowCount > 0 && (
        <button
          type="button"
          disabled={disabled}
          className={styles.overflowLink}
          onClick={onOverflowClick}
        >
          {overflowCount}개 더 보기
        </button>
      )}
    </div>
  );
}

export type CalendarTimeBlockProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color"> & {
  state?: "past" | "planned" | "cometEvent" | "activeFocus" | "selectedRange";
  color?: PlannerColor;
};
export function CalendarTimeBlock({
  state = "past",
  color = "work",
  children,
  className,
  style,
  type = "button",
  "aria-label": label,
  ...props
}: CalendarTimeBlockProps): JSX.Element {
  const blockColor = state === "activeFocus" ? "focus" : state === "cometEvent" ? "life" : color;
  const blockColors = {
    work: tokens["color/component/calendar-block-work"],
    life: tokens["color/component/calendar-block-life"],
    focus: tokens["color/component/calendar-block-focus"],
  };
  const solidColor =
    blockColor === "work" || blockColor === "life" || blockColor === "focus"
      ? blockColors[blockColor]
      : plannerColors[blockColor];
  return (
    <button
      {...props}
      type={type}
      aria-label={label ?? (state === "selectedRange" ? "선택한 시간 범위" : undefined)}
      style={
        {
          ...colorStyle(blockColor),
          [cssVar(styles.accent)]: state === "past" ? solidColor : plannerColors[blockColor],
          [cssVar(styles.fill)]:
            `color-mix(in srgb, ${plannerColors[blockColor]} 12%, transparent)`,
          ...style,
        } as CSSProperties
      }
      className={classes(styles.timeBlock, styles.timeStates[state], className)}
    >
      {state === "activeFocus" && <Icon name="timer" size={11} />}
      {children}
    </button>
  );
}

export type CalendarPeriodProgressProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  value: number;
  total: number;
};
export function CalendarPeriodProgress({
  value,
  total,
  className,
  "aria-label": label,
  ...props
}: CalendarPeriodProgressProps): JSX.Element {
  return (
    <span
      {...props}
      aria-label={label ?? `${total}개 중 ${value}개`}
      className={classes(styles.periodProgress, className)}
    >
      {value}/{total}
    </span>
  );
}

export type CalendarMetric = {
  id: string;
  label: ReactNode;
  value: number;
  valueLabel: ReactNode;
  color: PlannerColor;
};
export type CalendarSummaryTask = {
  id: string;
  label: string;
  checked?: boolean;
  detail?: ReactNode;
  disabled?: boolean;
};
export type CalendarSummaryHabit = { id: string; label: ReactNode; done?: boolean };
export type CalendarSummaryCardProps = Omit<HTMLAttributes<HTMLElement>, "title"> & {
  kind: "categoryTime" | "tasks" | "habits" | "spending";
  title?: ReactNode;
  metrics?: readonly CalendarMetric[];
  tasks?: readonly CalendarSummaryTask[];
  habits?: readonly CalendarSummaryHabit[];
  amount?: ReactNode;
  description?: ReactNode;
  status?: ReactNode;
  viewLabel?: string;
  onViewAll?: () => void;
  onTaskChange?: (id: string, checked: boolean) => void;
};
const summaryTitles = {
  categoryTime: "분류별 시간",
  tasks: "할 일",
  habits: "오늘의 습관",
  spending: "오늘 쓴 돈",
};
export function CalendarSummaryCard({
  kind,
  title,
  metrics = [],
  tasks = [],
  habits = [],
  amount,
  description,
  status,
  viewLabel,
  onViewAll,
  onTaskChange,
  className,
  children,
  ...props
}: CalendarSummaryCardProps): JSX.Element {
  const id = useId();
  const max = Math.max(0, ...metrics.map((metric) => metric.value));
  const actionLabel = viewLabel ?? (kind === "spending" ? "가계부" : "모두 보기");
  return (
    <section
      {...props}
      aria-labelledby={id}
      className={classes(styles.summary, kind === "spending" && styles.spendingSummary, className)}
    >
      <div className={classes(styles.summaryHeader, kind === "spending" && styles.grow)}>
        <div className={styles.stack}>
          <h3 id={id} className={styles.title}>
            {title ?? summaryTitles[kind]}
          </h3>
          {description && <span className={styles.secondary}>{description}</span>}
        </div>
        {kind !== "spending" && (
          <div className={styles.row}>
            <span className={styles.muted}>{status}</span>
            {kind !== "categoryTime" && (
              <button type="button" className={styles.link} onClick={onViewAll}>
                {actionLabel}
              </button>
            )}
          </div>
        )}
      </div>
      {kind === "categoryTime" &&
        metrics.map((metric) => (
          <div key={metric.id} className={styles.metricRow}>
            <span className={classes(styles.row, styles.metricLabel)}>
              <span aria-hidden className={styles.dot} style={colorStyle(metric.color)} />
              {metric.label}
            </span>
            <span className={classes(styles.track, styles.grow)}>
              <span
                className={styles.progress}
                style={progressStyle(metric.value, max, plannerColors[metric.color])}
              />
            </span>
            <span className={styles.metricValue}>{metric.valueLabel}</span>
          </div>
        ))}
      {kind === "tasks" && (
        <ul className={styles.taskList}>
          {tasks.map((task) => (
            <li key={task.id} className={styles.taskLabel}>
              <Checkbox
                shape="round"
                label={
                  <span className={task.checked ? styles.completedTask : undefined}>
                    {task.label}
                  </span>
                }
                checked={task.checked ?? false}
                disabled={task.disabled}
                onChange={(event) => onTaskChange?.(task.id, event.target.checked)}
              />
              <span className={styles.muted}>{task.detail}</span>
            </li>
          ))}
        </ul>
      )}
      {kind === "habits" && (
        <div className={styles.habitSummaryGrid}>
          {habits.map((habit) => (
            <span key={habit.id} className={styles.row}>
              <Icon
                name="star"
                size={15}
                fill={habit.done ? "currentColor" : "none"}
                style={{ color: habit.done ? tokens["color/cat-record"] : tokens["color/ink-3"] }}
              />
              <span className={habit.done ? undefined : styles.secondary}>{habit.label}</span>
            </span>
          ))}
        </div>
      )}
      {kind === "spending" && (
        <>
          <span className={styles.spendingAmount}>{amount}</span>
          <button type="button" className={styles.link} onClick={onViewAll}>
            {actionLabel}
          </button>
        </>
      )}
      {children}
    </section>
  );
}

export type CalendarMonthDay = CalendarDayCellProps & { id: string };
export type CalendarMonthProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  days: readonly CalendarMonthDay[];
  weekdays?: readonly string[];
};
export function CalendarMonth({
  days,
  weekdays = ["월", "화", "수", "목", "금", "토", "일"],
  className,
  ...props
}: CalendarMonthProps): JSX.Element {
  return (
    <div {...props} className={classes(styles.month, className)}>
      <div className={styles.monthGrid}>
        {weekdays.map((day, index) => (
          <span key={`${day}-${index}`} className={styles.monthWeekday}>
            {day}
          </span>
        ))}
        {days.map(({ id, ...day }) => (
          <CalendarDayCell key={id} {...day} className={classes(styles.monthCell, day.className)} />
        ))}
      </div>
    </div>
  );
}

export type CalendarWeekDay = {
  id: string;
  weekday: string;
  day: string;
  label: string;
  today?: boolean;
};
export type CalendarWeekEvent = Omit<CalendarTimeBlockProps, "onClick"> & {
  id: string;
  dayId: string;
  startMinute: number;
  durationMinutes: number;
};
export type CalendarWeekProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  days: readonly CalendarWeekDay[];
  events: readonly CalendarWeekEvent[];
  startHour?: number;
  onDayClick?: (day: CalendarWeekDay) => void;
  onSlotClick?: (day: CalendarWeekDay, minute: number) => void;
  onEventClick?: (event: CalendarWeekEvent) => void;
};
export function CalendarWeek({
  days,
  events,
  startHour = 6,
  onDayClick,
  onSlotClick,
  onEventClick,
  className,
  ...props
}: CalendarWeekProps): JSX.Element {
  const hours = Array.from({ length: 24 }, (_, index) => (startHour + index) % 24);
  return (
    <div {...props} className={classes(styles.week, className)}>
      <div className={styles.weekInner}>
        <div className={styles.weekHeader}>
          <span />
          {days.map((day) => (
            <CalendarDayHeader
              key={day.id}
              weekday={day.weekday}
              day={day.day}
              today={day.today}
              aria-label={`${day.label} 하루 보기`}
              onClick={() => onDayClick?.(day)}
            />
          ))}
        </div>
        <div className={styles.weekBody}>
          {hours.map((hour, row) => (
            <Fragment key={hour}>
              <span className={styles.hourLabel} style={{ gridColumn: 1, gridRow: row + 1 }}>
                {hour}
              </span>
              {days.map((day, column) => (
                <div
                  key={day.id}
                  className={styles.hourSlots}
                  style={{ gridColumn: column + 2, gridRow: row + 1 }}
                >
                  {Array.from({ length: 6 }, (_, slot) => (
                    <button
                      key={slot}
                      type="button"
                      className={styles.hourSlot}
                      aria-label={`${day.label} ${hour}:${String(slot * 10).padStart(2, "0")}`}
                      disabled={!onSlotClick}
                      onClick={() => onSlotClick?.(day, hour * 60 + slot * 10)}
                    />
                  ))}
                </div>
              ))}
            </Fragment>
          ))}
          {events.flatMap((event) => {
            const dayIndex = days.findIndex((day) => day.id === event.dayId);
            if (
              dayIndex < 0 ||
              !Number.isFinite(event.startMinute) ||
              !Number.isFinite(event.durationMinutes) ||
              event.durationMinutes <= 0
            ) {
              return [];
            }
            const offset = (((event.startMinute - startHour * 60) % 1440) + 1440) % 1440;
            const {
              id,
              dayId: _dayId,
              startMinute: _startMinute,
              durationMinutes,
              ...block
            } = event;
            const duration = Math.min(durationMinutes, 1440 - offset);
            const fullHours = offset % 60 === 0 && duration % 60 === 0;
            const firstHour = Math.floor(offset / 60);
            const pieces = fullHours
              ? [{ start: offset, duration }]
              : Array.from({ length: Math.ceil(((offset % 60) + duration) / 60) }, (_, index) => {
                  const start = Math.max(offset, (firstHour + index) * 60);
                  return {
                    start,
                    duration: Math.min(offset + duration, (firstHour + index + 1) * 60) - start,
                  };
                });
            return pieces.map((piece, index) => (
              <div
                key={`${id}-${index}`}
                className={styles.weekEvent}
                style={{
                  gridColumn: dayIndex + 2,
                  gridRow: Math.floor(piece.start / 60) + 1,
                  height: fullHours ? (duration / 60) * 26 : 26,
                  width: `${fullHours ? 100 : (piece.duration / 60) * 100}%`,
                  marginLeft: `${((piece.start % 60) / 60) * 100}%`,
                }}
              >
                <CalendarTimeBlock
                  {...block}
                  className={classes(styles.weekEventBlock, block.className)}
                  onClick={() => onEventClick?.(event)}
                />
              </div>
            ));
          })}
        </div>
      </div>
    </div>
  );
}

export type CalendarRingSegment = {
  id: string;
  startMinute: number;
  endMinute: number;
  color: PlannerColor;
  label: string;
  kind?: "recorded" | "planned" | "event" | "focus";
};
export type CalendarDayRingProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  segments: readonly CalendarRingSegment[];
  value: ReactNode;
  caption?: ReactNode;
  selectedColor?: PlannerColor;
  onColorChange?: (color: PlannerColor) => void;
  onSegmentClick?: (segment: CalendarRingSegment) => void;
  legend?: ReactNode;
};
function ringPath(startMinute: number, endMinute: number, inner: number, outer: number): string {
  const point = (minute: number, radius: number): string => {
    const angle = (minute / 1440) * Math.PI * 2 - Math.PI / 2;
    return `${316 + radius * Math.cos(angle)},${296 + radius * Math.sin(angle)}`;
  };
  const start = Math.max(0, Math.min(1439.99, startMinute));
  const end = Math.max(start + 0.01, Math.min(1440, endMinute));
  const large = end - start > 720 ? 1 : 0;
  return `M ${point(start, outer)} A ${outer},${outer} 0 ${large} 1 ${point(end, outer)} L ${point(end, inner)} A ${inner},${inner} 0 ${large} 0 ${point(start, inner)} Z`;
}
const ringCategories = [
  { color: "work", label: "일" },
  { color: "record", label: "기록" },
  { color: "life", label: "생활" },
  { color: "exercise", label: "운동" },
  { color: "rest", label: "쉼" },
] as const;
export function CalendarDayRing({
  segments,
  value,
  caption,
  selectedColor,
  onColorChange,
  onSegmentClick,
  legend,
  className,
  ...props
}: CalendarDayRingProps): JSX.Element {
  const id = useId();
  return (
    <div {...props} className={classes(styles.ring, className)}>
      <div className={styles.ringToolbar}>
        <span className={styles.muted}>칠할 분류</span>
        {ringCategories.map((category) => (
          <button
            key={category.color}
            type="button"
            className={styles.ringCategory}
            aria-pressed={selectedColor === category.color}
            onClick={() => onColorChange?.(category.color)}
          >
            <span aria-hidden className={styles.dot} style={colorStyle(category.color)} />
            {category.label}
          </button>
        ))}
        <span className={styles.muted}>한 칸 = 10분</span>
      </div>
      <svg viewBox="0 0 632 592" className={styles.ringSvg} role="group" aria-labelledby={id}>
        <title id={id}>하루 시간 기록</title>
        {Array.from({ length: 144 }, (_, index) => (
          <path
            key={index}
            d={ringPath(index * 10 + 0.4, (index + 1) * 10 - 0.4, 192, 236)}
            className={styles.ringTrack}
          />
        ))}
        {segments
          .filter(
            (segment) =>
              Number.isFinite(segment.startMinute) &&
              Number.isFinite(segment.endMinute) &&
              segment.endMinute > segment.startMinute,
          )
          .map((segment) => (
            <path
              key={segment.id}
              d={ringPath(
                segment.startMinute,
                segment.endMinute,
                segment.kind === "event" ? 178 : 192,
                segment.kind === "event" ? 189 : 236,
              )}
              className={styles.ringSegment}
              style={{ [cssVar(styles.fill)]: plannerColors[segment.color] } as CSSProperties}
              data-kind={segment.kind ?? "recorded"}
              role={onSegmentClick ? "button" : undefined}
              tabIndex={onSegmentClick ? 0 : undefined}
              aria-label={segment.label}
              onClick={() => onSegmentClick?.(segment)}
              onKeyDown={(event) => {
                if (onSegmentClick && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  onSegmentClick(segment);
                }
              }}
            >
              <title>{segment.label}</title>
            </path>
          ))}
        {Array.from({ length: 144 }, (_, index) => {
          const angle = (index / 144) * Math.PI * 2 - Math.PI / 2;
          return (
            <line
              key={`divider-${index}`}
              x1={316 + 192 * Math.cos(angle)}
              y1={296 + 192 * Math.sin(angle)}
              x2={316 + 236 * Math.cos(angle)}
              y2={296 + 236 * Math.sin(angle)}
              className={styles.ringDivider}
            />
          );
        })}
        {Array.from({ length: 8 }, (_, index) => {
          const hour = index * 3;
          const angle = (hour / 24) * Math.PI * 2 - Math.PI / 2;
          return (
            <text
              key={hour}
              x={316 + 136 * Math.cos(angle)}
              y={300 + 136 * Math.sin(angle)}
              textAnchor="middle"
              className={styles.ringLabel}
            >
              {hour}
            </text>
          );
        })}
        <text x={316} y={270} textAnchor="middle" className={styles.ringCaption}>
          오늘 칠한 시간
        </text>
        <text x={316} y={310} textAnchor="middle" className={styles.ringCenter}>
          {value}
        </text>
        <text x={316} y={340} textAnchor="middle" className={styles.ringCaption}>
          {caption}
        </text>
      </svg>
      <div className={styles.ringLegend}>
        {legend ?? "칠한 칸　 ·　 일정　 ·　 집중 · 자동　 ·　 예정"}
      </div>
    </div>
  );
}
