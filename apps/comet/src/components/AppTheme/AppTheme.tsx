import { useLayoutEffect, useMemo, type CSSProperties, type JSX, type ReactNode } from "react";
import { ThemeRoot } from "@comet/ui";
import { appearanceVars, resolveTheme, type AppSurface } from "../../appearance";
import { useAppearance, useSystemDark } from "../../hooks/useAppearance";

type Props = { surface: AppSurface; className?: string; children: ReactNode };

/** Applies the saved theme, skin and surface opacity to this window, portals included. */
export function AppTheme({ surface, className, children }: Props): JSX.Element {
  const { appearance } = useAppearance();
  const systemDark = useSystemDark();
  const theme = resolveTheme(appearance, systemDark);
  const vars = useMemo(
    () => appearanceVars(appearance, theme, surface),
    [appearance, theme, surface],
  );
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.cometTheme = theme;
    for (const [name, value] of Object.entries(vars)) root.style.setProperty(name, value);
    return () => {
      for (const name of Object.keys(vars)) root.style.removeProperty(name);
    };
  }, [theme, vars]);
  return (
    <ThemeRoot
      theme={theme}
      typeface={surface === "app" ? "ui" : "skin"}
      className={className}
      style={vars as CSSProperties}
    >
      {children}
    </ThemeRoot>
  );
}
