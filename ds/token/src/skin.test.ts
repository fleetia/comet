import { describe, expect, it } from "vitest";
import { themes } from "./index";
import { contrast, deriveSkin, skinBase, skinWarnings, type SkinPalette } from "./skin";

const paper: SkinPalette = {
  background: "#e6dccb",
  balloon: "#fbf7ee",
  widget: "#fbf7ee",
  accent: "#b4432b",
  ink: "#2b2620",
  border: "#e2d6c1",
  shadow: "#503a18",
};

describe("skin derivation", () => {
  it("recolors role tokens, keeps each component token's alpha, and leaves list colors alone", () => {
    const values = deriveSkin(themes.light, paper);
    expect(values["color/sky"]).toBe("rgb(230 220 203)");
    expect(values["color/skin-sky-start"]).toBe(values["color/sky"]);
    expect(values["color/skin-sky-end"]).toBe(values["color/sky"]);
    expect(values["color/preview-panel"]).toBe("rgb(251 247 238 / 0.42)");
    expect(values["color/glass-panel"]).toBe("rgb(251 247 238)");
    expect(values["color/ink"]).toBe("rgb(43 38 32)");
    expect(values["color/primary"]).toBe("rgb(180 67 43)");
    expect(values["color/glass-border"]).toBe("rgb(226 214 193)");
    expect(values["color/component/primary-alpha-300"]).toBe("rgb(180 67 43 / 0.3)");
    expect(values["color/list-blue"]).toBe(themes.light["color/list-blue"]);
    expect(Object.keys(values).every((path) => path.startsWith("color/"))).toBe(true);
  });

  it("chooses readable text and accent ink when the palette omits them", () => {
    const dark: SkinPalette = {
      background: "#101418",
      balloon: "#1e2a33",
      widget: "#22303a",
      accent: "#ffd23f",
    };
    expect(skinBase(dark)).toBe("dark");
    const values = deriveSkin(themes[skinBase(dark)], dark);
    expect(contrast(values["color/ink"], dark.balloon)).toBeGreaterThanOrEqual(4.5);

    const pale: SkinPalette = { ...paper, ink: undefined, accent: "#fff3c0", balloon: "#ffffff" };
    expect(deriveSkin(themes.light, pale)["color/link"]).toBe(
      deriveSkin(themes.light, pale)["color/ink"],
    );
  });

  it("warns about text that cannot stay readable and an accent that blends in", () => {
    expect(skinWarnings(themes.light, paper)).toEqual([]);
    expect(
      skinWarnings(themes.dark, { ...paper, ink: undefined, balloon: "#101010", widget: "#f0f0f0" }),
    ).toContain("text");
    expect(
      skinWarnings(themes.light, {
        background: "#f4f4f4",
        balloon: "#f5f5f5",
        widget: "#ffffff",
        accent: "#f2f2f2",
      }),
    ).toContain("accent");
  });

  it("generated single-look skins carry their own skin typeface", () => {
    expect(themes.paper["text/skin-font-family"]).toBe("Gowun Dodum");
    expect(themes.play["text/skin-font-family"]).toBe("Jua");
    expect(themes.dark["text/skin-font-family"]).toBe("IBM Plex Sans KR");
  });
});
