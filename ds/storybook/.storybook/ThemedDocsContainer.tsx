import { useEffect, useLayoutEffect, useState, type JSX, type PropsWithChildren } from "react";
import { DocsContainer, type DocsContainerProps } from "@storybook/addon-docs/blocks";
import { GLOBALS_UPDATED } from "storybook/internal/core-events";
import type { GlobalsUpdatedPayload } from "storybook/internal/types";
import type { Theme } from "@comet/token";
import { catalogThemes } from "./catalogThemes";

export function ThemedDocsContainer({
  context,
  children,
}: PropsWithChildren<DocsContainerProps>): JSX.Element {
  const { channel } = context;
  const [theme, setTheme] = useState<Theme>(() => {
    const update: GlobalsUpdatedPayload | undefined = channel.last(GLOBALS_UPDATED)?.[0];
    return update?.globals.theme === "dark" ? "dark" : "light";
  });

  useEffect(() => {
    const updateTheme = ({ globals }: GlobalsUpdatedPayload): void => {
      setTheme(globals.theme === "dark" ? "dark" : "light");
    };
    channel.on(GLOBALS_UPDATED, updateTheme);
    const update: GlobalsUpdatedPayload | undefined = channel.last(GLOBALS_UPDATED)?.[0];
    if (update) {
      updateTheme(update);
    }
    return () => {
      channel.off(GLOBALS_UPDATED, updateTheme);
    };
  }, [channel]);

  useLayoutEffect(() => {
    document.documentElement.dataset.cometTheme = theme;
  }, [theme]);

  return (
    <DocsContainer context={context} theme={catalogThemes[theme]}>
      {children}
    </DocsContainer>
  );
}
