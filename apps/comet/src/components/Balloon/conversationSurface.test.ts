import { describe, expect, it } from "vitest";
import { themes, tokenNames, type Theme } from "@comet/token";
import { contrast } from "@comet/token/skin";
import { appearanceVars, DEFAULT_APPEARANCE } from "../../appearance";

type Rgba = [number, number, number, number];

function rgba(value: string): Rgba {
  const match = value.match(/^rgb\(([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/);
  if (!match) throw new Error(`Unsupported color: ${value}`);
  return [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4] ?? 1)];
}

function over(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  const channel = (index: number) =>
    (foreground[index] * foreground[3] + background[index] * background[3] * (1 - foreground[3])) /
    alpha;
  return [channel(0), channel(1), channel(2), alpha];
}

function rgb(value: Rgba): string {
  return `rgb(${value[0]} ${value[1]} ${value[2]})`;
}

const underlays = [
  ["white", [255, 255, 255, 1]],
  ["black", [0, 0, 0, 1]],
] as const;

describe("desktop composer action contrast", () => {
  it("captures the original dark-theme failure on a white desktop", () => {
    const background = over(rgba(themes.dark["color/chip"]), [255, 255, 255, 1]);
    expect(contrast(themes.dark["color/ink"], rgb(background))).toBeLessThan(1.2);
  });

  for (const theme of Object.keys(themes) as Theme[]) {
    for (const [underlayName, underlay] of underlays) {
      it(`${theme} stays above 4.5:1 on ${underlayName} at rest, hover and active`, () => {
        const values = themes[theme];
        const surface = rgba(values["color/glass-window"]);
        expect(surface[3]).toBe(1);
        for (const tint of [null, "color/chip", "color/track"] as const) {
          const background = over(tint ? over(rgba(values[tint]), surface) : surface, [
            ...underlay,
          ]);
          expect(contrast(values["color/ink"], rgb(background))).toBeGreaterThanOrEqual(4.5);
        }
      });
    }
  }

  it("does not fade the action backing with the balloon opacity setting", () => {
    for (const theme of Object.keys(themes) as Theme[]) {
      const overrides = appearanceVars(
        { ...DEFAULT_APPEARANCE, balloonOpacity: 0 },
        theme,
        "balloon",
      );
      expect(overrides[tokenNames["color/glass-window"]]).toBeUndefined();
    }
  });
});
