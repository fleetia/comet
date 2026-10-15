import { create, type ThemeVars } from "storybook/theming";
import { themes, type Theme } from "@comet/token";

function parseColor(value: string): [number, number, number, number] {
  const channels = value.match(/[\d.]+/g)?.map(Number);
  if (!channels || channels.length < 3 || channels.some((channel) => !Number.isFinite(channel))) {
    throw new Error(`Expected an RGB token, received ${value}`);
  }
  return [channels[0], channels[1], channels[2], channels[3] ?? 1];
}

function resolveColor(value: string, backdrop?: string): string {
  const [red, green, blue, alpha] = parseColor(value);
  const background = backdrop ? parseColor(backdrop) : [0, 0, 0];
  const channels = [red, green, blue].map((channel, index) =>
    Math.round(backdrop ? channel * alpha + background[index] * (1 - alpha) : channel),
  );
  // Storybook's color helpers require integer RGB channels; keep alpha separate.
  if (!backdrop && alpha < 1) {
    return `rgba(${channels.join(", ")}, ${alpha})`;
  }
  return `rgb(${channels.join(", ")})`;
}

function createCatalogTheme(theme: Theme): ThemeVars {
  const palette = themes[theme];
  const canvas = resolveColor(palette["color/document/backdrop-panel/sky"]);
  const window = resolveColor(palette["color/glass-window"], canvas);
  const rail = resolveColor(palette["color/rail"], window);
  const panel = resolveColor(palette["color/glass-panel"], window);
  return create({
    base: theme,
    brandTitle: "Lagrange",
    brandImage: theme === "dark" ? "./brand/lagrange-dark.svg" : "./brand/lagrange.svg",
    appBg: rail,
    appContentBg: panel,
    appPreviewBg: canvas,
    appHoverBg: resolveColor(palette["color/hover"], rail),
    appBorderColor: resolveColor(palette["color/line"]),
    appBorderRadius: palette["radius/radius-12"],
    colorPrimary: resolveColor(palette["color/ink-2"]),
    colorSecondary: resolveColor(palette["color/ink-3"]),
    textColor: resolveColor(palette["color/ink"]),
    textInverseColor: resolveColor(palette["color/on-primary"]),
    textMutedColor: resolveColor(palette["color/ink-3"]),
    barBg: window,
    barTextColor: resolveColor(palette["color/ink-2"]),
    barHoverColor: resolveColor(palette["color/ink"]),
    barSelectedColor: resolveColor(palette["color/selected-icon"]),
    buttonBg: resolveColor(palette["color/chip"], panel),
    buttonBorder: resolveColor(palette["color/input-border"]),
    booleanBg: resolveColor(palette["color/track"], panel),
    booleanSelectedBg: resolveColor(palette["color/primary"]),
    inputBg: resolveColor(palette["color/input"], panel),
    inputBorder: resolveColor(palette["color/input-border"]),
    inputTextColor: resolveColor(palette["color/ink"]),
    inputBorderRadius: palette["radius/radius-12"],
    fontBase: `"${palette["typography/sans/body/fontFamily"]}", system-ui, sans-serif`,
  });
}

export const catalogThemes = {
  light: createCatalogTheme("light"),
  dark: createCatalogTheme("dark"),
};
