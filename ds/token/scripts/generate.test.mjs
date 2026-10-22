import { describe, expect, it } from "vitest";
import source from "../figma/variables.json";
import { buildTokenArtifacts } from "./generate.mjs";

const themeCollection = {
  id: "theme",
  name: "Theme",
  defaultModeId: "dark",
  modes: [
    { modeId: "dark", name: "Dark" },
    { modeId: "light", name: "Light" },
    { modeId: "paper", name: "Paper" },
    { modeId: "play", name: "Play" },
  ],
};
const sharedCollection = {
  id: "shared",
  name: "Shared",
  defaultModeId: "shared",
  modes: [{ modeId: "shared", name: "Core" }],
};
const sharedVariable = (id, name, value) => ({
  id,
  name,
  type: "FLOAT",
  collectionId: "shared",
  valuesByMode: { shared: value },
});

describe("Figma token generation", () => {
  it("converts the live source's alpha, dimensions, typography, and durations without applying a theme globally", () => {
    const { css, tokenNames, themes } = buildTokenArtifacts(source);
    expect(themes.dark["color/sky-glow-violet"]).toBe("rgb(118 92 214 / 0.26)");
    expect(themes.light["color/sky-glow-violet"]).toBe("rgb(226 232 246 / 0.5)");
    expect(css).toContain("--comet-spacing-space-4: 4px;");
    expect(css).toContain("--comet-typography-sans-body-sm-font-size: 12.5px;");
    expect(css).toContain("--comet-typography-sans-body-font-weight: 400;");
    expect(css).toContain("--comet-duration-duration-fast: 0.18s;");
    expect(css).toContain("--comet-scale-scale-pop-from: 0.6;");
    expect(css).toContain("--comet-opacity-opacity-dim: 0.55;");
    expect(css).toContain('[data-comet-theme="light"] {');
    expect(css.split('[data-comet-theme="dark"]')[0]).not.toContain("--comet-color-sky:");
    expect(tokenNames["palette/night/밤 카드"]).toBe("--comet-palette-night-밤-카드");
    expect(themes.light["typography/sans/body-sm/fontSize"]).toBe(12.5);
    expect(themes.light["text/error-helper-weight"]).toBe(600);
    expect(themes.dark["text/error-helper-weight"]).toBe(400);
  });

  it("resolves aliases against the selected target collection's mode and keeps shared numbers for both themes", () => {
    const result = buildTokenArtifacts({
      collections: [themeCollection, sharedCollection],
      variables: [
        sharedVariable("base", "spacing/base", 4),
        {
          id: "color",
          name: "color/base",
          type: "COLOR",
          collectionId: "theme",
          valuesByMode: {
            dark: { r: 0.25, g: 0.5, b: 1, a: 0.125 },
            light: { r: 1, g: 1, b: 1, a: 1 },
            paper: { r: 1, g: 1, b: 1, a: 1 },
            play: { r: 0, g: 0, b: 0, a: 1 },
          },
        },
        {
          id: "alias",
          name: "color/alias",
          type: "COLOR",
          collectionId: "shared",
          valuesByMode: { shared: { type: "VARIABLE_ALIAS", id: "color" } },
        },
      ],
    });
    expect(result.themes.dark["color/alias"]).toBe("rgb(63.75 127.5 255 / 0.125)");
    expect(result.themes.light["color/alias"]).toBe("rgb(255 255 255)");
    expect(result.css.split('[data-comet-theme="dark"]')[0]).not.toContain("--comet-color-alias:");
    expect(result.css).toContain("--comet-color-alias: rgb(255 255 255);");
    expect(result.themes.play["color/alias"]).toBe("rgb(0 0 0)");
    expect(result.css).toContain('[data-comet-theme="play"] {');
    expect(result.themes.dark["spacing/base"]).toBe(4);
    expect(result.themes.play["spacing/base"]).toBe(4);
  });

  it("rejects paths that normalize to the same CSS property", () => {
    expect(() =>
      buildTokenArtifacts({
        collections: [sharedCollection],
        variables: [
          sharedVariable("a", "size/fontSize", 12),
          sharedVariable("b", "size/font-size", 14),
        ],
      }),
    ).toThrow("CSS property collision");
  });

  it.each([
    [
      "missing alias",
      [sharedVariable("a", "spacing/a", { type: "VARIABLE_ALIAS", id: "missing" })],
      "Missing alias",
    ],
    [
      "alias cycle",
      [
        sharedVariable("a", "spacing/a", { type: "VARIABLE_ALIAS", id: "b" }),
        sharedVariable("b", "spacing/b", { type: "VARIABLE_ALIAS", id: "a" }),
      ],
      "Alias cycle",
    ],
    [
      "missing mode value",
      [{ ...sharedVariable("a", "spacing/a", 4), valuesByMode: {} }],
      "Missing mode value",
    ],
  ])("rejects %s instead of producing incomplete tokens", (_name, variables, message) => {
    expect(() => buildTokenArtifacts({ collections: [sharedCollection], variables })).toThrow(
      message,
    );
  });

  it("rejects a missing light mode rather than borrowing the dark mode", () => {
    expect(() =>
      buildTokenArtifacts({
        collections: [
          {
            ...themeCollection,
            modes: [
              themeCollection.modes[0],
              { modeId: "other", name: "Other" },
              ...themeCollection.modes.slice(2),
            ],
          },
        ],
        variables: [],
      }),
    ).toThrow("Missing or ambiguous light mode");
  });
});
