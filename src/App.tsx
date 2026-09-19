import type { JSX } from "react";
import { Button } from "@fleetia/lagrange";
import { CharacterManager } from "./components/CharacterManager";
import { CompanionBox } from "./components/CompanionBox";
import { Balloon } from "./components/Balloon";
import { DesktopPreview } from "./components/DesktopPreview";
import { SettingsPanel } from "./components/SettingsPanel";
import { WidgetManager } from "./widgets/WidgetManager";
import { WidgetTool } from "./widgets/WidgetTool";
import { WindowHeader } from "./components/WindowHeader";
import { command, isDesktop, useSnapshot } from "./hooks/useSnapshot";
import * as s from "./lagrange.css";

export function App(): JSX.Element {
  const { snapshot, error, reload } = useSnapshot();
  const query = new URLSearchParams(window.location.search);
  const view = query.get("view");
  if (query.get("view") === "widgets") return <WidgetManager />;
  if (query.get("view") === "widget") return <WidgetTool id={query.get("id") ?? ""} />;
  if (!snapshot) {
    return (
      <main className={s.loading}>
        <div className={s.loadingHeader}>
          <WindowHeader
            label="창 닫기"
            onClose={
              view === "settings" || view === "characters"
                ? undefined
                : () => command(view === "balloon" ? "skip_talk" : "hide_boxes")
            }
          >
            <span className={s.eyebrow}>comet</span>
          </WindowHeader>
        </div>
        <p role="status">{error ? "준비하지 못했어요." : "…"}</p>
        {error && (
          <>
            <p className={s.error} role="alert">
              {error}
            </p>
            <Button variant="secondary" onClick={reload}>
              다시 시도
            </Button>
          </>
        )}
      </main>
    );
  }
  if (query.get("view") === "characters") return <CharacterManager snapshot={snapshot} />;
  if (query.get("view") === "settings") {
    return <SettingsPanel snapshot={snapshot} />;
  }
  if (query.get("view") === "balloon") {
    return <Balloon snapshot={snapshot} />;
  }
  const persona = query.get("persona");
  if (persona === "a" || persona === "b") {
    return <CompanionBox persona={persona} snapshot={snapshot} />;
  }
  if (isDesktop()) {
    return <CompanionBox persona="a" snapshot={snapshot} />;
  }
  return <DesktopPreview initial={snapshot} />;
}
