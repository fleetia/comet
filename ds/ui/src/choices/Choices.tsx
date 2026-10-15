import type { ButtonHTMLAttributes, CSSProperties, JSX, ReactNode } from "react";
import * as styles from "./choices.css";

export type ChoiceTileProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  kind?:
    | "character"
    | "element"
    | "widget"
    | "animation-frame"
    | "expression"
    | "expression-text"
    | "body-part"
    | "theme"
    | "desktop-layout"
    | "cup"
    | "widget-preview"
    | "anchor";
  label: ReactNode;
  graphic: ReactNode;
  description?: ReactNode;
  badge?: ReactNode;
  selected?: boolean;
  hideLabel?: boolean;
};
export function ChoiceTile({
  kind = "character",
  label,
  graphic,
  description,
  badge,
  selected = false,
  hideLabel = false,
  className,
  type = "button",
  ...props
}: ChoiceTileProps): JSX.Element {
  const hasFooter = kind === "theme" || kind === "desktop-layout";
  const text = (
    <>
      <span className={hideLabel ? styles.hidden : styles.label}>{label}</span>
      {description != null && <span className={styles.description}>{description}</span>}
    </>
  );
  return (
    <button
      {...props}
      type={type}
      aria-pressed={selected}
      className={[styles.choice, styles.kinds[kind], className].filter(Boolean).join(" ")}
    >
      {!hasFooter && badge != null && <span className={styles.badge}>{badge}</span>}
      <span
        aria-hidden
        className={[styles.graphic, kind === "theme" && styles.themeGraphic]
          .filter(Boolean)
          .join(" ")}
      >
        {graphic}
      </span>
      {hasFooter ? (
        <span className={styles.footer}>
          <span className={styles.footerText}>{text}</span>
          {badge != null && <span className={styles.footerBadge}>{badge}</span>}
        </span>
      ) : (
        text
      )}
    </button>
  );
}
export type ColorSwatchProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "color"
> & {
  label: string;
  color: CSSProperties["backgroundColor"];
  size?: 20 | 22 | 26;
  edge?: "flat" | "inset";
  selected?: boolean;
};
export function ColorSwatch({
  label,
  color,
  size = 26,
  edge = "flat",
  selected = false,
  className,
  style,
  type = "button",
  ...props
}: ColorSwatchProps): JSX.Element {
  return (
    <button
      {...props}
      type={type}
      aria-label={label}
      aria-pressed={selected}
      className={[styles.swatch, edge === "inset" && styles.inset, className]
        .filter(Boolean)
        .join(" ")}
      style={{ backgroundColor: color, width: size, height: size, ...style }}
    />
  );
}
export type ChoiceButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: "compact" | "hug" | "fill" | "list" | "weekday" | "weekday-compact" | "period";
  selected?: boolean;
};
export function ChoiceButton({
  kind = "hug",
  selected = false,
  className,
  type = "button",
  ...props
}: ChoiceButtonProps): JSX.Element {
  return (
    <button
      {...props}
      type={type}
      aria-pressed={selected}
      className={[styles.segment, styles.segmentKinds[kind], className].filter(Boolean).join(" ")}
    />
  );
}
