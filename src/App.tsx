import type { JSX } from "react";
import { CharacterManager } from "./components/CharacterManager";
import { CompanionBox } from "./components/CompanionBox";
import { Balloon } from "./components/Balloon";
import { DesktopPreview } from "./components/DesktopPreview";
import { SettingsPanel } from "./components/SettingsPanel";
import { isDesktop, useSnapshot } from "./hooks/useSnapshot";
import * as s from "./styles.css";

export function App(): JSX.Element {
  const { snapshot, error, reload } = useSnapshot();
  const query = new URLSearchParams(window.location.search);
  if (!snapshot) {
    return (
      <main className={s.loading}>
        <p role="status">{error ? "준비하지 못했어요." : "…"}</p>
        {error && (
          <>
            <p className={s.error} role="alert">
              {error}
            </p>
            <button className={s.button} onClick={reload}>
              다시 시도
            </button>
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
