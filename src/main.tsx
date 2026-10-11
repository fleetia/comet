import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeRoot } from "@fleetia/lagrange";
import "@fleetia/lagrange/styles.css";
import { App } from "./App";
import * as desktop from "./desktop.css";
import { command, isDesktop } from "./hooks/useSnapshot";

document.documentElement.classList.add(desktop.documentRoot);

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
    <ThemeRoot themeClassName={desktop.theme} className={desktop.root}>
      <App />
    </ThemeRoot>
  </StrictMode>,
);
