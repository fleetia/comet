import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "@comet/icon";
import { Motion, type MotionProps } from "../motion/Motion";

import * as styles from "./styles.css";

export type SurfaceProps = Omit<MotionProps, "preset"> & {
  variant?: "window" | "sheet" | "popover" | "card";
};

export const Surface = forwardRef<HTMLDivElement, SurfaceProps>(
  ({ variant = "window", className, ...props }, ref) => (
    <Motion
      {...props}
      preset={variant === "card" ? "fade" : "slide"}
      ref={ref}
      className={[styles.surface, styles.variants[variant], className].filter(Boolean).join(" ")}
    />
  ),
);

Surface.displayName = "Surface";

export type MenuItemProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: IconName;
  destructive?: boolean;
};

export const MenuItem = forwardRef<HTMLButtonElement, MenuItemProps>(
  ({ type = "button", icon, destructive = false, className, children, ...props }, ref) => (
    <button
      {...props}
      ref={ref}
      type={type}
      className={[styles.menuItem, destructive && styles.destructive, className]
        .filter(Boolean)
        .join(" ")}
    >
      {icon && <Icon name={icon} size={16} />}
      {children}
    </button>
  ),
);

MenuItem.displayName = "MenuItem";
