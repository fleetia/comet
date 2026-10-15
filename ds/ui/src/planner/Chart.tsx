import type { CSSProperties, HTMLAttributes, JSX, ReactNode } from "react";
import { classes, cssVar, ratio } from "./shared";
import * as styles from "./planner.css";

export type ChartBarItemProps = Omit<HTMLAttributes<HTMLDivElement>, "children"> & {
  label: ReactNode;
  valueLabel: ReactNode;
  value: number;
  max: number;
  current?: boolean;
  empty?: boolean;
};
export function ChartBarItem({
  label,
  valueLabel,
  value,
  max,
  current = false,
  empty = value <= 0,
  className,
  ...props
}: ChartBarItemProps): JSX.Element {
  return (
    <div
      {...props}
      data-current={current}
      className={classes(styles.chartBarItem, current && styles.chartCurrent, className)}
    >
      <span
        className={classes(styles.chartValue, current ? styles.chartCurrentValue : styles.muted)}
      >
        {valueLabel}
      </span>
      <span
        aria-hidden
        className={empty ? styles.chartEmpty : styles.chartBar}
        style={{ [cssVar(styles.extent)]: `${ratio(value, max) * 126}px` } as CSSProperties}
      />
      <span className={current ? styles.chartCurrentLabel : styles.secondary}>{label}</span>
    </div>
  );
}
