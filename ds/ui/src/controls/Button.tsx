import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Icon, type IconName } from "@comet/icon";

import * as styles from "./button.css";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "selected" | "link" | "danger";
  size?: "regular" | "small";
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      type = "button",
      variant = "primary",
      size = "regular",
      leadingIcon,
      trailingIcon,
      children,
      className,
      ...props
    },
    ref,
  ) => (
    <button
      {...props}
      ref={ref}
      type={type}
      className={[
        styles.button,
        styles.sizes[size],
        styles.variants[variant],
        size === "small" && styles.smallVariants[variant],
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {leadingIcon && (
        <span className={styles.icon} aria-hidden="true">
          {leadingIcon}
        </span>
      )}
      {children}
      {trailingIcon && (
        <span className={styles.icon} aria-hidden="true">
          {trailingIcon}
        </span>
      )}
    </button>
  ),
);

Button.displayName = "Button";

type AccessibleName =
  | { "aria-label": string; "aria-labelledby"?: string }
  | { "aria-label"?: string; "aria-labelledby": string };

export type IconButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "aria-label" | "aria-labelledby"
> &
  AccessibleName & {
    icon: IconName;
    variant?: "primary" | "ghost";
    size?: "compact" | "regular";
    selected?: boolean;
  };

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  (
    {
      type = "button",
      variant = "ghost",
      size = "compact",
      icon,
      selected = false,
      className,
      "aria-pressed": ariaPressed,
      ...props
    },
    ref,
  ) => (
    <button
      {...props}
      ref={ref}
      type={type}
      aria-pressed={ariaPressed ?? (selected ? true : undefined)}
      className={[
        styles.button,
        styles.iconButton,
        styles.iconSizes[size],
        styles.iconVariants[selected ? "primary" : variant],
        size === "compact" && variant === "ghost" && styles.compactGhost,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Icon name={icon} size={size === "compact" ? 16 : 26} />
    </button>
  ),
);

IconButton.displayName = "IconButton";
