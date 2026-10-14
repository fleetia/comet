import type { HTMLAttributes, JSX } from "react";
import * as styles from "./display.css";

export type BadgeProps = HTMLAttributes<HTMLSpanElement>;
export function Badge({ className, ...props }: BadgeProps): JSX.Element {
  return <span {...props} className={[styles.badge, className].filter(Boolean).join(" ")} />;
}

export type KeycapProps = HTMLAttributes<HTMLElement>;
export function Keycap({ className, ...props }: KeycapProps): JSX.Element {
  return <kbd {...props} className={[styles.keycap, className].filter(Boolean).join(" ")} />;
}

export type StatusIndicatorProps = HTMLAttributes<HTMLSpanElement> & { pulse?: boolean };
export function StatusIndicator({
  className,
  children,
  role = "status",
  pulse = false,
  ...props
}: StatusIndicatorProps): JSX.Element {
  return (
    <span {...props} role={role} className={[styles.live, className].filter(Boolean).join(" ")}>
      <span
        aria-hidden
        className={[styles.liveDot, pulse && styles.livePulse].filter(Boolean).join(" ")}
      />
      {children}
    </span>
  );
}

export type WaitingDotsProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  label?: string;
};
export function WaitingDots({
  label = "응답을 기다리고 있어요",
  className,
  ...props
}: WaitingDotsProps): JSX.Element {
  return (
    <span
      {...props}
      role="status"
      aria-label={label}
      className={[styles.waiting, className].filter(Boolean).join(" ")}
    >
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          aria-hidden
          className={styles.waitingDot}
          style={{ animationDelay: `${index * 160}ms` }}
        />
      ))}
    </span>
  );
}
