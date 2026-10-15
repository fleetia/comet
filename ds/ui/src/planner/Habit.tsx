import {
  useId,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type JSX,
  type ReactNode,
} from "react";
import { Icon } from "@comet/icon";
import { tokens } from "@comet/token";
import { classes, colorStyle, type PlannerColor } from "./shared";
import * as styles from "./planner.css";

export type HabitDayState = "done" | "missed" | "unrecorded" | "counting" | "goalMet";
export type HabitDayProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "color"> & {
  state?: HabitDayState;
  count?: number;
  color?: PlannerColor;
};
const stateLabels: Record<HabitDayState, string> = {
  done: "했어요",
  missed: "못 했어요",
  unrecorded: "아직 기록하지 않음",
  counting: "횟수 기록 중",
  goalMet: "목표 달성",
};

export function HabitDay({
  state = "unrecorded",
  count = 0,
  color = "record",
  className,
  style,
  type = "button",
  "aria-label": label,
  ...props
}: HabitDayProps): JSX.Element {
  return (
    <button
      {...props}
      type={type}
      aria-label={
        label ??
        `${stateLabels[state]}${state === "counting" || state === "goalMet" ? ` ${count}회` : ""}`
      }
      data-state={state}
      style={colorStyle(color, style)}
      className={classes(styles.habitDay, styles.habitStates[state], className)}
    >
      {state === "done" ? (
        <Icon name="check" size={15} />
      ) : state === "missed" ? (
        <Icon name="close" size={12} />
      ) : state === "counting" || state === "goalMet" ? (
        count
      ) : null}
    </button>
  );
}

export type HabitDayCellProps = Omit<HabitDayProps, "state"> & {
  state?: "done" | "skipped" | "empty" | "countComplete" | "countOngoing";
};
const cellStates = {
  done: "done",
  skipped: "missed",
  empty: "unrecorded",
  countComplete: "goalMet",
  countOngoing: "counting",
} as const;
export function HabitDayCell({ state = "empty", ...props }: HabitDayCellProps): JSX.Element {
  return <HabitDay {...props} state={cellStates[state]} />;
}

export type HabitDayData = {
  id: string;
  label: string;
  state: HabitDayState;
  count?: number;
  today?: boolean;
  disabled?: boolean;
};
export type HabitRowProps = Omit<HTMLAttributes<HTMLDivElement>, "title" | "color"> & {
  title: ReactNode;
  description?: ReactNode;
  color?: PlannerColor;
  kind?: "daily" | "weekly" | "count";
  selected?: boolean;
  days: readonly HabitDayData[];
  summary?: ReactNode;
  detail?: ReactNode;
  onDayChange?: (day: HabitDayData, index: number) => void;
};
export function HabitRow({
  title,
  description,
  color = "record",
  kind = "daily",
  selected = false,
  days,
  summary,
  detail,
  onDayChange,
  className,
  ...props
}: HabitRowProps): JSX.Element {
  const id = useId();
  return (
    <div
      {...props}
      data-kind={kind}
      className={classes(styles.habitRow, selected && styles.habitSelected, className)}
    >
      <div className={styles.row}>
        <span aria-hidden className={styles.dot} style={colorStyle(color)} />
        <div className={styles.stack}>
          <span id={id}>{title}</span>
          {description && <span className={styles.muted}>{description}</span>}
        </div>
      </div>
      <div role="group" aria-labelledby={id} className={styles.habitDays}>
        {days.map((day, index) => (
          <span key={day.id} className={day.today ? styles.habitToday : undefined}>
            <HabitDay
              state={day.state}
              count={day.count}
              color={color}
              disabled={day.disabled}
              aria-label={`${day.label}: ${stateLabels[day.state]}${day.count !== undefined ? ` ${day.count}회` : ""}`}
              onClick={() => onDayChange?.(day, index)}
            />
          </span>
        ))}
      </div>
      <div className={classes(styles.stack, styles.habitSummary)}>
        <span>{summary}</span>
        {detail && <span className={styles.muted}>{detail}</span>}
      </div>
    </div>
  );
}

export type HabitWeekTableProps = HTMLAttributes<HTMLDivElement> & {
  days: readonly { id: string; weekday: string; date: string; today?: boolean }[];
  habits: readonly (Omit<HabitRowProps, "onDayChange"> & { id: string })[];
  onHabitDayChange?: (habitId: string, day: HabitDayData, index: number) => void;
  onAdd?: () => void;
  addLabel?: string;
  summaryLabel?: ReactNode;
  disabled?: boolean;
};
export function HabitWeekTable({
  days,
  habits,
  onHabitDayChange,
  onAdd,
  addLabel = "새 습관",
  summaryLabel = "최근 7일",
  disabled = false,
  className,
  ...props
}: HabitWeekTableProps): JSX.Element {
  return (
    <div {...props} className={classes(styles.habitTable, className)}>
      <div className={styles.habitTableInner}>
        <div className={styles.tableHeader}>
          <span>습관</span>
          <div className={styles.habitDays}>
            {days.map((day) => (
              <span key={day.id} className={styles.tableDay}>
                <span>{day.weekday}</span>
                <span style={day.today ? { color: tokens["color/selected-icon"] } : undefined}>
                  {day.date}
                </span>
              </span>
            ))}
          </div>
          <span className={styles.habitSummary}>{summaryLabel}</span>
        </div>
        {habits.map(({ id, ...habit }) => (
          <HabitRow
            key={id}
            {...habit}
            onDayChange={(day, index) => onHabitDayChange?.(id, day, index)}
          />
        ))}
        <div className={styles.tableFooter}>
          <button type="button" className={styles.link} onClick={onAdd} disabled={disabled}>
            + {addLabel}
          </button>
          <span className={styles.muted}>● 했어요　● 못 했어요　◌ 아직　 누를 때마다 바뀌어요</span>
        </div>
      </div>
    </div>
  );
}

export type HabitMonthCalendarProps = HTMLAttributes<HTMLDivElement> & {
  label: string;
  color?: PlannerColor;
  days: readonly ((HabitDayData & { day: number; selected?: boolean }) | null)[];
  onDayChange?: (day: HabitDayData) => void;
};

export function HabitMonthCalendar({
  label,
  color = "record",
  days,
  onDayChange,
  className,
  ...props
}: HabitMonthCalendarProps): JSX.Element {
  return (
    <div {...props} className={classes(styles.habitMonth, className)}>
      <strong className={styles.habitMonthLabel}>{label}</strong>
      <div className={styles.habitMonthGrid}>
        {["월", "화", "수", "목", "금", "토", "일"].map((weekday) => (
          <span key={weekday} className={styles.habitMonthWeekday}>
            {weekday}
          </span>
        ))}
        {days.map((day, index) =>
          day ? (
            <button
              type="button"
              key={day.id}
              disabled={day.disabled}
              aria-label={`${day.label}: ${stateLabels[day.state]}`}
              aria-pressed={day.selected}
              aria-current={day.today ? "date" : undefined}
              data-state={day.state}
              style={colorStyle(color)}
              className={classes(
                styles.habitMonthDay,
                (day.state === "done" || day.state === "goalMet") && styles.habitStates.done,
                day.state === "missed" && styles.habitStates.missed,
              )}
              onClick={() => onDayChange?.(day)}
            >
              {day.day}
            </button>
          ) : (
            <span key={`empty-${index}`} />
          ),
        )}
      </div>
    </div>
  );
}
