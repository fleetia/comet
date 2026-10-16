import {
  forwardRef,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type AnchorHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "@comet/icon";
import * as styles from "./records.css";

export type NoteCardProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title" | "children"> & {
  title: ReactNode;
  timestamp?: ReactNode;
  description?: ReactNode;
  tag?: ReactNode;
  kind?: "desktop" | "envelope" | "focus";
  selected?: boolean;
  layout?: "card" | "preview" | "plain";
};

const noteIcons: Record<NonNullable<NoteCardProps["kind"]>, IconName> = {
  desktop: "monitor",
  envelope: "envelope",
  focus: "timer",
};

export const NoteCard = forwardRef<HTMLButtonElement, NoteCardProps>(
  (
    {
      title,
      timestamp,
      description,
      tag,
      kind = "desktop",
      selected = false,
      layout = "card",
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
        styles.card,
        styles.note,
        layout === "preview" && styles.notePreview.tagged,
        layout === "plain" && styles.notePreview.plain,
        layout !== "plain" && !selected && styles.transparent,
        selected && styles.selected,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className={styles.heading}>
        <span className={`${styles.title} ${styles.grow}`}>{title}</span>
        {timestamp && <span className={`${styles.meta} ${styles.noWrap}`}>{timestamp}</span>}
      </span>
      {description && <span className={styles.body}>{description}</span>}
      {tag && layout !== "plain" && (
        <span className={`${styles.tag} ${styles.tagVariants[kind]}`}>
          <Icon name={noteIcons[kind]} size={12} />
          {tag}
        </span>
      )}
    </button>
  ),
);
NoteCard.displayName = "NoteCard";

export type EnvelopeCardProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "title" | "children"
> & {
  title: ReactNode;
  description?: ReactNode;
  completed: number;
  total: number;
  selected?: boolean;
  archived?: boolean;
  layout?: "card" | "preview";
  progressLabel?: string;
};

export const EnvelopeCard = forwardRef<HTMLButtonElement, EnvelopeCardProps>(
  (
    {
      title,
      description,
      completed,
      total,
      selected = false,
      archived = false,
      layout = "card",
      progressLabel = "준비 진행률",
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
        styles.card,
        styles.envelope,
        layout === "preview" && styles.envelopePreview,
        selected && styles.selected,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className={styles.row}>
        {layout !== "preview" && <Icon name="envelope" size={15} />}
        <span
          className={[styles.title, styles.grow, archived && styles.archived]
            .filter(Boolean)
            .join(" ")}
        >
          {title}
        </span>
      </span>
      {description && <span className={styles.caption}>{description}</span>}
      <span className={styles.envelopeProgress}>
        <progress
          className={[styles.progress, archived && styles.archivedProgress]
            .filter(Boolean)
            .join(" ")}
          value={archived ? 1 : Math.max(0, Math.min(completed, total))}
          max={archived ? 1 : Math.max(1, total)}
          aria-label={archived ? "보관한 봉투" : progressLabel}
        >
          {completed}/{total}
        </progress>
        <span className={styles.envelopePercent}>
          {archived ? (
            <Icon name="check" size={16} />
          ) : (
            `${total > 0 ? Math.round(Math.max(0, Math.min(1, completed / total)) * 100) : 0}%`
          )}
        </span>
      </span>
    </button>
  ),
);
EnvelopeCard.displayName = "EnvelopeCard";

export type OrganizationCardProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "title" | "children"
> & {
  title: ReactNode;
  timestamp?: ReactNode;
  description?: ReactNode;
  status?: "saved" | "reverted" | "conflict" | "confirmation";
  statusLabel: ReactNode;
  selected?: boolean;
  layout?: "record" | "activity";
};

export const OrganizationCard = forwardRef<HTMLButtonElement, OrganizationCardProps>(
  (
    {
      title,
      timestamp,
      description,
      status = "saved",
      statusLabel,
      selected = false,
      layout = "record",
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
        styles.card,
        layout === "activity" ? styles.activity : styles.organization,
        selected && styles.selected,
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <span className={styles.row}>
        <span className={`${styles.meta} ${styles.grow}`}>{timestamp}</span>
        <span className={`${styles.tag} ${styles.tagVariants[status]}`}>{statusLabel}</span>
      </span>
      <span className={styles.title}>{title}</span>
      {description && <span className={styles.caption}>{description}</span>}
    </button>
  ),
);
OrganizationCard.displayName = "OrganizationCard";

export type CharacterArtworkProps = Omit<HTMLAttributes<HTMLSpanElement>, "children"> & {
  face?: string;
  size?: "large" | "compact" | "conversation";
};

export function CharacterArtwork({
  face = "(^‿^)",
  size = "large",
  className,
  ...props
}: CharacterArtworkProps): ReactElement {
  const faceElement = (
    <span
      {...props}
      className={[styles.characterFace, styles.characterSizes[size], size !== "large" && className]
        .filter(Boolean)
        .join(" ")}
    >
      {face}
    </span>
  );
  if (size !== "large") {
    return faceElement;
  }
  return (
    <span className={[styles.characterHalo, className].filter(Boolean).join(" ")}>
      {faceElement}
    </span>
  );
}

export type CharacterCardProps = Omit<HTMLAttributes<HTMLElement>, "title" | "children"> & {
  title: ReactNode;
  description?: ReactNode;
  artwork: ReactNode;
};

export function CharacterCard({
  title,
  description,
  artwork,
  className,
  ...props
}: CharacterCardProps): ReactElement {
  return (
    <article {...props} className={[styles.character, className].filter(Boolean).join(" ")}>
      {artwork}
      <div className={styles.column}>
        <span className={styles.characterTitle}>{title}</span>
        {description && <span className={styles.body}>{description}</span>}
      </div>
    </article>
  );
}

export type AddCardProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "title" | "children"> & {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  variant?: "character" | "customize";
};

export const AddCard = forwardRef<HTMLButtonElement, AddCardProps>(
  (
    {
      title,
      description,
      icon = <Icon name="plus" size={22} />,
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
      className={[styles.addCard, variant === "customize" && styles.customizeCard, className]
        .filter(Boolean)
        .join(" ")}
    >
      <span
        className={[styles.addIcon, variant === "customize" && styles.customizeIcon]
          .filter(Boolean)
          .join(" ")}
      >
        {icon}
      </span>
      <span
        className={[styles.addCopy, variant === "customize" && styles.customizeCopy]
          .filter(Boolean)
          .join(" ")}
      >
        <span className={variant === "customize" ? styles.customizeTitle : styles.addTitle}>
          {title}
        </span>
        {description && (
          <span
            className={variant === "customize" ? `${styles.caption} ${styles.muted}` : styles.body}
          >
            {description}
          </span>
        )}
      </span>
    </button>
  ),
);
AddCard.displayName = "AddCard";

export type SettingsLinkCardProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "title" | "children"
> & { title: ReactNode; description?: ReactNode; detail?: ReactNode; icon: ReactNode };

export const SettingsLinkCard = forwardRef<HTMLAnchorElement, SettingsLinkCardProps>(
  ({ title, description, detail, icon, className, ...props }, ref) => (
    <a {...props} ref={ref} className={[styles.settingsLink, className].filter(Boolean).join(" ")}>
      <span className={styles.iconTile}>{icon}</span>
      <span className={`${styles.column} ${styles.grow}`}>
        <span className={styles.summaryTitle}>{title}</span>
        {description && <span className={styles.body}>{description}</span>}
        {detail && <span className={`${styles.caption} ${styles.muted}`}>{detail}</span>}
      </span>
      <Icon name="chev" size={16} />
    </a>
  ),
);
SettingsLinkCard.displayName = "SettingsLinkCard";

export type AnimationCardProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "title" | "children"
> & { title: ReactNode; description?: ReactNode; artwork: ReactNode };

export const AnimationCard = forwardRef<HTMLButtonElement, AnimationCardProps>(
  ({ title, description, artwork, className, type = "button", ...props }, ref) => (
    <button
      {...props}
      ref={ref}
      type={type}
      className={[styles.animationCard, className].filter(Boolean).join(" ")}
    >
      <span className={styles.animationTile}>{artwork}</span>
      <span className={styles.column}>
        <span className={styles.animationTitle}>{title}</span>
        {description && <span className={styles.animationDescription}>{description}</span>}
      </span>
    </button>
  ),
);
AnimationCard.displayName = "AnimationCard";
