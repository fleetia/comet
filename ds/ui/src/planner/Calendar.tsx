import {
  Fragment,
  useId,
  useRef,
  useState,
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
  displayLabel?: string;
  detail?: string;
  interactive?: boolean;
  kind?: "recorded" | "planned" | "event" | "focus";
};
export type CalendarDayRingProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  segments: readonly CalendarRingSegment[];
  value: ReactNode;
  centerLabel?: ReactNode;
  showCategoryControls?: boolean;
  layout?: "fixed" | "fill";
  showSegmentLabels?: boolean;
  currentMinute?: number;
  currentTimeLabel?: string;
  toolbar?: ReactNode;
  overlay?: ReactNode;
  selection?: { startMinute: number; endMinute: number };
  onRangeSelect?: (range: { startMinute: number; endMinute: number }) => void;
  interactionDisabled?: boolean;
  caption?: ReactNode;
  selectedColor?: PlannerColor;
  onColorChange?: (color: PlannerColor) => void;
  onSegmentClick?: (segment: CalendarRingSegment) => void;
  legend?: ReactNode;
};
function ringPath(startMinute: number, endMinute: number, inner: number, outer: number): string {
  const point = (minute: number, radius: number): string => {
    const angle = (minute / 1440) * Math.PI * 2 - Math.PI / 2;
    return `${286 + radius * Math.cos(angle)},${286 + radius * Math.sin(angle)}`;
  };
  const start = Math.max(0, Math.min(1439.99, startMinute));
  const end = Math.max(start + 0.01, Math.min(1440, endMinute));
  if (end - start === 1440) {
    return `M ${point(0, outer)} A ${outer},${outer} 0 0 1 ${point(720, outer)} A ${outer},${outer} 0 0 1 ${point(1440, outer)} L ${point(1440, inner)} A ${inner},${inner} 0 0 0 ${point(720, inner)} A ${inner},${inner} 0 0 0 ${point(0, inner)} Z`;
  }
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
  centerLabel = "오늘 칠한 시간",
  showCategoryControls = true,
  layout = "fixed",
  showSegmentLabels = false,
  currentMinute,
  currentTimeLabel,
  toolbar,
  overlay,
  selection,
  onRangeSelect,
  interactionDisabled = false,
  caption,
  selectedColor,
  onColorChange,
  onSegmentClick,
  legend,
  className,
  ...props
}: CalendarDayRingProps): JSX.Element {
  const id = useId();
  const drag = useRef<{ pointerId: number; start: number; end: number } | null>(null);
  const [dragRange, setDragRange] = useState<{ startMinute: number; endMinute: number }>();
  const [keyboardMinute, setKeyboardMinute] = useState(0);
  const [keyboardAnchor, setKeyboardAnchor] = useState<number>();
  const selectedRange = dragRange ?? selection;
  function pointerMinute(svg: SVGSVGElement, clientX: number, clientY: number): number | null {
    const rect = svg.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return null;
    }
    const x = ((clientX - rect.left) / rect.width) * 572 - 286;
    const y = ((clientY - rect.top) / rect.height) * 572 - 286;
    const radius = Math.hypot(x, y);
    if (radius < 190 || radius > 252) {
      return null;
    }
    const turn = (Math.atan2(y, x) + Math.PI * 2.5) % (Math.PI * 2);
    return Math.min(1430, Math.floor((turn / (Math.PI * 2)) * 144) * 10);
  }
  function rangeBetween(start: number, end: number): { startMinute: number; endMinute: number } {
    return { startMinute: Math.min(start, end), endMinute: Math.max(start, end) + 10 };
  }
  const visibleSegments = segments.filter(
    (segment) =>
      Number.isFinite(segment.startMinute) &&
      Number.isFinite(segment.endMinute) &&
      segment.endMinute > segment.startMinute &&
      segment.startMinute < 1440 &&
      segment.endMinute > 0,
  );
  const now =
    typeof currentMinute === "number" &&
    Number.isFinite(currentMinute) &&
    currentMinute >= 0 &&
    currentMinute < 1440
      ? currentMinute
      : undefined;
  const nowAngle = now === undefined ? 0 : (now / 1440) * Math.PI * 2 - Math.PI / 2;
  const nowLabel =
    currentTimeLabel ??
    (now === undefined
      ? ""
      : `지금 ${Math.floor(now / 60)}:${String(Math.floor(now % 60)).padStart(2, "0")}`);
  return (
    <div
      {...props}
      className={classes(styles.ring, layout === "fill" && styles.ringFill, className)}
    >
      {toolbar ??
        (showCategoryControls && (
          <div className={styles.ringToolbar}>
            <span className={styles.muted}>칠할 분류</span>
            {ringCategories.map((category) => (
              <button
                key={category.color}
                type="button"
                className={styles.ringCategory}
                style={colorStyle(category.color)}
                aria-pressed={selectedColor === category.color}
                onClick={() => onColorChange?.(category.color)}
              >
                <span aria-hidden className={styles.dot} style={colorStyle(category.color)} />
                {category.label}
              </button>
            ))}
            <span className={styles.ringHint}>한 칸 = 10분</span>
          </div>
        ))}
      <div className={styles.ringCanvas}>
        <svg
          viewBox="0 0 572 572"
          className={styles.ringSvg}
          role="group"
          aria-labelledby={id}
          tabIndex={onRangeSelect && !interactionDisabled ? 0 : undefined}
          aria-describedby={onRangeSelect ? `${id}-instructions` : undefined}
          data-editable={Boolean(onRangeSelect) && !interactionDisabled}
          onPointerDown={(event) => {
            if (!onRangeSelect || interactionDisabled || event.button !== 0) {
              return;
            }
            const minute = pointerMinute(event.currentTarget, event.clientX, event.clientY);
            if (minute === null) {
              return;
            }
            event.preventDefault();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { pointerId: event.pointerId, start: minute, end: minute };
            setDragRange(rangeBetween(minute, minute));
          }}
          onPointerMove={(event) => {
            const current = drag.current;
            if (!current || current.pointerId !== event.pointerId) {
              return;
            }
            const minute = pointerMinute(event.currentTarget, event.clientX, event.clientY);
            if (minute === null) {
              return;
            }
            current.end =
              Math.abs(minute - current.end) > 720 ? (current.end > 720 ? 1430 : 0) : minute;
            setDragRange(rangeBetween(current.start, current.end));
          }}
          onPointerUp={(event) => {
            const current = drag.current;
            if (!current || current.pointerId !== event.pointerId) {
              return;
            }
            drag.current = null;
            setDragRange(undefined);
            if (!interactionDisabled) {
              onRangeSelect?.(rangeBetween(current.start, current.end));
            }
          }}
          onPointerCancel={() => {
            drag.current = null;
            setDragRange(undefined);
          }}
          onLostPointerCapture={() => {
            drag.current = null;
            setDragRange(undefined);
          }}
          onKeyDown={(event) => {
            if (event.target !== event.currentTarget || !onRangeSelect || interactionDisabled) {
              return;
            }
            if (event.key === "Escape") {
              setDragRange(undefined);
              setKeyboardAnchor(undefined);
              return;
            }
            if (["Enter", " "].includes(event.key)) {
              event.preventDefault();
              onRangeSelect(rangeBetween(keyboardAnchor ?? keyboardMinute, keyboardMinute));
              setKeyboardAnchor(undefined);
              setDragRange(undefined);
              return;
            }
            if (
              !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(
                event.key,
              )
            ) {
              return;
            }
            event.preventDefault();
            let next = keyboardMinute + (["ArrowLeft", "ArrowUp"].includes(event.key) ? -10 : 10);
            if (event.key === "Home") {
              next = 0;
            }
            if (event.key === "End") {
              next = 1430;
            }
            next = Math.max(0, Math.min(1430, next));
            const anchor = event.shiftKey ? (keyboardAnchor ?? keyboardMinute) : next;
            setKeyboardMinute(next);
            setKeyboardAnchor(event.shiftKey ? anchor : undefined);
            setDragRange(rangeBetween(anchor, next));
          }}
        >
          <title id={id}>하루 시간 기록</title>
          {Array.from({ length: 144 }, (_, index) => (
            <path
              key={index}
              d={ringPath(index * 10 + 0.4, (index + 1) * 10 - 0.4, 192, 236)}
              className={styles.ringTrack}
            />
          ))}
          {visibleSegments.map((segment) => (
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
              role={onSegmentClick && segment.interactive !== false ? "button" : undefined}
              tabIndex={onSegmentClick && segment.interactive !== false ? 0 : undefined}
              aria-label={segment.label}
              onClick={() => {
                if (segment.interactive !== false) {
                  onSegmentClick?.(segment);
                }
              }}
              onKeyDown={(event) => {
                if (
                  onSegmentClick &&
                  segment.interactive !== false &&
                  (event.key === "Enter" || event.key === " ")
                ) {
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
                x1={286 + 192 * Math.cos(angle)}
                y1={286 + 192 * Math.sin(angle)}
                x2={286 + 236 * Math.cos(angle)}
                y2={286 + 236 * Math.sin(angle)}
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
                x={286 + 136 * Math.cos(angle)}
                y={290 + 136 * Math.sin(angle)}
                textAnchor="middle"
                className={styles.ringLabel}
              >
                {hour}
              </text>
            );
          })}
          {selectedRange && (
            <path
              d={ringPath(selectedRange.startMinute, selectedRange.endMinute, 192, 236)}
              className={styles.ringSelection}
              pointerEvents="none"
            />
          )}
          {showSegmentLabels &&
            visibleSegments.map((segment) => {
              const minute =
                (Math.max(0, segment.startMinute) + Math.min(1440, segment.endMinute)) / 2;
              const angle = (minute / 1440) * Math.PI * 2 - Math.PI / 2;
              const x = 286 + 262 * Math.cos(angle);
              const y = 286 + 262 * Math.sin(angle);
              const anchor =
                Math.cos(angle) > 0.2 ? "start" : Math.cos(angle) < -0.2 ? "end" : "middle";
              const label = segment.displayLabel ?? segment.label;
              return (
                <g key={`label-${segment.id}`} aria-hidden="true" className={styles.ringAnnotation}>
                  <line
                    x1={286 + 240 * Math.cos(angle)}
                    y1={286 + 240 * Math.sin(angle)}
                    x2={286 + 256 * Math.cos(angle)}
                    y2={286 + 256 * Math.sin(angle)}
                    className={styles.ringConnector}
                  />
                  <text x={x} y={y} textAnchor={anchor} className={styles.ringSegmentLabel}>
                    {label.length > 16 ? `${label.slice(0, 15)}…` : label}
                  </text>
                  {segment.detail && (
                    <text x={x} y={y + 16} textAnchor={anchor} className={styles.ringSegmentDetail}>
                      {segment.detail}
                    </text>
                  )}
                </g>
              );
            })}
          {now !== undefined && (
            <g role="img" aria-label={nowLabel} className={styles.ringNow}>
              <circle
                cx={286 + 214 * Math.cos(nowAngle)}
                cy={286 + 214 * Math.sin(nowAngle)}
                r={15}
                className={styles.ringNowHalo}
              />
              <circle
                cx={286 + 214 * Math.cos(nowAngle)}
                cy={286 + 214 * Math.sin(nowAngle)}
                r={7}
                className={styles.ringNowDot}
              />
              <text
                x={286 + 264 * Math.cos(nowAngle)}
                y={290 + 264 * Math.sin(nowAngle)}
                textAnchor={Math.cos(nowAngle) > 0 ? "start" : "end"}
                className={styles.ringNowLabel}
              >
                {nowLabel}
              </text>
            </g>
          )}
          <text x={286} y={258} textAnchor="middle" className={styles.ringCenterLabel}>
            {centerLabel}
          </text>
          <text x={286} y={302} textAnchor="middle" className={styles.ringCenter}>
            {value}
          </text>
          <text x={286} y={324} textAnchor="middle" className={styles.ringCaption}>
            {caption}
          </text>
        </svg>
        {overlay && <div className={styles.ringOverlay}>{overlay}</div>}
      </div>
      {onRangeSelect && (
        <span id={`${id}-instructions`} className={styles.ringInstructions}>
          원을 드래그해 10분 단위로 선택합니다. 키보드는 방향키로 이동하고 Shift와 방향키로 범위를
          늘린 뒤 Enter를 누르세요.
        </span>
      )}
      {onRangeSelect && (
        <span className={styles.ringInstructions} aria-live="polite">
          {dragRange &&
            `${Math.floor(dragRange.startMinute / 60)}시 ${dragRange.startMinute % 60}분부터 ${Math.floor(dragRange.endMinute / 60)}시 ${dragRange.endMinute % 60}분까지 선택`}
        </span>
      )}
      <div className={styles.ringLegend}>
        {legend ??
          [
            { kind: "recorded", label: "칠한 칸" },
            { kind: "event", label: "일정" },
            { kind: "focus", label: "집중 · 자동" },
            { kind: "planned", label: "예정" },
          ].map((item) => (
            <span key={item.kind} className={styles.ringLegendItem}>
              <span aria-hidden="true" className={styles.ringLegendMark} data-kind={item.kind} />
              {item.label}
            </span>
          ))}
      </div>
    </div>
  );
}
