import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { command, errorText, isDesktop } from "../hooks/useSnapshot";
import catalog from "../../widgets/catalog.json";
import type { WidgetSnapshot } from "./types";
import { getWidgetPreview } from "./previewWidgets";
import { getPlannerPreview } from "./Planner/previewPlanner";

export const PREVIEW_WIDGETS: WidgetSnapshot = { catalog, widgets: [], onboardingDone: false };

export function useWidgets(): {
  snapshot: WidgetSnapshot | null;
  error: string | null;
  reload: () => void;
} {
  const [snapshot, setSnapshot] = useState<WidgetSnapshot | null>(() => {
    if (isDesktop()) {
      return null;
    }
    const query = new URLSearchParams(window.location.search);
    if (query.get("view") === "planner") return getPlannerPreview();
    return query.get("view") === "widget" ||
      query.get("view") === "widget-display" ||
      query.get("view") === "memo-note" ||
      query.get("preview") === "installed"
      ? getWidgetPreview()
      : PREVIEW_WIDGETS;
  });
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!isDesktop()) {
      return;
    }
    let active = true;
    let receivedEvent = false;
    let unlisten: (() => void) | undefined;
    setError(null);
    void listen<WidgetSnapshot>("widgets-state", (event) => {
      receivedEvent = true;
      if (active) {
        setSnapshot(event.payload);
        setError(null);
      }
    })
      .then(async (cleanup) => {
        if (!active) {
          cleanup();
          return;
        }
        unlisten = cleanup;
        const initial = await command<WidgetSnapshot>("get_widgets");
        if (active && !receivedEvent) {
          setSnapshot(initial);
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(errorText(cause));
        }
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [revision]);
  return { snapshot, error, reload: () => setRevision((value) => value + 1) };
}
