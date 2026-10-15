import {
  forwardRef,
  type AnchorHTMLAttributes,
  type FormHTMLAttributes,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { Icon } from "@comet/icon";
import { IconButton } from "../controls/Button";
import * as styles from "./records.css";

export type RecordSourceLinkProps = AnchorHTMLAttributes<HTMLAnchorElement>;
export const RecordSourceLink = forwardRef<HTMLAnchorElement, RecordSourceLinkProps>(
  ({ className, children, ...props }, ref) => (
    <a {...props} ref={ref} className={[styles.sourceLink, className].filter(Boolean).join(" ")}>
      {children}
    </a>
  ),
);
RecordSourceLink.displayName = "RecordSourceLink";

export type RecordPageEntryProps = Omit<HTMLAttributes<HTMLElement>, "title" | "children"> & {
  date: ReactNode;
  title: ReactNode;
  review?: ReactNode;
  source?: ReactNode;
  rating?: number;
  ratingLabel?: string;
  onMenu?: () => void;
  menuLabel?: string;
};

export function RecordPageEntry({
  date,
  title,
  review,
  source,
  rating,
  ratingLabel,
  onMenu,
  menuLabel = "기록 메뉴",
  className,
  ...props
}: RecordPageEntryProps): ReactElement {
  const stars = rating === undefined ? undefined : Math.max(0, Math.min(5, Math.floor(rating)));
  return (
    <article
      {...props}
      className={[
        styles.recordEntry,
        source && styles.recordEntryLinked,
        review && styles.recordEntryReview,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className={styles.date}>{date}</span>
      <div className={`${styles.column} ${styles.grow}`}>
        <span className={styles.wrap}>
          <span>{title}</span>
          {stars !== undefined && (
            <span
              className={styles.rating}
              role="img"
              aria-label={ratingLabel ?? `별점 ${stars}/5`}
            >
              {Array.from({ length: 5 }, (_, index) => (
                <Icon
                  key={index}
                  name="star"
                  size={12}
                  fill={index < stars ? "currentColor" : "none"}
                />
              ))}
            </span>
          )}
        </span>
        {review && <span className={styles.body}>{review}</span>}
        {source}
      </div>
      {onMenu && (
        <IconButton
          icon="more"
          aria-label={menuLabel}
          onClick={onMenu}
          className={styles.entryMenuButton}
        />
      )}
    </article>
  );
}

export type RecordTimelineRowProps = HTMLAttributes<HTMLElement> & {
  timestamp: ReactNode;
  children: ReactNode;
  kind?: "memo" | "task" | "moved-task" | "overdue" | "event" | "linked-memo";
  detail?: ReactNode;
  source?: ReactNode;
  onMenu?: () => void;
  menuLabel?: string;
};

export function RecordTimelineRow({
  timestamp,
  children,
  kind = "memo",
  detail,
  source,
  onMenu,
  menuLabel = "기록 메뉴",
  className,
  ...props
}: RecordTimelineRowProps): ReactElement {
  let mark = "—";
  switch (kind) {
    case "task":
    case "overdue":
      mark = "•";
      break;
    case "moved-task":
      mark = "→";
      break;
    case "event":
      mark = "○";
      break;
    default:
      break;
  }
  return (
    <article
      {...props}
      className={[
        styles.timeline,
        kind === "memo" && styles.timelineMemo,
        kind === "overdue" && styles.timelineSelected,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className={styles.timelineTime}>{timestamp}</span>
      <span
        className={[
          styles.timelineMark,
          kind === "event" && styles.timelineEventMark,
          kind === "moved-task" && styles.muted,
        ]
          .filter(Boolean)
          .join(" ")}
        aria-hidden
      >
        {mark}
      </span>
      <div className={`${styles.column} ${styles.grow}`}>
        <span className={kind === "task" ? styles.taskDone : undefined}>{children}</span>
        {detail && (
          <span
            className={
              kind === "overdue" ? `${styles.tag} ${styles.tagVariants.conflict}` : styles.meta
            }
          >
            {detail}
          </span>
        )}
        {source}
      </div>
      {onMenu && (
        <IconButton
          icon="more"
          aria-label={menuLabel}
          onClick={onMenu}
          className={styles.timelineMenuButton}
        />
      )}
    </article>
  );
}

export type RecordQuickAddProps = Omit<
  FormHTMLAttributes<HTMLFormElement>,
  "onSubmit" | "onChange" | "children"
> & {
  value: string;
  kind: string;
  kinds: readonly { value: string; label: string }[];
  onValueChange: (value: string) => void;
  onKindChange: (kind: string) => void;
  onAdd: (value: string, kind: string) => void;
  label?: string;
  kindLabel?: string;
  placeholder?: string;
  disabled?: boolean;
};

export const RecordQuickAdd = forwardRef<HTMLFormElement, RecordQuickAddProps>(
  (
    {
      value,
      kind,
      kinds,
      onValueChange,
      onKindChange,
      onAdd,
      label = "기록 내용",
      kindLabel = "기록 종류",
      placeholder = "지금 떠오른 생각을 적어 보세요",
      disabled = false,
      className,
      ...props
    },
    ref,
  ) => (
    <form
      {...props}
      ref={ref}
      className={[styles.quickAdd, className].filter(Boolean).join(" ")}
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && value.trim()) {
          onAdd(value, kind);
        }
      }}
    >
      <span className={styles.quickKindWrap}>
        <select
          className={styles.quickKind}
          aria-label={kindLabel}
          value={kind}
          disabled={disabled}
          onChange={(event) => onKindChange(event.currentTarget.value)}
        >
          {kinds.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <Icon name="chevdown" size={13} className={styles.kindChevron} />
      </span>
      <input
        className={styles.bareInput}
        aria-label={label}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onValueChange(event.currentTarget.value)}
      />
      <button type="submit" hidden disabled={disabled}>
        추가
      </button>
    </form>
  ),
);
RecordQuickAdd.displayName = "RecordQuickAdd";

export type ChecklistAddProps = Omit<
  FormHTMLAttributes<HTMLFormElement>,
  "onSubmit" | "onChange" | "children"
> & {
  value: string;
  onValueChange: (value: string) => void;
  onAdd: (value: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
};
export const ChecklistAdd = forwardRef<HTMLFormElement, ChecklistAddProps>(
  (
    {
      value,
      onValueChange,
      onAdd,
      label = "준비할 일 추가",
      placeholder = "준비할 일 추가 · 기존 할 일은 끌어다 놓아요",
      disabled = false,
      className,
      ...props
    },
    ref,
  ) => (
    <form
      {...props}
      ref={ref}
      className={[styles.checklistAdd, className].filter(Boolean).join(" ")}
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && value.trim()) {
          onAdd(value);
        }
      }}
    >
      <Icon name="plus" size={14} />
      <input
        className={styles.bareInput}
        value={value}
        aria-label={label}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onValueChange(event.currentTarget.value)}
      />
      <button hidden type="submit" disabled={disabled}>
        추가
      </button>
    </form>
  ),
);
ChecklistAdd.displayName = "ChecklistAdd";

export type EnvelopeHeaderProps = Omit<HTMLAttributes<HTMLElement>, "title" | "children"> & {
  title: ReactNode;
  description?: ReactNode;
  completed: number;
  total: number;
  progressLabel?: string;
  eventHref?: string;
  eventLabel?: string;
  onOpenEvent?: () => void;
  disabled?: boolean;
  onChangeDate?: () => void;
  changeDateLabel?: string;
  actions?: ReactNode;
};

export function EnvelopeHeader({
  title,
  description,
  completed,
  total,
  progressLabel = `${total}개 중 ${completed}개 준비됨`,
  eventHref,
  eventLabel = "일정 보기",
  onOpenEvent,
  disabled = false,
  onChangeDate,
  changeDateLabel = "날짜 바꾸기",
  actions,
  className,
  ...props
}: EnvelopeHeaderProps): ReactElement {
  return (
    <header {...props} className={[styles.header, className].filter(Boolean).join(" ")}>
      <span className={styles.envelopeIcon}>
        <Icon name="envelope" size={24} />
      </span>
      <div className={styles.headerContent}>
        <h2 className={styles.envelopeTitle}>{title}</h2>
        <div className={styles.wrap}>
          {description && (
            <>
              <span className={styles.eventDot} aria-hidden />
              <span className={styles.body}>{description}</span>
            </>
          )}
          {onOpenEvent ? (
            <button type="button" className={styles.textAction} disabled={disabled} onClick={onOpenEvent}>
              {eventLabel}
            </button>
          ) : eventHref && (
            <a href={eventHref} className={styles.textAction}>
              {eventLabel}
            </a>
          )}
          {onChangeDate && (
            <button type="button" className={styles.textAction} onClick={onChangeDate} disabled={disabled}>
              {changeDateLabel}
            </button>
          )}
        </div>
        <div className={styles.headerProgress}>
          <progress
            aria-label={progressLabel}
            className={styles.headerBar}
            value={Math.max(0, Math.min(completed, total))}
            max={Math.max(1, total)}
          >
            {completed}/{total}
          </progress>
          <span className={`${styles.caption} ${styles.muted}`}>{progressLabel}</span>
        </div>
      </div>
      {actions && <div className={styles.wrap}>{actions}</div>}
    </header>
  );
}
