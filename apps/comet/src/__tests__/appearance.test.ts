import { describe, expect, it } from "vitest";
import { themes, tokenNames } from "@comet/token";
import {
  appearanceVars,
  DEFAULT_APPEARANCE,
  DEFAULT_CUSTOM_SKIN,
  locksColorMode,
  resolveTheme,
  surfaceFor,
} from "../appearance";

const panel = tokenNames["color/glass-panel"];
const widget = tokenNames["color/glass-widget"];

describe("appearance", () => {
  it("follows the system only for the night skin and locks single-look skins", () => {
    expect(resolveTheme(DEFAULT_APPEARANCE, true)).toBe("dark");
    expect(resolveTheme(DEFAULT_APPEARANCE, false)).toBe("light");
    expect(resolveTheme({ ...DEFAULT_APPEARANCE, colorMode: "light" }, true)).toBe("light");
    const paper = { ...DEFAULT_APPEARANCE, skin: "paper" as const, colorMode: "dark" as const };
    expect(resolveTheme(paper, true)).toBe("paper");
    expect(locksColorMode(paper)).toBe(true);
    expect(locksColorMode(DEFAULT_APPEARANCE)).toBe(false);
    const custom = { ...DEFAULT_APPEARANCE, skin: "custom" as const, customSkin: DEFAULT_CUSTOM_SKIN };
    expect(resolveTheme(custom, true)).toBe("light");
  });

  it("makes only desktop surfaces translucent and keeps app windows opaque", () => {
    const appearance = { ...DEFAULT_APPEARANCE, balloonOpacity: 60, widgetOpacity: 40 };
    expect(appearanceVars(appearance, "dark", "app")).toEqual({});
    expect(appearanceVars({ ...appearance, balloonOpacity: 100 }, "dark", "balloon")).toEqual({});
    const balloon = appearanceVars(appearance, "dark", "balloon");
    expect(balloon[panel]).toBe(
      `color-mix(in srgb, ${themes.dark["color/glass-panel"]} 60%, transparent)`,
    );
    expect(balloon[widget]).toBeUndefined();
    expect(appearanceVars(appearance, "dark", "widget")[widget]).toBe(
      `color-mix(in srgb, ${themes.dark["color/glass-widget"]} 40%, transparent)`,
    );
  });

  it("applies a custom skin everywhere and fades its own balloon color on the desktop", () => {
    const appearance = {
      ...DEFAULT_APPEARANCE,
      skin: "custom" as const,
      customSkin: DEFAULT_CUSTOM_SKIN,
      balloonOpacity: 50,
    };
    expect(appearanceVars(appearance, "light", "app")[panel]).toBe("rgb(243 239 226)");
    expect(appearanceVars(appearance, "light", "balloon")[panel]).toBe(
      "color-mix(in srgb, rgb(243 239 226) 50%, transparent)",
    );
    expect(appearanceVars({ ...appearance, skin: "paper" }, "paper", "app")).toEqual({});
  });

  it("maps windows to the surface they draw on the desktop", () => {
    expect(surfaceFor("balloon", true)).toBe("balloon");
    expect(surfaceFor("widget-stack", true)).toBe("widget");
    expect(surfaceFor("settings", true)).toBe("app");
    expect(surfaceFor("planner", true)).toBe("app");
    expect(surfaceFor(null, true)).toBe("balloon");
    expect(surfaceFor(null, false)).toBe("app");
  });
});
