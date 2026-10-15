import type { CSSProperties } from "react";
import { tokens } from "@comet/token";
import * as styles from "./planner.css";

export function cssVar(variable: string): string {
  return variable.slice(4, -1);
}

export function classes(...names: (string | undefined | false)[]): string {
  return names.filter(Boolean).join(" ");
}

export const plannerColors = {
  work: tokens["color/cat-work"],
  record: tokens["color/cat-record"],
  life: tokens["color/cat-life"],
  exercise: tokens["color/cat-exercise"],
  rest: tokens["color/cat-rest"],
  focus: tokens["color/cat-focus"],
  comet: tokens["color/event-comet"],
  google: tokens["color/event-google"],
} as const;
export type PlannerColor = keyof typeof plannerColors;

export function colorStyle(color: PlannerColor = "record", extra?: CSSProperties): CSSProperties {
  return { [cssVar(styles.accent)]: plannerColors[color], ...extra } as CSSProperties;
}

export function ratio(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) {
    return 0;
  }
  return Math.max(0, Math.min(1, value / max));
}

export function progressStyle(value: number, max: number, color: string): CSSProperties {
  return {
    [cssVar(styles.extent)]: `${ratio(value, max) * 100}%`,
    [cssVar(styles.accent)]: color,
  } as CSSProperties;
}
