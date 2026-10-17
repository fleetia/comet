import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeRoot } from "@comet/ui";
import "@fleetia/lagrange/styles.css";
import { App } from "./App";
import * as desktop from "./desktop.css";
import { command, isDesktop } from "./hooks/useSnapshot";
import { initializeAnalytics, initializeErrorReporting } from "./analytics";
import "./fonts.css";

document.documentElement.classList.add(desktop.documentRoot, desktop.theme);
document.documentElement.dataset.cometTheme = "dark";
initializeErrorReporting();
void initializeAnalytics();

if (isDesktop()) {
  let lastTouch = 0;
  const touch = (): void => {
    const now = Date.now();
    if (now - lastTouch < 5000) return;
    lastTouch = now;
    void command("organizer_touch").catch(() => {
      /* Activity notification is best effort. */
    });
  };
  for (const name of ["input", "keydown", "pointerdown"]) {
    document.addEventListener(name, touch, { capture: true, passive: true });
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeRoot theme="dark" className={`${desktop.theme} ${desktop.root}`}>
      <App />
    </ThemeRoot>
  </StrictMode>,
);
