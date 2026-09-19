import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ThemeRoot } from "@fleetia/lagrange";
import "@fleetia/lagrange/styles.css";
import { App } from "./App";
import * as desktop from "./desktop.css";

document.documentElement.classList.add(desktop.documentRoot);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeRoot themeClassName={desktop.theme} className={desktop.root}>
      <App />
    </ThemeRoot>
  </StrictMode>,
);
