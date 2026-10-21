import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { themes, tokenNames, type Theme, type TokenPath } from "@comet/token";
import { contrast } from "@comet/token/skin";
import { appearanceVars, DEFAULT_APPEARANCE, resolveTheme } from "../appearance";
import { Balloon } from "../components/Balloon/Balloon";
import { inputError } from "../components/Balloon/conversationSurface.css";
import { PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";
import type { Appearance } from "../types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn().mockResolvedValue(undefined),
  isDesktop: () => false,
}));

afterEach(cleanup);

const error = "로컬 실행기가 종료되었습니다. 모델·GPU·메모리와 실행기 버전을 확인해 주세요.";

it("backs the desktop alert with an opaque, skin-aware surface rather than the desktop", async () => {
  const { readFileSync } = await vi.importActual<{
    readFileSync(path: string, encoding: "utf8"): string;
  }>("node:fs");
  const source = readFileSync("src/components/Balloon/conversationSurface.css.ts", "utf8");
  const errorStyle = source.match(/export const inputError = style\(\{([\s\S]*?)\}\);/)?.[1] ?? "";
  expect(errorStyle).toContain('background: tokens["color/glass-window"]');
  expect(errorStyle).toContain('color: tokens["color/ink"]');
  expect(errorStyle).toContain('border: `1px solid ${tokens["color/danger-border"]}`');
  expect(errorStyle).toContain('boxSizing: "border-box"');
  expect(errorStyle).toContain('overflowWrap: "anywhere"');
  expect(errorStyle).not.toMatch(/\b(?:height|maxHeight|overflow|opacity)\s*:/);
});

const appearances: [string, Appearance][] = [
  ...(["dark", "light", "paper", "play"] as Theme[]).map((theme): [string, Appearance] => [
    theme,
    {
      ...DEFAULT_APPEARANCE,
      skin: theme === "paper" || theme === "play" ? theme : "night",
      colorMode: theme === "dark" ? "dark" : "light",
    },
  ]),
  ...["#1e2a33", "#f3efe2", "#888888"].map((surface): [string, Appearance] => [
    `custom ${surface}`,
    {
      ...DEFAULT_APPEARANCE,
      skin: "custom",
      customSkin: {
        background: surface,
        balloon: surface,
        widget: surface,
        accent: "#8266d4",
      },
    },
  ]),
];

it.each(appearances)("keeps %s error text readable at every balloon opacity", (_, appearance) => {
  const theme = resolveTheme(appearance, false);
  for (const balloonOpacity of [0, 25, 50, 100]) {
    const vars = appearanceVars({ ...appearance, balloonOpacity }, theme, "balloon");
    const value = (path: TokenPath) => vars[tokenNames[path]] ?? themes[theme][path];
    const background = String(value("color/glass-window"));
    expect(background).toMatch(/^rgb\([\d ]+\)$/);
    expect(contrast(String(value("color/ink")), background)).toBeGreaterThanOrEqual(4.5);
  }
});

it.each([error, `${error} ${"긴오류".repeat(120)}`])(
  "keeps the full error in the styled alert and removes it after recovery: %s",
  (message) => {
    const snapshot = {
      ...PREVIEW_SNAPSHOT,
      panel: { persona: "builtin-a", mode: "input" as const },
    };
    const { rerender } = render(
      <Balloon
        snapshot={{ ...snapshot, runtime: { ...snapshot.runtime, error: message } }}
        surface="input"
        preview
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(message);
    expect(alert.className).toBe(inputError);
    expect(screen.getByRole("textbox")).toBeTruthy();
    rerender(<Balloon snapshot={snapshot} surface="input" preview />);
    expect(screen.queryByRole("alert")).toBeNull();
  },
);
