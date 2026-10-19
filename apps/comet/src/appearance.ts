import { themes, tokenNames, type Theme, type TokenPath } from "@comet/token";
import { deriveSkin, skinBase, skinWarnings, type SkinWarning } from "@comet/token/skin";
import type { Appearance, CustomSkin } from "./types";

export const DEFAULT_APPEARANCE: Appearance = {
  colorMode: "system",
  skin: "night",
  customSkin: null,
  balloonOpacity: 100,
  widgetOpacity: 100,
  revision: 0,
};

export const DEFAULT_CUSTOM_SKIN: CustomSkin = {
  background: "#1f3b33",
  balloon: "#f3efe2",
  widget: "#d9eadf",
  accent: "#2f7d5b",
};

/** Where a window sits: desktop surfaces follow the opacity sliders and skin typeface. */
export type AppSurface = "app" | "balloon" | "widget";

export function surfaceFor(view: string | null, desktop: boolean): AppSurface {
  if (view === "balloon" || view === "conversation-input") return "balloon";
  if (view === "widget-stack" || view === "widget-display" || view === "memo-note") return "widget";
  // The bare desktop window holds the character body; the browser preview is an app page.
  if (!view && desktop) return "balloon";
  return "app";
}

/** Single-look skins lock the color mode; night follows it. */
export function locksColorMode(appearance: Appearance): boolean {
  return appearance.skin !== "night" && !(appearance.skin === "custom" && !appearance.customSkin);
}

export function resolveTheme(appearance: Appearance, systemDark: boolean): Theme {
  if (appearance.skin === "paper" || appearance.skin === "play") return appearance.skin;
  if (appearance.skin === "custom" && appearance.customSkin) {
    return skinBase(appearance.customSkin);
  }
  if (appearance.colorMode === "system") return systemDark ? "dark" : "light";
  return appearance.colorMode;
}

/** Token overrides for a custom skin, keyed by CSS custom property. */
export function customSkinVars(skin: CustomSkin): Record<string, string> {
  const values = deriveSkin(themes[skinBase(skin)], skin);
  return Object.fromEntries(
    Object.entries(values).map(([path, value]) => [tokenNames[path as TokenPath], value]),
  );
}

export function customSkinWarnings(skin: CustomSkin): SkinWarning[] {
  return skinWarnings(themes[skinBase(skin)], skin);
}

const SURFACE_TOKENS: Record<Exclude<AppSurface, "app">, TokenPath[]> = {
  balloon: ["color/glass-panel", "color/glass-tail", "color/glass-capsule", "color/glass-pill"],
  widget: ["color/glass-widget", "color/glass-panel", "color/glass-pill"],
};

/** Every CSS custom property this window overrides on top of the generated theme. */
export function appearanceVars(
  appearance: Appearance,
  theme: Theme,
  surface: AppSurface,
): Record<string, string> {
  const vars =
    appearance.skin === "custom" && appearance.customSkin
      ? customSkinVars(appearance.customSkin)
      : {};
  if (surface === "app") return vars;
  const opacity = surface === "balloon" ? appearance.balloonOpacity : appearance.widgetOpacity;
  if (opacity >= 100) return vars;
  for (const path of SURFACE_TOKENS[surface]) {
    const name = tokenNames[path];
    const value = vars[name] ?? themes[theme][path];
    vars[name] = `color-mix(in srgb, ${value} ${opacity}%, transparent)`;
  }
  return vars;
}
