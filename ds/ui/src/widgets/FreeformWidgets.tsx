import type { HTMLAttributes, JSX, ReactNode } from "react";
import { Icon } from "@comet/icon";
import { tokens } from "@comet/token";
import clockShape from "./assets/clock-freeform-imgCssClipShapePath.svg";
import clockOutline from "./assets/clock-freeform-imgSvg031.svg";
import focusShape from "./assets/focus-freeform-imgCssClipShapePath.svg";
import focusOutline from "./assets/focus-freeform-imgSvg051.svg";
import musicShape from "./assets/music-freeform-imgCssClipShapePath.svg";
import musicOutline from "./assets/music-freeform-imgSvg041.svg";
import weatherShape from "./assets/weather-freeform-imgCssClipShapePath.svg";
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

const skins = {
  clock: { width: 184, height: 184, shape: clockShape, outline: clockOutline, left: 0, top: 0 },
  focus: { width: 156, height: 168, shape: focusShape, outline: focusOutline, left: 0, top: 0 },
  music: { width: 336, height: 112, shape: musicShape, outline: musicOutline, left: 0, top: 0 },
  weather: {
    width: 230,
    height: 150,
    shape: weatherShape,
    outline: weatherOutline,
    left: 8.41,
    top: 16.38,
  },
  envelope: {
    width: 180,
    height: 200,
    shape: envelopeShape,
    outline: envelopeOutline,
    left: -6.77,
    top: -6.46,
  },
  memo: { width: 214, height: 150, shape: memoShape, outline: memoOutline, left: 0, top: 0 },
  counter: {
    width: 140,
    height: 140,
    shape: counterShape,
    outline: counterOutline,
    left: 6.24,
    top: 8.32,
  },
  "counter-editor": {
    width: 156,
    height: 156,
    shape: counterEditorShape,
    outline: counterEditorOutline,
    left: 6.75,
    top: 9.12,
  },
} as const;

function FreeformSkin({
  skin,
  className,
  style,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { skin: keyof typeof skins }): JSX.Element {
  const design = skins[skin];
  return (
    <div
      {...props}
      className={[styles.freeform, className].filter(Boolean).join(" ")}
      style={{ width: design.width, height: design.height, ...style }}
    >
      <img
        src={design.shape}
        alt=""
        className={styles.asset}
        style={{ left: design.left, top: design.top }}
      />
      <img src={design.outline} alt="" className={styles.asset} />
      {children}
    </div>
  );
}
export type ClockWidgetProps = HTMLAttributes<HTMLDivElement> & {
  time: string;
  date: string;
  badge?: string;
};
export function ClockWidget({ time, date, badge, ...props }: ClockWidgetProps): JSX.Element {
  return (
    <FreeformSkin {...props} skin="clock">
      <div className={[styles.freeformContent, styles.darkArtworkCopy].join(" ")}>
        <span style={{ color: tokens["palette/night/안개"] }}>{date}</span>
        <span className={styles.clockTime}>{time}</span>
        {badge && <span className={styles.clockBadge}>{badge}</span>}
      </div>
    </FreeformSkin>
  );
}
export type FocusTimerFreeformProps = HTMLAttributes<HTMLDivElement> & {
  time: string;
  task: string;
  label?: string;
};
export function FocusTimerFreeform({
  time,
  task,
  label = "집중 중",
  ...props
}: FocusTimerFreeformProps): JSX.Element {
  return (
    <FreeformSkin {...props} skin="focus">
      <div className={[styles.freeformContent, styles.darkArtworkCopy].join(" ")}>
        <strong style={{ color: tokens["palette/night/민트"] }}>{label}</strong>
        <span className={styles.count}>{time}</span>
        <span className={styles.small} style={{ color: tokens["palette/night/안개"] }}>
          {task}
        </span>
      </div>
    </FreeformSkin>
  );
}
export type MusicFreeformProps = HTMLAttributes<HTMLDivElement> & {
  title: string;
  artist: string;
  elapsed: string;
  artwork?: ReactNode;
};
export function MusicFreeform({
  title,
  artist,
  elapsed,
  artwork,
  ...props
}: MusicFreeformProps): JSX.Element {
  return (
    <FreeformSkin {...props} skin="music">
      <div
        className={[styles.freeformContent, styles.darkArtworkCopy].join(" ")}
        style={{ padding: "0 30px" }}
      >
        <div className={styles.song} style={{ width: "100%" }}>
          <span
            className={styles.cover}
            style={{
              background: "rgba(182,160,234,0.14)",
              color: tokens["palette/night/연라벤더"],
            }}
          >
            {artwork ?? <Icon name="music" size={26} />}
          </span>
          <span className={styles.rowCopy}>
            <span className={styles.small} style={{ color: tokens["palette/night/먼 안개"] }}>
              지금 듣는 곡
            </span>
            <strong className={styles.songTitle}>{title}</strong>
            <span style={{ color: tokens["palette/night/안개"] }}>{artist}</span>
          </span>
          <span className={styles.small} style={{ color: tokens["palette/night/먼 안개"] }}>
            {elapsed}
          </span>
        </div>
      </div>
    </FreeformSkin>
  );
}
export type WeatherWidgetProps = HTMLAttributes<HTMLDivElement> & {
  temperature: string;
  condition: string;
  location: string;
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
        <span style={{ display: "flex", flexDirection: "column" }}>
          <strong>{condition}</strong>
          <span style={{ fontSize: 11.5, color: "var(--comet-palette-day-낮-보조)" }}>
            {location}
          </span>
        </span>
      </div>
    </FreeformSkin>
  );
}
export type EnvelopeFreeformProps = HTMLAttributes<HTMLDivElement> & {
  title: string;
  date: string;
  completed: number;
  total: number;
  label?: string;
};
export function EnvelopeFreeform({
  title,
  date,
  completed,
  total,
  label = "준비 봉투",
  ...props
}: EnvelopeFreeformProps): JSX.Element {
  return (
    <FreeformSkin {...props} skin="envelope">
      <div className={[styles.freeformContent, styles.envelopeCopy].join(" ")}>
        <span className={styles.envelopeLabel}>{label}</span>
        <strong style={{ fontSize: 16, lineHeight: "21px" }}>{title}</strong>
        <span style={{ color: "#5c4636", fontSize: 11.5, lineHeight: "15px" }}>{date}</span>
        <span
          style={{
            fontFamily: "var(--comet-typography-display-clock-font-family)",
            fontSize: 22,
            lineHeight: "26px",
            paddingTop: 6,
          }}
        >
          {completed}/{total}
        </span>
      </div>
    </FreeformSkin>
  );
}
export type MemoWidgetProps = HTMLAttributes<HTMLDivElement> & {
  title: string;
  children: ReactNode;
};
export function MemoWidget({ title, children, ...props }: MemoWidgetProps): JSX.Element {
  return (
    <FreeformSkin {...props} skin="memo">
      <div className={[styles.freeformContent, styles.memoCopy].join(" ")}>
        <strong className={styles.memoTitle}>{title}</strong>
        <span>{children}</span>
      </div>
    </FreeformSkin>
  );
}
export type CounterWidgetProps = HTMLAttributes<HTMLDivElement> & {
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
        <span className={styles.count} style={{ fontSize: layout === "desktop" ? 28 : 30 }}>
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
