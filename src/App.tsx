import type { JSX } from "react";
import { Button } from "@fleetia/lagrange";
import { CharacterManager } from "./components/CharacterManager";
import { CompanionBox } from "./components/CompanionBox";
import { FaceTag } from "./components/FaceTag";
import { Balloon } from "./components/Balloon";
import { DesktopPreview } from "./components/DesktopPreview";
import { DesktopToy } from "./components/DesktopToy";
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
  if (view === "desktop-toy") return <DesktopToy id={query.get("id") ?? ""} />;
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
  const face = query.get("face");
  if (face) {
    return <FaceTag id={face} snapshot={snapshot} />;
  }
  const body = query.get("body");
  if (body) {
    return <CompanionBox id={body} snapshot={snapshot} />;
  }
  if (isDesktop()) {
    return <CompanionBox id={snapshot.characters.active[0]} snapshot={snapshot} />;
  }
  return <DesktopPreview initial={snapshot} />;
}
