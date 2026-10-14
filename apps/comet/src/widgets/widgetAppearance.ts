import { convertFileSrc } from "@tauri-apps/api/core";
import { isDesktop } from "../hooks/useSnapshot";
import { record, text, type DataRecord } from "./toolData";
import type { WidgetValue, WidgetView } from "./types";

export const PLACEMENTS = [
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center-center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
] as const;

export type Placement = (typeof PLACEMENTS)[number];
export type WidgetAppearance = {
  backgroundColor: string;
  backgroundPosition: Placement;
  textColor: string;
  textPosition: Placement;
};
export type Alignment = {
  alignItems: "flex-start" | "center" | "flex-end";
  justifyContent: "flex-start" | "center" | "flex-end";
};

export const DEFAULT_APPEARANCE: WidgetAppearance = {
  backgroundColor: "#24202d",
  backgroundPosition: "center-center",
  textColor: "#fffaf2",
  textPosition: "center-center",
};

const PLACEMENT_LABELS: Record<Placement, string> = {
  "top-left": "왼쪽 위",
  "top-center": "가운데 위",
  "top-right": "오른쪽 위",
  "center-left": "왼쪽 가운데",
  "center-center": "가운데",
  "center-right": "오른쪽 가운데",
  "bottom-left": "왼쪽 아래",
  "bottom-center": "가운데 아래",
  "bottom-right": "오른쪽 아래",
};

function isColor(value: string): boolean {
  return /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(value);
}

export function isPlacement(value: string): value is Placement {
  return (PLACEMENTS as readonly string[]).includes(value);
}

export function placementLabel(placement: Placement): string {
  return PLACEMENT_LABELS[placement];
}

export function getWidgetAppearance(value: WidgetValue): WidgetAppearance {
  const appearance = record(record(value).appearance);
  const backgroundColor = text(appearance.backgroundColor);
  const backgroundPosition = text(appearance.backgroundPosition);
  const textColor = text(appearance.textColor);
  const textPosition = text(appearance.textPosition);
  return {
    backgroundColor: isColor(backgroundColor) ? backgroundColor : DEFAULT_APPEARANCE.backgroundColor,
    backgroundPosition: isPlacement(backgroundPosition)
      ? backgroundPosition
      : DEFAULT_APPEARANCE.backgroundPosition,
    textColor: isColor(textColor) ? textColor : DEFAULT_APPEARANCE.textColor,
    textPosition: isPlacement(textPosition) ? textPosition : DEFAULT_APPEARANCE.textPosition,
  };
}

export function placementAlignment(placement: Placement): Alignment {
  const [vertical, horizontal] = placement.split("-");
  return {
    alignItems: vertical === "top" ? "flex-start" : vertical === "bottom" ? "flex-end" : "center",
    justifyContent:
      horizontal === "left" ? "flex-start" : horizontal === "right" ? "flex-end" : "center",
  };
}

export function backgroundPosition(placement: Placement): string {
  const [vertical, horizontal] = placement.split("-");
  return `${horizontal} ${vertical}`;
}

export function widgetBackgroundUrl(widget: WidgetView): string | null {
  if (!isDesktop() || typeof widget.backgroundUpdatedAt !== "number") {
    return null;
  }
  return `${convertFileSrc(widget.id, "widget")}?v=${widget.backgroundUpdatedAt}`;
}

export function appearanceInput(appearance: WidgetAppearance): DataRecord {
  return {
    backgroundColor: appearance.backgroundColor,
    backgroundPosition: appearance.backgroundPosition,
    textColor: appearance.textColor,
    textPosition: appearance.textPosition,
  };
}
