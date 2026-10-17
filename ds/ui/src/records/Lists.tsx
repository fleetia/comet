import {
  forwardRef,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "@comet/icon";
import { Button } from "../controls/Button";
import { Checkbox } from "../controls/Checkbox";
import * as styles from "./records.css";

export type ListTone = keyof typeof styles.listColors;
export type TaskRowProps = Omit<
  HTMLAttributes<HTMLDivElement>,
  "title" | "children" | "onChange"
> & {
  title: ReactNode;
  completionLabel: string;
  completed: boolean;
  onCompletedChange?: (completed: boolean) => void;
  description?: ReactNode;
  due?: ReactNode;
  overdue?: boolean;
  selected?: boolean;
  disabled?: boolean;
  list?: ReactNode;
  tone?: ListTone;
  repeat?: ReactNode;
  envelope?: ReactNode;
  layout?: "task" | "diary" | "envelope";
  divider?: boolean;
};

export const TaskRow = forwardRef<HTMLDivElement, TaskRowProps>(
  (
    {
      title,
      completionLabel,
      completed,
      onCompletedChange,
      description,
      due,
      overdue = false,
      selected = false,
      disabled,
      list,
      tone = "blue",
      repeat,
      envelope,
      layout = "task",
      divider = true,
      className,
      ...props
    },
    ref,
  ) => (
    <div
      {...props}
      ref={ref}
      className={[
        styles.task,
        layout === "diary" && styles.taskDiary,
        layout === "envelope" && styles.taskEnvelope,
        !divider && styles.taskWithoutDivider,
        selected && styles.taskSelected,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Checkbox
        shape="round"
        aria-label={completionLabel}
        checked={completed}
        disabled={disabled}
        onChange={(event) => onCompletedChange?.(event.currentTarget.checked)}
      />
      <span className={`${styles.column} ${styles.grow}`}>
        <span className={styles.taskText}>
          <span
            className={[styles.taskTitle, completed && styles.taskDone].filter(Boolean).join(" ")}
          >
            {title}
          </span>
          {envelope && (
            <span className={`${styles.tag} ${styles.tagVariants.envelope}`}>
              <Icon name="envelope" size={12} />
              {envelope}
            </span>
          )}
        </span>
        {description && <span className={styles.meta}>{description}</span>}
      </span>
      {due && (
        <span
          className={[styles.taskDue, overdue && !completed && styles.danger]
            .filter(Boolean)
            .join(" ")}
        >
          {due}
        </span>
      )}
      {list && (
        <span className={styles.taskList}>
          <span className={`${styles.listDot} ${styles.listColors[tone]}`} aria-hidden />
          {list}
        </span>
      )}
      {(repeat || layout === "diary") && (
        <span className={styles.taskRepeat}>
          {repeat && <Icon name="repeat" size={13} />}
          {repeat}
        </span>
      )}
    </div>
  ),
);
TaskRow.displayName = "TaskRow";

export type SettingsRowProps = ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName };
export const SettingsRow = forwardRef<HTMLButtonElement, SettingsRowProps>(
  ({ icon, className, children, type = "button", ...props }, ref) => (
    <button
      {...props}
      type={type}
      ref={ref}
      className={[styles.settingsRow, className].filter(Boolean).join(" ")}
    >
      {icon && <Icon name={icon} size={16} />}
      <span className={styles.grow}>{children}</span>
      <Icon name="chev" size={14} />
    </button>
  ),
);
SettingsRow.displayName = "SettingsRow";

export type SettingControlRowProps = Omit<HTMLAttributes<HTMLDivElement>, "title" | "children"> & {
  title: ReactNode;
  description?: ReactNode;
  control: ReactNode;
};
export function SettingControlRow({
  title,
  description,
  control,
  className,
  ...props
}: SettingControlRowProps): ReactElement {
  return (
    <div {...props} className={[styles.controlRow, className].filter(Boolean).join(" ")}>
      <span className={`${styles.column} ${styles.grow}`}>
        <span className={styles.taskTitle}>{title}</span>
        {description && <span className={`${styles.caption} ${styles.muted}`}>{description}</span>}
      </span>
      <span className={styles.settingControl}>{control}</span>
    </div>
  );
}

export type ManageListRowProps = Omit<HTMLAttributes<HTMLDivElement>, "onChange" | "children"> & {
  value: string;
  onValueChange: (value: string) => void;
  inputLabel: string;
  color: string;
  colorLabel: string;
  onColorClick?: () => void;
  description?: ReactNode;
  dragHandle?: ReactNode;
  actionLabel: string;
  onAction: () => void;
  variant?: "existing" | "add";
  disabled?: boolean;
};
export function ManageListRow({
  value,
  onValueChange,
  inputLabel,
  color,
  colorLabel,
  onColorClick,
  description,
  dragHandle,
  actionLabel,
  onAction,
  variant = "existing",
  disabled,
  className,
  ...props
}: ManageListRowProps): ReactElement {
  return (
    <div {...props} className={[styles.manageRow, className].filter(Boolean).join(" ")}>
      {dragHandle}
      <button
        type="button"
        className={styles.colorAction}
        style={{ backgroundColor: color }}
        aria-label={colorLabel}
        onClick={onColorClick}
        disabled={disabled || !onColorClick}
      />
      <input
        className={styles.manageInput}
        style={variant === "add" ? { flex: 1 } : undefined}
        aria-label={inputLabel}
        value={value}
        onChange={(event) => onValueChange(event.currentTarget.value)}
        disabled={disabled}
      />
      {description && (
        <span className={`${styles.caption} ${styles.muted} ${styles.grow}`}>{description}</span>
      )}
      {variant === "add" ? (
        <Button variant="ghost" size="small" onClick={onAction} disabled={disabled}>
          {actionLabel}
        </Button>
      ) : (
        <button
          type="button"
          className={`${styles.textAction} ${styles.danger}`}
          onClick={onAction}
          disabled={disabled}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

export type ContentChoiceProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "title" | "children"
> & {
  title: ReactNode;
  description?: ReactNode;
  timestamp?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  selected?: boolean;
  variant?: keyof typeof styles.choiceLayouts;
};
export const ContentChoice = forwardRef<HTMLButtonElement, ContentChoiceProps>(
  (
    {
      title,
      description,
      timestamp,
      leading,
      trailing,
      selected = false,
      variant = "character",
      className,
      type = "button",
      ...props
    },
    ref,
  ) => (
    <button
      {...props}
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={[
        styles.contentChoice,
        styles.choiceLayouts[variant],
        selected && styles.choiceSelected,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {variant === "organizer-record" ? (
        <>
          <span className={styles.organizerHeading}>
            {timestamp && <span className={`${styles.meta} ${styles.noWrap}`}>{timestamp}</span>}
            {trailing}
          </span>
          <span className={styles.title}>{title}</span>
          {description && <span className={styles.caption}>{description}</span>}
        </>
      ) : (
        <>
          {leading}
          <span className={`${styles.column} ${styles.grow}`}>
            <span className={styles.heading}>
              <span className={`${styles.title} ${styles.grow}`}>{title}</span>
              {timestamp && <span className={`${styles.meta} ${styles.noWrap}`}>{timestamp}</span>}
            </span>
            {description && (
              <span className={variant === "conversation" ? styles.body : styles.meta}>
                {description}
              </span>
            )}
          </span>
          {variant === "memory" ? (
            <span
              aria-hidden
              className={[styles.radioMark, selected && styles.radioMarkSelected]
                .filter(Boolean)
                .join(" ")}
            />
          ) : (
            trailing
          )}
        </>
      )}
    </button>
  ),
);
ContentChoice.displayName = "ContentChoice";

export type ContentRowProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "title" | "children"
> & {
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  badge?: ReactNode;
  variant?: Exclude<keyof typeof styles.contentRowLayouts, "resource">;
};
export const ContentRow = forwardRef<HTMLButtonElement, ContentRowProps>(
  (
    {
      title,
      description,
      leading,
      trailing = <Icon name="chev" size={14} />,
      badge,
      variant = "memory",
      className,
      type = "button",
      ...props
    },
    ref,
  ) => (
    <button
      {...props}
      ref={ref}
      type={type}
      className={[styles.contentRow, styles.contentRowLayouts[variant], className]
        .filter(Boolean)
        .join(" ")}
    >
      {leading}
      <span className={`${styles.column} ${styles.grow}`}>
        <span className={variant === "memory" ? styles.meta : styles.title}>{title}</span>
        {description && (
          <span className={variant === "memory" ? undefined : styles.meta}>{description}</span>
        )}
      </span>
      {badge}
      {trailing}
    </button>
  ),
);
ContentRow.displayName = "ContentRow";

export type ResourceLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "title" | "children"
> & { title: ReactNode; description?: ReactNode; leading?: ReactNode };
export const ResourceLink = forwardRef<HTMLAnchorElement, ResourceLinkProps>(
  ({ title, description, leading, className, ...props }, ref) => (
    <a
      {...props}
      ref={ref}
      className={[styles.contentRow, styles.contentRowLayouts.resource, className]
        .filter(Boolean)
        .join(" ")}
    >
      {leading}
      <span className={styles.grow}>{title}</span>
      {description && <span className={`${styles.caption} ${styles.muted}`}>{description}</span>}
    </a>
  ),
);
ResourceLink.displayName = "ResourceLink";

export type SettingsSummaryProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "title" | "children"
> & {
  title: ReactNode;
  description?: ReactNode;
  count?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  trailingAction?: { label: ReactNode; icon?: IconName };
  badges?: readonly ReactNode[];
  variant?: keyof typeof styles.summaryLayouts;
  selected?: boolean;
};
export const SettingsSummary = forwardRef<HTMLButtonElement, SettingsSummaryProps>(
  (
    {
      title,
      description,
      count,
      leading,
      trailing = <Icon name="chev" size={16} />,
      trailingAction,
      badges,
      variant = "plain",
      selected,
      className,
      type = "button",
      ...props
    },
    ref,
  ) => (
    <button
      {...props}
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={[
        styles.summary,
        styles.summaryLayouts[variant],
        selected && styles.choiceSelected,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {leading}
      <span className={`${styles.column} ${styles.grow}`}>
        <span className={styles.heading}>
          <span className={styles.summaryTitle}>{title}</span>
          {count !== undefined && count !== null && variant === "avatarCount" && (
            <span className={styles.body}>{count}</span>
          )}
        </span>
        {description && <span className={styles.body}>{description}</span>}
        {badges && (
          <span className={styles.wrap}>
            {badges.map((badge, index) => (
              <span key={index} className={styles.tag}>
                {badge}
              </span>
            ))}
          </span>
        )}
      </span>
      {count !== undefined && count !== null && variant !== "avatarCount" && (
        <span className={`${styles.body} ${styles.noWrap}`}>{count}</span>
      )}
      {trailingAction ? (
        <span className={styles.summaryAction} aria-hidden="true">
          {trailingAction.icon && <Icon name={trailingAction.icon} size={15} />}
          {trailingAction.label}
        </span>
      ) : trailing}
    </button>
  ),
);
SettingsSummary.displayName = "SettingsSummary";

export type GestureAssignmentProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "title" | "children"
> & {
  title: ReactNode;
  area: ReactNode;
  expression: ReactNode;
  stages: ReactNode;
  selected?: boolean;
};
export const GestureAssignment = forwardRef<HTMLButtonElement, GestureAssignmentProps>(
  (
    { title, area, expression, stages, selected = false, className, type = "button", ...props },
    ref,
  ) => (
    <button
      {...props}
      ref={ref}
      type={type}
      aria-pressed={selected}
      className={[styles.gesture, selected && styles.choiceSelected, className]
        .filter(Boolean)
        .join(" ")}
    >
      <strong>{title}</strong>
      <span>{area}</span>
      <span>{expression}</span>
      <span className={styles.muted}>{stages}</span>
    </button>
  ),
);
GestureAssignment.displayName = "GestureAssignment";

export type SceneSummaryProps = HTMLAttributes<HTMLSpanElement> & { count?: ReactNode };
export function SceneSummary({
  count,
  children,
  className,
  ...props
}: SceneSummaryProps): ReactElement {
  return (
    <span {...props} className={[styles.sceneSummary, className].filter(Boolean).join(" ")}>
      {children}
      {count !== undefined && count !== null && (
        <span className={`${styles.caption} ${styles.muted}`}>{count}</span>
      )}
    </span>
  );
}

export type StatusLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { status: ReactNode };
export const StatusLink = forwardRef<HTMLAnchorElement, StatusLinkProps>(
  ({ status, children, className, ...props }, ref) => (
    <a {...props} ref={ref} className={[styles.statusLink, className].filter(Boolean).join(" ")}>
      <span className={`${styles.tag} ${styles.tagVariants.desktop}`}>{status}</span>
      {children}
    </a>
  ),
);
StatusLink.displayName = "StatusLink";

export type SidebarItemProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  icon: IconName;
  badge?: ReactNode;
  current?: boolean;
};
export const SidebarItem = forwardRef<HTMLAnchorElement, SidebarItemProps>(
  ({ icon, badge, current = false, children, className, ...props }, ref) => (
    <a
      {...props}
      ref={ref}
      aria-current={current ? "page" : undefined}
      className={[
        styles.sidebar,
        current && styles.selected,
        current && styles.sidebarSelected,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Icon name={icon} size={20} />
      <span>{children}</span>
      {badge !== undefined && badge !== null && (
        <span className={styles.sidebarBadge}> {badge}</span>
      )}
    </a>
  ),
);
SidebarItem.displayName = "SidebarItem";

export type ProfileLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { avatar: ReactNode };
export const ProfileLink = forwardRef<HTMLAnchorElement, ProfileLinkProps>(
  ({ avatar, children, className, ...props }, ref) => (
    <a {...props} ref={ref} className={[styles.profileLink, className].filter(Boolean).join(" ")}>
      <span className={styles.profileAvatar}>{avatar}</span>
      {children}
    </a>
  ),
);
ProfileLink.displayName = "ProfileLink";
