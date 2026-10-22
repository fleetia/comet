import { themes, type Theme, type TokenPath } from "@comet/token";
import { expect, it, vi } from "vitest";

const { readFileSync } = await vi.importActual<{
  readFileSync(path: string, encoding: "utf8"): string;
}>("node:fs");
const source = readFileSync("src/components/SettingsPanel/figmaSettings.css.ts", "utf8");
const inspector = source.match(/export const inspector = style\(\{([\s\S]*?)\n\}\);/)?.[1] ?? "";
const backgrounds = [...inspector.matchAll(/background: `([^`]+)`/g)].map((match) => match[1]);

function resolveBackground(background: string, theme: Theme): string {
  return background.replace(/\$\{tokens\["([^"]+)"\]\}/g, (_, path: TokenPath) =>
    String(themes[theme][path]),
  );
}

it.each([
  ["dark", "rgb(182 160 234 / 0.2)", "rgb(182 160 234 / 0)", "rgb(26 36 86 / 0.28)"],
  ["paper", "rgb(251 247 238 / 0.7)", "rgb(251 247 238 / 0)", "rgb(251 247 238 / 0.42)"],
  ["play", "rgb(255 255 255 / 0.7)", "rgb(255 255 255 / 0)", "rgb(255 255 255 / 0.42)"],
] as const)(
  "preserves the #114 Settings inspector paints in %s mode",
  (theme, glow, clear, panel) => {
    expect(resolveBackground(backgrounds[0], theme)).toBe(
      `radial-gradient(ellipse at 50% 0, ${glow}, ${clear} 70%), ${panel}`,
    );
    expect(themes[theme]["color/card-shadow"]).toBe("rgb(36 45 79 / 0)");
  },
);

it("limits the stronger card and new inspector glow to Light mode", () => {
  expect(inspector.match(/'\[data-comet-theme="[^"]+"\] &'/g)).toEqual([
    "'[data-comet-theme=\"light\"] &'",
  ]);
  expect(backgrounds).toHaveLength(2);
  expect(resolveBackground(backgrounds[1], "light")).toBe(
    "radial-gradient(ellipse at 50% 0, rgb(140 150 200 / 0.15), transparent 70%), rgb(255 255 255 / 0.72)",
  );
});
