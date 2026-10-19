import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
// Load app primitives before feature styles so feature classes can override them.
import "./primitives.css";
import { App } from "./App";
import { AppTheme } from "./components/AppTheme/AppTheme";
import { surfaceFor } from "./appearance";
import * as desktop from "./desktop.css";
import { command, isDesktop } from "./hooks/useSnapshot";
import { initializeAnalytics, initializeErrorReporting } from "./analytics";
import "./fonts.css";

document.documentElement.classList.add(desktop.documentRoot);
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
    <AppTheme
      surface={surfaceFor(new URLSearchParams(window.location.search).get("view"), isDesktop())}
      className={desktop.root}
    >
      <App />
    </AppTheme>
  </StrictMode>,
);
