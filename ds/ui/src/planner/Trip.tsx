import type { HTMLAttributes, JSX, MouseEventHandler, ReactNode } from "react";
import { classes } from "./shared";
import * as styles from "./planner.css";

export type TripInfoRowProps = Omit<
  HTMLAttributes<HTMLElement>,
  "title" | "children" | "onClick"
> & {
  title: ReactNode;
  detail?: ReactNode;
  value?: ReactNode;
  /** Makes the whole row one button, e.g. to open the item's editor. */
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
};
export function TripInfoRow({
  title,
  detail,
  value,
  className,
  onClick,
  disabled,
  ...props
}: TripInfoRowProps): JSX.Element {
  const content = (
    <>
      <span className={classes(styles.stack, styles.grow)}>
        <strong className={styles.tripTitle}>{title}</strong>
        {detail && <span className={styles.secondary}>{detail}</span>}
      </span>
      <span className={styles.tripValue}>{value}</span>
    </>
  );
  if (onClick) {
    return (
      <button
        {...props}
        type="button"
        disabled={disabled}
        className={classes(styles.tripRow, styles.tripButton, className)}
        onClick={onClick}
      >
        {content}
      </button>
    );
  }
  return (
    <div {...props} className={classes(styles.tripRow, className)}>
      {content}
    </div>
  );
}
