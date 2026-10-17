import { useState, type ButtonHTMLAttributes, type HTMLAttributes, type JSX } from "react";
import { Icon, type IconName } from "@comet/icon";
import * as styles from "./display.css";

export type ActionChipProps = ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName };

export function ActionChip({
  icon,
  children,
  className,
  type = "button",
  ...props
}: ActionChipProps): JSX.Element {
  return (
    <button
      {...props}
      type={type}
      className={[styles.action, !icon && styles.textOnly, className].filter(Boolean).join(" ")}
    >
      {icon && <Icon name={icon} size={15} />}
      {children}
    </button>
  );
}

export type ToggleChipProps = Omit<ActionChipProps, "aria-pressed"> & {
  pressed?: boolean;
  defaultPressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
};

export function ToggleChip({
  pressed,
  defaultPressed = false,
  onPressedChange,
  onClick,
  className,
  ...props
}: ToggleChipProps): JSX.Element {
  const [localPressed, setLocalPressed] = useState(defaultPressed);
  const isPressed = pressed ?? localPressed;
  return (
    <ActionChip
      {...props}
      aria-pressed={isPressed}
      className={[styles.toggle, className].filter(Boolean).join(" ")}
      onClick={(event) => {
        onClick?.(event);
        if (event.defaultPrevented) return;
        if (pressed === undefined) setLocalPressed(!isPressed);
        onPressedChange?.(!isPressed);
      }}
    />
  );
}

const statuses = {
  saved: { label: "저장됨", icon: "check" },
  reverted: { label: "되돌림", icon: undefined },
  readOnly: { label: "읽기 전용", icon: "lock" },
  overdue: { label: "지남", icon: "warn" },
  selected: { label: "찾아온 친구", icon: undefined },
} as const;

export type StatusChipProps = HTMLAttributes<HTMLSpanElement> & { status?: keyof typeof statuses };

export function StatusChip({
  status = "saved",
  children,
  className,
  ...props
}: StatusChipProps): JSX.Element {
  const content = statuses[status];
  return (
    <span
      {...props}
      className={[
        styles.status,
        styles.statuses[status],
        status === "saved" && styles.confirmation,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {content.icon && <Icon name={content.icon} size={12} />}
      {children ?? content.label}
    </span>
  );
}

const categories = {
  work: "일",
  record: "기록",
  life: "생활",
  exercise: "운동",
  rest: "휴식",
  focus: "집중",
} as const;
export type CategoryChipProps = HTMLAttributes<HTMLSpanElement> & {
  category: keyof typeof categories;
};

export function CategoryChip({
  category,
  children,
  className,
  ...props
}: CategoryChipProps): JSX.Element {
  return (
    <span {...props} className={[styles.category, className].filter(Boolean).join(" ")}>
      <span aria-hidden className={[styles.categoryDot, styles.categories[category]].join(" ")} />
      {children ?? categories[category]}
    </span>
  );
}

export type ContextChipProps = HTMLAttributes<HTMLSpanElement> & { icon?: IconName };

export function ContextChip({
  icon,
  children,
  className,
  ...props
}: ContextChipProps): JSX.Element {
  return (
    <span {...props} className={[styles.context, className].filter(Boolean).join(" ")}>
      {icon && <Icon name={icon} size={13} />}
      {children}
    </span>
  );
}
