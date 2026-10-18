import type { FreeformSkinName, ShapePreset, WidgetShape } from "@comet/ui";
import type { WidgetView } from "../types";
import { desktopKind } from "./desktopState";

export const SHAPE_LIMITS = { minWidth: 48, maxWidth: 800, minHeight: 24, maxHeight: 600 };

/**
 * Design-system skin drawn for each desktop kind (see desktopKinds.json), and the vector
 * preset that replaces the skin artwork once a default shape is recoloured or filled.
 * Kinds without a skin render as a compact capsule.
 */
export const DESKTOP_SKINS: Record<
  string,
  { skin?: FreeformSkinName; fallbackPreset: Exclude<ShapePreset, "default"> }
> = {
  clock: { skin: "clock", fallbackPreset: "circle" },
  weather: { skin: "weather", fallbackPreset: "cloud" },
  "focus-timer": { skin: "focus", fallbackPreset: "07" },
  music: { skin: "music", fallbackPreset: "10" },
  preparation: { skin: "envelope", fallbackPreset: "22" },
  memo: { skin: "memo", fallbackPreset: "14" },
  todo: { fallbackPreset: "13" },
  calendar: { fallbackPreset: "13" },
  travel: { fallbackPreset: "13" },
};

export function desktopSkin(kind: string): (typeof DESKTOP_SKINS)[string] | undefined {
  return Object.hasOwn(DESKTOP_SKINS, kind) ? DESKTOP_SKINS[kind] : undefined;
}

export function defaultShape(widget: WidgetView): WidgetShape {
  const size = desktopKind(widget.kind) ?? { width: 214, height: 150 };
  return {
    source: "preset",
    preset: "default",
    cloudCount: 4,
    roundness: 70,
    rotation: 0,
    flipX: false,
    flipY: false,
    fitContent: true,
    width: size.width,
    height: size.height,
    strokes: [],
  };
}

export function resizeShape(shape: WidgetShape, dx: number, dy: number): WidgetShape {
  return {
    ...shape,
    width: Math.round(
      Math.max(SHAPE_LIMITS.minWidth, Math.min(SHAPE_LIMITS.maxWidth, shape.width + dx)),
    ),
    height: Math.round(
      Math.max(SHAPE_LIMITS.minHeight, Math.min(SHAPE_LIMITS.maxHeight, shape.height + dy)),
    ),
  };
}
