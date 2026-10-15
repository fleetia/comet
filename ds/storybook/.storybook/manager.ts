import { addons } from "storybook/manager-api";
import { GLOBALS_UPDATED, SET_GLOBALS } from "storybook/internal/core-events";
import type { GlobalsUpdatedPayload } from "storybook/internal/types";
import { themes, tokenNames, type Theme } from "@comet/token";
import { catalogThemes } from "./catalogThemes";

addons.setConfig({ theme: catalogThemes.light });

addons.register("comet/theme", (api) => {
  let theme: Theme | undefined;
  const updateTheme = ({ globals }: Pick<GlobalsUpdatedPayload, "globals">): void => {
    const nextTheme = globals.theme === "dark" ? "dark" : "light";
    if (nextTheme === theme) {
      return;
    }
    theme = nextTheme;
    for (const path of ["color/selected", "color/selected-ink", "color/focus-ring"] as const) {
      document.documentElement.style.setProperty(tokenNames[path], themes[theme][path]);
    }
    document.documentElement.style.setProperty(
      tokenNames["radius/radius-10"],
      `${themes[theme]["radius/radius-10"]}px`,
    );
    addons.setConfig({ theme: catalogThemes[theme] });
  };

  api.on(GLOBALS_UPDATED, updateTheme);
  api.on(SET_GLOBALS, updateTheme);
  updateTheme({ globals: api.getGlobals() });
});
