import type { ButtonHTMLAttributes, CSSProperties, HTMLAttributes, JSX, ReactNode } from "react";
import { Icon, type IconName } from "@comet/icon";
import { tokens } from "@comet/token";
import clockShape from "./assets/clock-freeform-imgCssClipShapePath.svg";
import clockOpaqueShape from "./assets/clock-freeform-opaque.svg";
import clockOutline from "./assets/clock-freeform-imgSvg031.svg";
import focusShape from "./assets/focus-freeform-imgCssClipShapePath.svg";
import focusOutline from "./assets/focus-freeform-imgSvg051.svg";
import musicShape from "./assets/music-freeform-imgCssClipShapePath.svg";
import musicOutline from "./assets/music-freeform-imgSvg041.svg";
import weatherShape from "./assets/weather-freeform-imgCssClipShapePath.svg";
import weatherOpaqueShape from "./assets/weather-freeform-opaque.svg";
import weatherOutline from "./assets/weather-freeform-imgSvg091.svg";
import envelopeShape from "./assets/envelope-freeform-imgCssClipShapePath.svg";
import envelopeOutline from "./assets/envelope-freeform-imgSvg071.svg";
import memoShape from "./assets/memo-freeform-imgCssClipShapePath.svg";
import memoOutline from "./assets/memo-freeform-imgSvg061.svg";
import counterEditorShape from "./assets/counter-imgCssClipShapePath.svg";
import counterEditorOutline from "./assets/counter-imgSvg0201.svg";
import counterShape from "./assets/counter-imgCssClipShapePath1.svg";
import counterOutline from "./assets/counter-imgSvg081.svg";
import * as styles from "./widgets.css";
import { ShapeBackground, type FreeformAppearanceProps } from "./WidgetShape";
import { FREEFORM_SKIN_OUTLINES } from "./skinOutlines";

export function CompactFreeform({
  icon,
  label,
  shape,
  backgroundImage,
  backgroundColor,
  textColor,
  imagePosition,
  contentStyle,
  fallbackPreset = "13",
  className,
  style,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> &
  FreeformAppearanceProps & { icon: IconName; label: string }): JSX.Element {
  const outline = shape ?? {
    source: "preset",
    preset: fallbackPreset,
    cloudCount: 4,
    roundness: 70,
    rotation: 0,
    flipX: false,
    flipY: false,
    fitContent: true,
    width: 100,
    height: 30,
    strokes: [],
  };
  return (
    <button
      {...props}
      className={[styles.compactFreeform, className].filter(Boolean).join(" ")}
      style={{ width: outline.width, height: outline.height, color: textColor, ...style }}
    >
      <ShapeBackground
        shape={outline.preset === "default" ? { ...outline, preset: fallbackPreset } : outline}
        image={outline.source === "image" ? backgroundImage : undefined}
        color={backgroundColor ?? tokens["color/glass-widget"]}
        position={imagePosition}
      />
      <span className={styles.compactFreeformCopy} style={contentStyle}>
        <Icon name={icon} size={14} />
        {label}
      </span>
    </button>
  );
}

const skins = {
  clock: {
    ...FREEFORM_SKIN_OUTLINES.clock,
    shape: clockShape,
    opaqueShape: clockOpaqueShape,
    outline: clockOutline,
    fill: tokens["palette/widget/밤 겉면"],
  },
  focus: {
    ...FREEFORM_SKIN_OUTLINES.focus,
    shape: focusShape,
    outline: focusOutline,
    fill: tokens["palette/widget/집중 겉면"],
  },
  music: {
    ...FREEFORM_SKIN_OUTLINES.music,
    shape: musicShape,
    outline: musicOutline,
    fill: tokens["palette/widget/밤 겉면"],
  },
  weather: {
    ...FREEFORM_SKIN_OUTLINES.weather,
    shape: weatherShape,
    opaqueShape: weatherOpaqueShape,
    outline: weatherOutline,
    fill: tokens["palette/widget/구름 겉면"],
  },
  envelope: {
    ...FREEFORM_SKIN_OUTLINES.envelope,
    shape: envelopeShape,
    outline: envelopeOutline,
    fill: tokens["palette/widget/봉투 겉면"],
  },
  memo: {
    ...FREEFORM_SKIN_OUTLINES.memo,
    shape: memoShape,
    outline: memoOutline,
    fill: tokens["palette/widget/메모 겉면"],
  },
  counter: {
    width: 140,
    height: 140,
    left: 6.24,
    top: 8.32,
    artWidth: 127.512,
    artHeight: 123.358,
    shape: counterShape,
    outline: counterOutline,
    fill: tokens["palette/widget/카운터 겉면"],
  },
  "counter-editor": {
    width: 156,
    height: 156,
    left: 6.75,
    top: 9.12,
    artWidth: 142.506,
    artHeight: 137.77,
    shape: counterEditorShape,
    outline: counterEditorOutline,
    fill: tokens["palette/widget/카운터 겉면"],
  },
} as const;

const percent = (value: number, total: number): string => `${(value / total) * 100}%`;

/** Places the fill artwork inside the widget box so it scales together with the outline. */
function artBox(design: (typeof skins)[keyof typeof skins]): CSSProperties {
  return {
    left: percent(design.left, design.width),
    top: percent(design.top, design.height),
    width: percent(design.artWidth, design.width),
    height: percent(design.artHeight, design.height),
  };
}

function FreeformSkin({
  skin,
  className,
  style,
  children,
  opaque = false,
  shape,
  backgroundImage,
  backgroundColor,
  textColor,
  contentStyle,
  imagePosition,
  fallbackPreset = "01",
  ...props
}: HTMLAttributes<HTMLDivElement> &
  FreeformAppearanceProps & { skin: keyof typeof skins; opaque?: boolean }): JSX.Element {
  const design = skins[skin];
  const custom =
    shape && (shape.preset !== "default" || shape.source !== "preset" || backgroundColor);
  const contentScale = shape?.fitContent
    ? Math.min(shape.width / design.width, shape.height / design.height) * (custom ? 0.72 : 1)
    : 1;
  return (
    <div
      {...props}
      className={[styles.freeform, className].filter(Boolean).join(" ")}
      style={{
        width: shape?.width ?? design.width,
        height: shape?.height ?? design.height,
        color: textColor,
        ...style,
      }}
    >
      {custom ? (
        <ShapeBackground
          shape={shape.preset === "default" ? { ...shape, preset: fallbackPreset } : shape}
          image={shape.source === "image" ? backgroundImage : undefined}
          color={backgroundColor ?? design.fill}
          position={imagePosition}
        />
      ) : (
        <div
          style={
            shape
              ? {
                  position: "absolute",
                  inset: 0,
                  transform: `rotate(${shape.rotation}deg) scale(${shape.flipX ? -1 : 1}, ${shape.flipY ? -1 : 1})`,
                }
              : { display: "contents" }
          }
        >
          <img
            src={opaque && "opaqueShape" in design ? design.opaqueShape : design.shape}
            alt=""
            className={styles.asset}
            style={artBox(design)}
          />
          <img
            src={design.outline}
            alt=""
            className={styles.asset}
            style={{ width: "100%", height: "100%" }}
          />
        </div>
      )}
      <div
        className={[
          textColor && styles.customFreeformCopy,
          contentStyle && styles.customFreeformPlacement,
        ]
          .filter(Boolean)
          .join(" ")}
        style={
          shape
            ? {
                position: "absolute",
                left: "50%",
                top: "50%",
                width: design.width,
                height: design.height,
                color: textColor,
                transform: `translate(-50%, -50%) scale(${contentScale})`,
                ...contentStyle,
              }
            : { display: "contents" }
        }
      >
        {children}
      </div>
    </div>
  );
}
export type ClockWidgetProps = HTMLAttributes<HTMLDivElement> &
  FreeformAppearanceProps & {
    time: string;
    period?: string;
    date: string;
    badge?: string;
    opaque?: boolean;
  };
export function ClockWidget({
  time,
  period,
  date,
  badge,
  ...props
}: ClockWidgetProps): JSX.Element {
  return (
    <FreeformSkin {...props} skin="clock">
      <div className={[styles.freeformContent, styles.darkArtworkCopy].join(" ")}>
        <span className={styles.artworkMuted}>{date}</span>
        <span
          className={[styles.clockTime, time.length > 5 && styles.clockTimeLong]
            .filter(Boolean)
            .join(" ")}
        >
          {time}
        </span>
        {period && <span className={styles.clockPeriod}>{period}</span>}
        {badge && <span className={styles.clockBadge}>{badge}</span>}
      </div>
    </FreeformSkin>
  );
}
export type FocusTimerFreeformProps = HTMLAttributes<HTMLDivElement> &
  FreeformAppearanceProps & {
    time: string;
    task: string;
    /** Status line above the time, such as the running phase. */
    label: string;
  };
export function FocusTimerFreeform({
  time,
  task,
  label,
  ...props
}: FocusTimerFreeformProps): JSX.Element {
  return (
    <FreeformSkin {...props} skin="focus">
      <div className={[styles.freeformContent, styles.darkArtworkCopy].join(" ")}>
        <strong className={styles.artworkAccent}>{label}</strong>
        <span className={styles.count}>{time}</span>
        <span className={[styles.small, styles.artworkMuted].join(" ")}>{task}</span>
      </div>
    </FreeformSkin>
  );
}
export type MusicFreeformProps = HTMLAttributes<HTMLDivElement> &
  FreeformAppearanceProps & {
    title: string;
    artist: string;
    elapsed: string;
    /** Short caption above the title. */
    caption: string;
    artwork?: ReactNode;
  };
export function MusicFreeform({
  title,
  artist,
  elapsed,
  caption,
  artwork,
  ...props
}: MusicFreeformProps): JSX.Element {
  return (
    <FreeformSkin {...props} skin="music">
      <div
        className={[styles.freeformContent, styles.darkArtworkCopy, styles.musicFreeformCopy].join(
          " ",
        )}
      >
        <div className={[styles.song, styles.musicFreeformSong].join(" ")}>
          <span className={[styles.cover, styles.musicFreeformCover].join(" ")}>
            {artwork ?? <Icon name="music" size={26} />}
          </span>
          <span className={styles.rowCopy}>
            <span className={[styles.small, styles.artworkFaint].join(" ")}>{caption}</span>
            <strong className={styles.songTitle}>{title}</strong>
            <span className={styles.artworkMuted}>{artist}</span>
          </span>
          <span className={[styles.small, styles.artworkFaint].join(" ")}>{elapsed}</span>
        </div>
      </div>
    </FreeformSkin>
  );
}
export type WeatherWidgetProps = HTMLAttributes<HTMLDivElement> &
  FreeformAppearanceProps & {
    temperature: string;
    condition: string;
    location: string;
    opaque?: boolean;
  };
export function WeatherWidget({
  temperature,
  condition,
  location,
  ...props
}: WeatherWidgetProps): JSX.Element {
  return (
    <FreeformSkin {...props} skin="weather">
      <div className={[styles.freeformContent, styles.weatherCopy].join(" ")}>
        <Icon name="cloud" size={26} />
        <span className={styles.weatherTemperature}>{temperature}</span>
        <span className={styles.weatherCondition}>
          <strong>{condition}</strong>
          <span className={styles.weatherLocation}>{location}</span>
        </span>
      </div>
    </FreeformSkin>
  );
}
export type EnvelopeFreeformProps = HTMLAttributes<HTMLDivElement> &
  FreeformAppearanceProps & {
    title: string;
    date: string;
    completed: number;
    total: number;
    /** Small heading above the title. */
    label: string;
  };
export function EnvelopeFreeform({
  title,
  date,
  completed,
  total,
  label,
  ...props
}: EnvelopeFreeformProps): JSX.Element {
  return (
    <FreeformSkin {...props} skin="envelope">
      <div className={[styles.freeformContent, styles.envelopeCopy].join(" ")}>
        <span className={styles.envelopeLabel}>{label}</span>
        <strong className={styles.envelopeTitle}>{title}</strong>
        <span className={styles.envelopeDate}>{date}</span>
        <span className={styles.envelopeCount}>
          {completed}/{total}
        </span>
      </div>
    </FreeformSkin>
  );
}
export type MemoWidgetProps = HTMLAttributes<HTMLDivElement> &
  FreeformAppearanceProps & {
    title: string;
    children: ReactNode;
  };
export function MemoWidget({ title, children, ...props }: MemoWidgetProps): JSX.Element {
  return (
    <FreeformSkin {...props} skin="memo">
      <div className={[styles.freeformContent, styles.memoCopy].join(" ")}>
        <strong className={styles.memoTitle} data-slot="memo-title">
          {title}
        </strong>
        <span>{children}</span>
      </div>
    </FreeformSkin>
  );
}
export type CounterWidgetProps = HTMLAttributes<HTMLDivElement> &
  FreeformAppearanceProps & {
    value: number;
    target?: number;
    unit?: string;
    layout?: "editor" | "desktop";
  };
export function CounterWidget({
  value,
  target,
  unit = "",
  layout = "desktop",
  ...props
}: CounterWidgetProps): JSX.Element {
  return (
    <FreeformSkin {...props} skin={layout === "editor" ? "counter-editor" : "counter"}>
      <div className={[styles.freeformContent, styles.counter].join(" ")}>
        <span
          className={[styles.count, layout === "desktop" && styles.counterDesktopCount]
            .filter(Boolean)
            .join(" ")}
        >
          {value}
        </span>
        {target !== undefined && (
          <span className={styles.countCaption}>
            /{target}
            {unit}
          </span>
        )}
      </div>
    </FreeformSkin>
  );
}
