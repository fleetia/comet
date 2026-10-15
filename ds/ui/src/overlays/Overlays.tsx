import { Fragment, type HTMLAttributes, type JSX } from "react";
import { Button } from "../controls";
import { MenuItem } from "../surface/Surface";
import type { IconName } from "@comet/icon";
import comet from "./assets/comet.svg";
import cometOs from "./assets/comet-os.svg";
import { tail, tails } from "../conversation/conversation.css";
import * as styles from "./overlays.css";

export type ContextMenuAction = {
  id: string;
  label: string;
  icon?: IconName;
  destructive?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
};
export type ContextMenuProps = HTMLAttributes<HTMLDivElement> & {
  actions: readonly ContextMenuAction[];
  onAction?: (id: string) => void;
  onDismiss?: () => void;
  label?: string;
};
export function ContextMenu({
  actions,
  onAction,
  onDismiss,
  label = "빠른 작업",
  className,
  onKeyDown,
  ...props
}: ContextMenuProps): JSX.Element {
  return (
    <div
      {...props}
      role="menu"
      aria-label={label}
      className={[styles.contextMenu, className].filter(Boolean).join(" ")}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) {
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          onDismiss?.();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
          return;
        }
        event.preventDefault();
        const buttons = [
          ...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
        ];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        let next = event.key === "ArrowUp" ? index - 1 : index + 1;
        if (event.key === "Home") {
          next = 0;
        }
        if (event.key === "End") {
          next = buttons.length - 1;
        }
        buttons[(next + buttons.length) % buttons.length]?.focus();
      }}
    >
      {actions.map((action) => (
        <Fragment key={action.id}>
          {action.separatorBefore && <div role="separator" className={styles.separator} />}
          <MenuItem
            role="menuitem"
            icon={action.icon}
            destructive={action.destructive}
            disabled={action.disabled}
            onClick={() => onAction?.(action.id)}
          >
            {action.label}
          </MenuItem>
        </Fragment>
      ))}
    </div>
  );
}

export type NotificationAction = {
  id: string;
  label: string;
  primary?: boolean;
  disabled?: boolean;
};
export type CometNotificationProps = HTMLAttributes<HTMLDivElement> & {
  title: string;
  description: string;
  actions?: readonly NotificationAction[];
  onAction?: (id: string) => void;
  status?: "save-failed" | "stopped" | "capacity-reached" | "saved";
  hasTail?: boolean;
};
export function CometNotification({
  title,
  description,
  actions = [],
  onAction,
  status = "saved",
  hasTail = true,
  className,
  ...props
}: CometNotificationProps): JSX.Element {
  return (
    <div
      {...props}
      role={status === "save-failed" ? "alert" : "status"}
      className={[styles.notification, className].filter(Boolean).join(" ")}
    >
      <div className={styles.notificationHeader}>
        <img src={comet} alt="" />
        {title}
      </div>
      <div className={styles.notificationBody}>{description}</div>
      {actions.length > 0 && (
        <div className={styles.notificationActions}>
          {actions.map((action) => (
            <Button
              key={action.id}
              size="small"
              variant={action.primary ? "primary" : "ghost"}
              className={styles.notificationAction}
              disabled={action.disabled}
              onClick={() => onAction?.(action.id)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      )}
      {hasTail && <span aria-hidden className={[tail, tails.left].join(" ")} />}
    </div>
  );
}
export type OsNotificationProps = HTMLAttributes<HTMLDivElement> & {
  title: string;
  description: string;
  time?: string;
  actions?: readonly NotificationAction[];
  onAction?: (id: string) => void;
  kind?: "event" | "task" | "quiet-hours";
};
export function OsNotification({
  title,
  description,
  time = "지금",
  actions = [],
  onAction,
  kind = "event",
  className,
  ...props
}: OsNotificationProps): JSX.Element {
  return (
    <div
      {...props}
      role="status"
      data-kind={kind}
      className={[styles.os, className].filter(Boolean).join(" ")}
    >
      <div className={styles.osMain}>
        <span className={styles.osIcon}>
          <img src={cometOs} alt="" />
        </span>
        <span className={styles.osCopy}>
          <strong className={styles.osTitle}>{title}</strong>
          <span className={styles.osDescription}>{description}</span>
        </span>
        <time className={styles.osMeta}>{time}</time>
      </div>
      {actions.length > 0 && (
        <div className={styles.notificationActions}>
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={styles.osButton}
              disabled={action.disabled}
              onClick={() => onAction?.(action.id)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
