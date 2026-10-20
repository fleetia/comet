import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type JSX,
  type ReactNode,
} from "react";
import { Icon, type IconName } from "@comet/icon";
import { themes, tokens } from "@comet/token";
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
      data-orbit-breadcrumb
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
  open?: boolean;
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
  onExitComplete?: () => void;
  character?: ReactNode;
  characterAnchor?: { x: number; y: number };
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

export type OrbitBranchProps = Omit<HTMLAttributes<HTMLDivElement>, "content"> & {
  origin: { x: number; y: number };
  center: { x: number; y: number };
  title: string;
  items: OrbitMenuItems;
  open?: boolean;
  hubIcon?: IconName;
  selectedId?: string;
  onAction?: (id: string) => void;
  onBack?: () => void;
  onExitComplete?: () => void;
};

function milliseconds(value: string, fallback: number): number {
  const amount = Number.parseFloat(value);
  return Number.isFinite(amount) ? (value.endsWith("ms") ? amount : amount * 1000) : fallback;
}

function useOrbitPresence(
  open: boolean,
  itemCount: number,
  secondaryCount: number,
  onExitComplete?: () => void,
) {
  const [present, setPresent] = useState(open);
  const [exitReady, setExitReady] = useState(false);
  const visualRef = useRef<HTMLDivElement>(null);
  const callbackRef = useRef(onExitComplete);
  callbackRef.current = onExitComplete;
  useLayoutEffect(() => {
    const nodes = visualRef.current?.querySelectorAll<HTMLElement>(
      "[data-orbit-primary], [data-orbit-secondary], [data-orbit-hub]",
    );
    if (open) {
      setPresent(true);
      setExitReady(false);
      nodes?.forEach((node) => {
        node.style.removeProperty("--comet-orbit-exit-opacity");
        node.style.removeProperty("--comet-orbit-exit-transform");
      });
    } else if (present) {
      nodes?.forEach((node) => {
        const current = getComputedStyle(node);
        node.style.setProperty("--comet-orbit-exit-opacity", current.opacity || "1");
        node.style.setProperty("--comet-orbit-exit-transform", current.transform || "scale(1)");
      });
      setExitReady(true);
    }
  }, [open, present]);
  useEffect(() => {
    const visual = visualRef.current;
    if (open || !present || !exitReady || !visual) return;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      setPresent(false);
      callbackRef.current?.();
    };
    const media = window.matchMedia?.(styles.reducedMotionQuery);
    const hub = visual.querySelector<HTMLElement>("[data-orbit-hub]");
    const computed = getComputedStyle(visual);
    const fast = milliseconds(
      computed.getPropertyValue("--comet-duration-duration-fast"),
      themes.dark["duration/duration-fast"] * 1000,
    );
    const stagger =
      milliseconds(
        computed.getPropertyValue("--comet-duration-duration-stagger"),
        themes.dark["duration/duration-stagger"] * 1000,
      ) * 0.25;
    const nodeTime = fast * 0.65;
    const secondaryTime =
      secondaryCount > 0 ? nodeTime + Math.max(0, secondaryCount - 1) * stagger : 0;
    const duration = secondaryTime + nodeTime + Math.max(0, itemCount - 1) * stagger + fast * 0.75;
    const reduced = media?.matches || visual.closest('[data-comet-motion="reduced"]');
    const timeout = window.setTimeout(finish, reduced ? 0 : duration + 20);
    const onAnimationEnd = (event: AnimationEvent) => {
      if (event.target === hub && event.animationName === styles.fold) finish();
    };
    const onMotionChange = (event: MediaQueryListEvent) => {
      if (event.matches) finish();
    };
    visual.addEventListener("animationend", onAnimationEnd);
    media?.addEventListener("change", onMotionChange);
    const observer = new MutationObserver(() => {
      if (visual.closest('[data-comet-motion="reduced"]')) finish();
    });
    let ancestor: Element | null = visual;
    while (ancestor) {
      observer.observe(ancestor, { attributes: true, attributeFilter: ["data-comet-motion"] });
      ancestor = ancestor.parentElement;
    }
    return () => {
      window.clearTimeout(timeout);
      visual.removeEventListener("animationend", onAnimationEnd);
      media?.removeEventListener("change", onMotionChange);
      observer.disconnect();
    };
  }, [open, present, exitReady, itemCount, secondaryCount]);
  return { present, visualRef, exiting: present && !open && exitReady };
}

export function OrbitExpandedMenu(props: OrbitExpandedMenuProps): JSX.Element {
  return <OrbitMenu {...props} />;
}

export function OrbitBranch({ origin, center, style, ...props }: OrbitBranchProps): JSX.Element {
  const offset = { x: center.x - 156, y: center.y - 144 };
  return (
    <OrbitMenu
      {...props}
      parent=""
      size="compact"
      branch
      characterAnchor={{ x: origin.x - offset.x, y: origin.y - offset.y }}
      style={{ ...style, position: "absolute", left: offset.x, top: offset.y }}
    />
  );
}

function OrbitMenu({
  open = true,
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
  onExitComplete,
  character,
  characterAnchor,
  footer,
  className,
  onKeyDown,
  branch = false,
  ...props
}: OrbitExpandedMenuProps & { branch?: boolean }): JSX.Element {
  const isCompact = size === "compact" || content === "play";
  const isPlay = content === "play";
  const positions =
    branch && items.length === 2
      ? [
          [178, 75],
          [142, 198],
        ]
      : isPlay
        ? playPositions
        : isCompact
          ? compactPositions
          : fullPositions;
  const labels =
    branch && items.length === 2
      ? (["left", "right"] as const)
      : (["left", "left", "left", "top", "right", "right", "right"] as const);
  const { present, visualRef, exiting } = useOrbitPresence(
    open,
    items.length,
    secondaryItems.length,
    onExitComplete,
  );
  const nodeExitDuration = `calc(${tokens["duration/duration-fast"]} * 0.65)`;
  const exitStagger = `calc(${tokens["duration/duration-stagger"]} * 0.25)`;
  const secondaryExitTime = secondaryItems.length
    ? `calc(${nodeExitDuration} + ${exitStagger} * ${Math.max(0, secondaryItems.length - 1)})`
    : "0s";
  const primaryExitTime = `calc(${nodeExitDuration} + ${exitStagger} * ${Math.max(0, items.length - 1)})`;
  const hub = isPlay ? [140, 130, 40] : isCompact ? [137, 125, 38] : [194, 170, 52];
  const characterPosition = isPlay ? [136, 244] : isCompact ? [128, 228] : [190, 340];
  const secondaryPositions = isPlay
    ? playSecondaryPositions
    : isCompact
      ? compactSecondaryPositions
      : fullSecondaryPositions;
  const anchor =
    characterAnchor && Number.isFinite(characterAnchor.x) && Number.isFinite(characterAnchor.y)
      ? characterAnchor
      : undefined;
  const ring = isPlay
    ? { width: 310, height: 330, x: 160, y: 150, radius: 72, bodyRadius: 46, connectorY: 193 }
    : isCompact
      ? { width: 310, height: 340, x: 156, y: 144, radius: 68, bodyRadius: 44, connectorY: 186 }
      : { width: 440, height: 470, x: 220, y: 196, radius: 104, bodyRadius: 72, connectorY: 245 };
  const launch = anchor ?? {
    x: characterPosition[0] + (isCompact ? 24 : 30),
    y: characterPosition[1] + (isCompact ? 24 : 30),
  };
  return (
    <div
      {...props}
      role="group"
      aria-label={props["aria-label"] ?? (branch ? title : `${parent} ${title}`)}
      data-orbit-branch={branch || undefined}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (!event.defaultPrevented && !event.nativeEvent.isComposing && event.key === "Escape") {
          event.preventDefault();
          onBack?.();
        }
      }}
      className={[styles.menu, isCompact && styles.compact, isPlay && styles.play, className]
        .filter(Boolean)
        .join(" ")}
    >
      <div
        ref={visualRef}
        className={styles.visual}
        data-orbit-visual
        data-open={open}
        data-state={exiting ? "exiting" : present ? "entering" : "closed"}
        inert={!open}
        aria-hidden={!open || undefined}
      >
        {anchor ? (
          <svg
            className={`${styles.lines} ${styles.lineEntrance}`}
            style={
              exiting
                ? { animationDelay: `calc(${secondaryExitTime} + ${primaryExitTime})` }
                : undefined
            }
            width={ring.width}
            height={ring.height}
            viewBox={`0 0 ${ring.width} ${ring.height}`}
            overflow="visible"
            fill="none"
            aria-hidden="true"
            focusable="false"
            data-orbit-anchored-lines
          >
            <circle
              data-orbit-body-ring
              cx={anchor.x}
              cy={anchor.y}
              r={branch ? 14 : ring.bodyRadius}
              stroke={tokens["color/component/input-border-alpha-165"]}
              strokeWidth="1.2"
              strokeDasharray="2 6"
            />
            {!branch && (
              <circle
                cx={anchor.x}
                cy={anchor.y - ring.bodyRadius}
                r="7"
                stroke={tokens["color/connector"]}
                strokeWidth="1.2"
                strokeDasharray="2 3"
              />
            )}
            <path
              data-orbit-connector
              d={
                branch
                  ? `M${ring.x} ${ring.y}L${anchor.x} ${anchor.y}`
                  : `M${ring.x} ${ring.connectorY}L${anchor.x} ${anchor.y - ring.bodyRadius - 7}`
              }
              stroke={tokens["color/connector"]}
              strokeWidth="1.4"
              strokeDasharray="3 4"
            />
            <circle
              data-orbit-menu-ring
              cx={ring.x}
              cy={ring.y}
              r={ring.radius}
              stroke={tokens["color/orbit"]}
              strokeWidth="1.2"
              strokeDasharray="2 6"
            />
          </svg>
        ) : (
          <img
            src={isPlay ? playLines : isCompact ? compactLines : fullLines}
            alt=""
            className={`${styles.lines} ${styles.lineEntrance}`}
            style={
              exiting
                ? { animationDelay: `calc(${secondaryExitTime} + ${primaryExitTime})` }
                : undefined
            }
          />
        )}
        {items.map((item, index) => (
          <span
            key={item.id}
            className={`${styles.item} ${styles.nodeEntrance}`}
            data-orbit-primary={index}
            style={{
              left: positions[index][0],
              top: positions[index][1],
              transformOrigin: `${ring.x - positions[index][0]}px ${ring.y - positions[index][1]}px`,
              animationDelay: exiting
                ? `calc(${secondaryExitTime} + ${exitStagger} * ${items.length - 1 - index})`
                : `calc(${tokens["duration/duration-pop"]} + ${tokens["duration/duration-stagger"]} * ${index})`,
            }}
          >
            <OrbitNode
              icon={item.icon}
              label={item.label}
              badge={item.badge}
              disabled={item.disabled}
              state={selectedId === item.id ? "focus" : item.visited ? "visited" : "default"}
              aria-expanded={selectedId === item.id ? true : undefined}
              style={{ width: isCompact ? 28 : 40, height: isCompact ? 28 : 40 }}
              iconSize={isCompact ? 14 : 20}
              onClick={() => onAction?.(item.id)}
            />
            <span
              data-orbit-label
              className={[styles.itemLabel, styles.labelPositions[labels[index]]].join(" ")}
            >
              {item.label}
            </span>
          </span>
        ))}
        <span
          className={`${styles.item} ${styles.hubEntrance}`}
          data-orbit-hub
          style={{
            left: hub[0],
            top: hub[1],
            transformOrigin: `${launch.x - hub[0]}px ${launch.y - hub[1]}px`,
            animationDelay: exiting ? `calc(${secondaryExitTime} + ${primaryExitTime})` : undefined,
          }}
        >
          <OrbitNode
            icon={hubIcon}
            label={branch ? `${title} 접기` : title}
            state="hub"
            style={{ width: hub[2], height: hub[2] }}
            onClick={onBack}
          />
          <span data-orbit-label className={styles.hubLabel}>
            {title}
          </span>
        </span>
        {secondaryItems.map((item, index) => {
          const side = isPlay ? 18 : isCompact ? 16 : 24;
          return (
            <span
              key={item.id}
              className={`${styles.item} ${styles.nodeEntrance}`}
              data-orbit-secondary={index}
              style={{
                left: secondaryPositions[index][0],
                top: secondaryPositions[index][1],
                transformOrigin: `${ring.x - secondaryPositions[index][0]}px ${ring.y - secondaryPositions[index][1]}px`,
                animationDelay: exiting
                  ? `calc(${exitStagger} * ${secondaryItems.length - 1 - index})`
                  : `calc(${tokens["duration/duration-pop"]} + ${tokens["duration/duration-base"]} + ${tokens["duration/duration-stagger"]} * ${items.length + index})`,
              }}
            >
              <OrbitNode
                label={item.label}
                icon={item.icon}
                state="retreated"
                iconSize={isCompact ? 9 : 12}
                disabled={item.disabled}
                style={{
                  width: side,
                  height: side,
                }}
                onClick={() => onAction?.(item.id)}
              />
            </span>
          );
        })}
        {footer && <span className={styles.footer}>{footer}</span>}
      </div>
      {!branch && (
        <span
          className={styles.character}
          style={{
            left: characterPosition[0],
            top: characterPosition[1],
            visibility: open ? undefined : "hidden",
          }}
          inert={!open}
          aria-hidden={!open || undefined}
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
      )}
    </div>
  );
}
