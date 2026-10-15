import type { HTMLAttributes, JSX, ReactNode } from "react";
import { classes } from "./shared";
import * as styles from "./planner.css";

export type TripInfoRowProps = Omit<HTMLAttributes<HTMLDivElement>, "title" | "children"> & {
  title: ReactNode;
  detail?: ReactNode;
  value?: ReactNode;
};
export function TripInfoRow({
  title,
  detail,
  value,
  className,
  ...props
}: TripInfoRowProps): JSX.Element {
  return (
    <div {...props} className={classes(styles.tripRow, className)}>
      <div className={classes(styles.stack, styles.grow)}>
        <strong className={styles.tripTitle}>{title}</strong>
        {detail && <span className={styles.secondary}>{detail}</span>}
      </div>
      <span className={styles.tripValue}>{value}</span>
    </div>
  );
}
