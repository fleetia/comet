import type { ButtonHTMLAttributes, HTMLAttributes, JSX, ReactNode } from "react";
import { Icon, type IconName } from "@comet/icon";
import fullLines from "./assets/orbit-full-lines.svg";
import compactLines from "./assets/orbit-compact-lines.svg";
import playLines from "./assets/orbit-play-lines.svg";
import * as styles from "./orbit.css";

export type OrbitNodeProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  icon: IconName;
  label: string;
  state?: "default" | "hub" | "focus" | "visited" | "retreated" | "has-children";
  badge?: number;
  iconSize?: number;
};
export function OrbitNode({
  icon,
  label,
  state = "default",
  badge,
  iconSize,
  className,
  type = "button",
  ...props
}: OrbitNodeProps): JSX.Element {
  return (
    <button
      {...props}
      type={type}
      aria-label={label}
      className={[styles.node, styles.states[state], className].filter(Boolean).join(" ")}
    >
      <Icon name={icon} size={iconSize ?? (state === "retreated" ? 12 : 20)} />
      {badge !== undefined && <span className={styles.badge}>{badge}</span>}
    </button>
  );
}
export type OrbitBreadcrumbProps = HTMLAttributes<HTMLElement> & {
  parent: ReactNode;
  current: ReactNode;
  hint?: string;
};
export function OrbitBreadcrumb({
  parent,
  current,
  hint = "Esc 안쪽으로",
  className,
  ...props
}: OrbitBreadcrumbProps): JSX.Element {
  return (
    <nav
      {...props}
      aria-label={props["aria-label"] ?? "궤도 위치"}
      className={[styles.breadcrumb, className].filter(Boolean).join(" ")}
    >
      {parent}
      <Icon name="chev" size={12} />
      <span aria-current="page" className={styles.current}>
        {current}
      </span>
      {hint && <span className={styles.hint}>{hint}</span>}
    </nav>
  );
}
export type OrbitMenuItem = {
  id: string;
  label: string;
  icon: IconName;
  badge?: number;
  disabled?: boolean;
  visited?: boolean;
};
export type OrbitMenuItems =
  | readonly []
  | readonly [OrbitMenuItem]
  | readonly [OrbitMenuItem, OrbitMenuItem]
  | readonly [OrbitMenuItem, OrbitMenuItem, OrbitMenuItem]
  | readonly [OrbitMenuItem, OrbitMenuItem, OrbitMenuItem, OrbitMenuItem]
  | readonly [OrbitMenuItem, OrbitMenuItem, OrbitMenuItem, OrbitMenuItem, OrbitMenuItem]
  | readonly [
      OrbitMenuItem,
      OrbitMenuItem,
      OrbitMenuItem,
      OrbitMenuItem,
      OrbitMenuItem,
      OrbitMenuItem,
    ]
  | readonly [
      OrbitMenuItem,
      OrbitMenuItem,
      OrbitMenuItem,
      OrbitMenuItem,
      OrbitMenuItem,
      OrbitMenuItem,
      OrbitMenuItem,
    ];
export type OrbitExpandedMenuProps = HTMLAttributes<HTMLDivElement> & {
  size?: "full" | "compact";
  content?: "interact" | "play";
  parent: string;
  title: string;
  hubIcon?: IconName;
  items: OrbitMenuItems;
  secondaryItems?: OrbitMenuItems;
  selectedId?: string;
  onAction?: (id: string) => void;
  onBack?: () => void;
  character?: ReactNode;
  footer?: ReactNode;
};
const fullPositions = [
  [109.9, 228],
  [97.59, 157.9],
  [133.2, 96.3],
  [200, 72],
  [266.8, 96.3],
  [302.4, 157.9],
  [290.09, 228],
] as const;
const compactPositions = [
  [83.09, 164],
  [75, 118.19],
  [98.3, 77.9],
  [142, 62],
  [185.7, 77.9],
  [209, 118.19],
  [200.9, 164],
] as const;
const playPositions = [
  [83.59, 172],
  [75.09, 123.5],
  [99.7, 80.8],
  [146, 64],
  [192.3, 80.8],
  [216.9, 123.5],
  [208.4, 172],
] as const;
const fullSecondaryPositions = [
  [258.9, 309.09],
  [280, 360],
  [258.9, 410.9],
  [208, 432],
  [157.09, 410.9],
  [136, 360],
  [157.09, 309.09],
] as const;
const compactSecondaryPositions = [
  [179.09, 216.9],
  [192, 248],
  [179.09, 279.09],
  [148, 292],
  [116.9, 279.09],
  [104, 248],
  [116.9, 216.9],
] as const;
const playSecondaryPositions = [
  [197, 259],
  [183.5, 291.5],
  [151, 305],
  [118.5, 291.5],
  [105, 259],
  [118.5, 226.5],
  [183.5, 226.5],
] as const;

export function OrbitExpandedMenu({
  size = "full",
  content = "interact",
  parent,
  title,
  hubIcon = "heart",
  items,
  secondaryItems = [],
  selectedId,
  onAction,
  onBack,
  character,
  footer,
  className,
  onKeyDown,
  ...props
}: OrbitExpandedMenuProps): JSX.Element {
  const isCompact = size === "compact" || content === "play";
  const isPlay = content === "play";
  const positions = isPlay ? playPositions : isCompact ? compactPositions : fullPositions;
  const labels = ["left", "left", "left", "top", "right", "right", "right"] as const;
  const hub = isPlay ? [140, 130, 40] : isCompact ? [137, 125, 38] : [194, 170, 52];
  const characterPosition = isPlay ? [136, 244] : isCompact ? [128, 228] : [190, 340];
  const secondaryPositions = isPlay
    ? playSecondaryPositions
    : isCompact
      ? compactSecondaryPositions
      : fullSecondaryPositions;
  return (
    <div
      {...props}
      role="group"
      aria-label={props["aria-label"] ?? `${parent} ${title}`}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && event.key === "Escape") {
          event.preventDefault();
          onBack?.();
        }
      }}
      className={[styles.menu, isCompact && styles.compact, isPlay && styles.play, className]
        .filter(Boolean)
        .join(" ")}
    >
      <img
        src={isPlay ? playLines : isCompact ? compactLines : fullLines}
        alt=""
        className={styles.lines}
      />
      <OrbitBreadcrumb parent={parent} current={title} className={styles.crumbPosition} />
      {items.map((item, index) => (
        <span
          key={item.id}
          className={styles.item}
          style={{ left: positions[index][0], top: positions[index][1] }}
        >
          <OrbitNode
            icon={item.icon}
            label={item.label}
            badge={item.badge}
            disabled={item.disabled}
            state={selectedId === item.id ? "focus" : item.visited ? "visited" : "default"}
            style={{ width: isCompact ? 28 : 40, height: isCompact ? 28 : 40 }}
            iconSize={isCompact ? 14 : 20}
            onClick={() => onAction?.(item.id)}
          />
          <span className={[styles.itemLabel, styles.labelPositions[labels[index]]].join(" ")}>
            {item.label}
          </span>
        </span>
      ))}
      <span className={styles.item} style={{ left: hub[0], top: hub[1] }}>
        <OrbitNode
          icon={hubIcon}
          label={title}
          state="hub"
          style={{ width: hub[2], height: hub[2] }}
          onClick={onBack}
        />
        <span className={styles.hubLabel}>{title}</span>
      </span>
      {secondaryItems.map((item, index) => {
        const side = isPlay ? 18 : isCompact ? 16 : 24;
        return (
          <OrbitNode
            key={item.id}
            label={item.label}
            icon={item.icon}
            state="retreated"
            iconSize={isCompact ? 9 : 12}
            disabled={item.disabled}
            style={{
              position: "absolute",
              left: secondaryPositions[index][0],
              top: secondaryPositions[index][1],
              width: side,
              height: side,
            }}
            onClick={() => onAction?.(item.id)}
          />
        );
      })}
      <span
        className={styles.character}
        style={{ left: characterPosition[0], top: characterPosition[1] }}
      >
        {character ?? (
          <span
            aria-hidden
            className={styles.characterFallback}
            style={isCompact ? { width: 48, height: 48, borderRadius: 14 } : undefined}
          >
            {isPlay ? "(・o・)" : "(・_・)"}
          </span>
        )}
      </span>
      {footer && <span className={styles.footer}>{footer}</span>}
    </div>
  );
}
