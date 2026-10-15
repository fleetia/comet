import { useEffect, useState, type HTMLAttributes, type JSX, type PointerEvent } from "react";
import { Icon } from "@comet/icon";
import * as styles from "./overlays.css";

type Hsv = { h: number; s: number; v: number };
function toHsv(hex: string): Hsv {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) {
    return { h: 170, s: 0.45, v: 0.85 };
  }
  const [r, g, b] = [1, 3, 5].map(
    (index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255,
  );
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const difference = max - min;
  let h = 0;
  if (difference) {
    if (max === r) {
      h = ((g - b) / difference) % 6;
    } else if (max === g) {
      h = (b - r) / difference + 2;
    } else {
      h = (r - g) / difference + 4;
    }
  }
  return { h: (h * 60 + 360) % 360, s: max ? difference / max : 0, v: max };
}
function toHex({ h, s, v }: Hsv): string {
  const saturation = Math.max(0, Math.min(1, s));
  const value = Math.max(0, Math.min(1, v));
  const chroma = value * saturation;
  const sector = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const m = value - chroma;
  const values = [
    [chroma, x, 0],
    [x, chroma, 0],
    [0, chroma, x],
    [0, x, chroma],
    [x, 0, chroma],
    [chroma, 0, x],
  ][Math.floor(sector)];
  return (
    "#" +
    values
      .map((channel) =>
        Math.round((channel + m) * 255)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
      .toUpperCase()
  );
}
export type ColorPickerProps = HTMLAttributes<HTMLDivElement> & {
  value: string;
  onValueChange?: (value: string) => void;
  colors?: readonly string[];
  label?: string;
};
export function ColorPicker({
  value,
  onValueChange,
  colors = ["#79AFFF", "#FF9F85", "#FFCC33", "#77D9CA", "#B6A0EA", "#FF8BC4", "#8C95C2"],
  label = "색상 선택",
  className,
  ...props
}: ColorPickerProps): JSX.Element {
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    setDraft(value);
  }, [value]);
  const hsv = toHsv(value);
  function change(next: Hsv): void {
    onValueChange?.(toHex(next));
  }
  function pointer(event: PointerEvent<HTMLDivElement>): void {
    if (event.type === "pointermove" && event.buttons !== 1) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) {
      return;
    }
    if (event.type === "pointerdown") {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    change({
      ...hsv,
      s: (event.clientX - rect.left) / rect.width,
      v: 1 - (event.clientY - rect.top) / rect.height,
    });
  }
  return (
    <div
      {...props}
      role="group"
      aria-label={label}
      className={[styles.picker, className].filter(Boolean).join(" ")}
    >
      <span aria-hidden className={styles.pickerTail} />
      <div className={styles.swatches}>
        {colors.map((color) => (
          <button
            key={color}
            type="button"
            className={styles.swatch}
            style={{ background: color }}
            aria-label={color}
            aria-pressed={value.toLowerCase() === color.toLowerCase()}
            onClick={() => onValueChange?.(color)}
          />
        ))}
        <label className={styles.moreColor}>
          <Icon name="plus" size={13} />
          <input
            type="color"
            aria-label="다른 색상 고르기"
            value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#77D9CA"}
            onChange={(event) => onValueChange?.(event.currentTarget.value.toUpperCase())}
            className={styles.nativeColor}
          />
        </label>
      </div>
      <div
        role="slider"
        aria-label="채도와 밝기"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={`채도 ${Math.round(hsv.s * 100)}%, 밝기 ${Math.round(hsv.v * 100)}%`}
        tabIndex={0}
        className={styles.spectrum}
        style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
        onPointerDown={pointer}
        onPointerMove={pointer}
        onKeyDown={(event) => {
          const movement = event.shiftKey ? 0.1 : 0.01;
          if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
            event.preventDefault();
            change({
              ...hsv,
              s:
                hsv.s +
                (event.key === "ArrowRight" ? movement : event.key === "ArrowLeft" ? -movement : 0),
              v:
                hsv.v +
                (event.key === "ArrowUp" ? movement : event.key === "ArrowDown" ? -movement : 0),
            });
          }
        }}
      >
        <span
          className={styles.spectrumCursor}
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }}
        />
      </div>
      <input
        type="range"
        aria-label="색조"
        min={0}
        max={359}
        value={Math.round(hsv.h)}
        onChange={(event) => change({ ...hsv, h: Number(event.currentTarget.value) })}
        className={styles.hue}
      />
      <div className={styles.hexRow}>
        <span className={styles.swatch} style={{ background: value }} />
        <input
          aria-label="HEX 색상"
          spellCheck={false}
          value={draft}
          aria-invalid={!/^#[0-9a-f]{6}$/i.test(draft)}
          onChange={(event) => {
            const next = event.currentTarget.value;
            setDraft(next);
            if (/^#[0-9a-f]{6}$/i.test(next)) {
              onValueChange?.(next.toUpperCase());
            }
          }}
          onBlur={() => setDraft(value)}
          className={styles.hex}
        />
      </div>
    </div>
  );
}
