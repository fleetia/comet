import { forwardRef, type ButtonHTMLAttributes, type JSX, type ReactNode } from "react";
import { Icon, type IconName } from "@comet/icon";
import { Button, type ButtonProps } from "./Button";
import {
  ActionChip,
  CategoryChip,
  type ActionChipProps,
  type CategoryChipProps,
} from "../display/Chips";
import * as styles from "./actions.css";

export const ProviderButton = forwardRef<HTMLButtonElement, Omit<ButtonProps, "variant">>(
  ({ className, ...props }, ref): JSX.Element => (
    <Button
      {...props}
      ref={ref}
      variant="ghost"
      className={[styles.provider, className].filter(Boolean).join(" ")}
    />
  ),
);
ProviderButton.displayName = "ProviderButton";
export type CounterButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  count: string | number;
  icon: IconName;
  size?: "regular" | "compact";
  badgeSize?: "small" | "medium";
  backdrop?: boolean;
};
export function CounterButton({
  label,
  count,
  icon,
  size = "regular",
  badgeSize = "small",
  backdrop = true,
  className,
  type = "button",
  ...props
}: CounterButtonProps): JSX.Element {
  return (
    <button
      {...props}
      type={type}
      aria-label={`${label} ${count}`}
      className={[
        styles.counter,
        styles.counterSizes[size],
        !backdrop && styles.noBackdrop,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Icon name={icon} size={size === "compact" ? 14 : 22} />
      <span
        className={[styles.countBadge, badgeSize === "medium" && styles.mediumBadge]
          .filter(Boolean)
          .join(" ")}
      >
        {count}
      </span>
    </button>
  );
}
export type CalendarChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  muted?: boolean;
  color?: string;
};
export function CalendarChip({
  muted = false,
  color,
  className,
  children,
  type = "button",
  ...props
}: CalendarChipProps): JSX.Element {
  return (
    <button
      {...props}
      type={type}
      aria-pressed={!muted}
      className={[styles.calendarChip, muted && styles.muted, className].filter(Boolean).join(" ")}
    >
      <span
        aria-hidden
        className={styles.calendarDot}
        style={muted ? undefined : { backgroundColor: color }}
      />
      {children}
    </button>
  );
}
export type CategoryChoiceProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> &
  Pick<CategoryChipProps, "category" | "children"> & {
    selected?: boolean;
    size?: "regular" | "compact" | "medium";
  };
export function CategoryChoice({
  category,
  selected = false,
  size = "regular",
  children,
  className,
  type = "button",
  ...props
}: CategoryChoiceProps): JSX.Element {
  return (
    <button
      {...props}
      type={type}
      aria-pressed={selected}
      className={[styles.categoryButton, className].filter(Boolean).join(" ")}
    >
      <CategoryChip
        category={category}
        className={[
          styles.categoryChoice,
          styles.categorySizes[size],
          selected && styles.categorySelected,
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {children}
      </CategoryChip>
    </button>
  );
}
export function PromptChip({ className, ...props }: ActionChipProps): JSX.Element {
  return <ActionChip {...props} className={[styles.prompt, className].filter(Boolean).join(" ")} />;
}
export type CountChipProps = ActionChipProps & { count: ReactNode; appearance?: "link" | "choice" };
export function CountChip({
  count,
  appearance = "link",
  children,
  className,
  ...props
}: CountChipProps): JSX.Element {
  return (
    <ActionChip
      {...props}
      className={[styles.countChip, appearance === "choice" && styles.countSelected, className]
        .filter(Boolean)
        .join(" ")}
    >
      {children} <span className={styles.countLabel}>{count}</span>
      {appearance === "link" && <Icon name="chev" size={12} />}
    </ActionChip>
  );
}
