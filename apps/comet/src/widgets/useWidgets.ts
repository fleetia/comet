import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { command, errorText, isDesktop } from "../hooks/useSnapshot";
import catalog from "../../widgets/catalog.json";
import type { WidgetSnapshot, WidgetView } from "./types";
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
    let subscribed = false;
    let unlisteners: (() => void)[] = [];
    const pending = new Map<string, WidgetView>();
    const merge = (current: WidgetSnapshot, widget: WidgetView): WidgetSnapshot => ({
      ...current,
      widgets: current.widgets.map((entry) =>
        entry.id === widget.id && entry.revision <= widget.revision ? widget : entry,
      ),
    });
    setError(null);
    void Promise.all([listen<WidgetSnapshot>("widgets-state", (event) => {
      if (subscribed) receivedEvent = true;
      pending.clear();
      if (active) {
        setSnapshot(event.payload);
        setError(null);
      }
    }).then((cleanup) => {
      if (active) unlisteners.push(cleanup);
      else cleanup();
    }), listen<WidgetView>("widget-state", (event) => {
      if (!active) return;
      const previous = pending.get(event.payload.id);
      if (!previous || previous.revision <= event.payload.revision) pending.set(event.payload.id, event.payload);
      setSnapshot((current) => current ? merge(current, event.payload) : current);
      setError(null);
    }).then((cleanup) => {
      if (active) unlisteners.push(cleanup);
      else cleanup();
    })])
      .then(async () => {
        if (!active) return;
        subscribed = true;
        const initial = await command<WidgetSnapshot>("get_widgets");
        if (active && !receivedEvent) {
          setSnapshot([...pending.values()].reduce(merge, initial));
        }
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(errorText(cause));
        }
      });
    return () => {
      active = false;
      unlisteners.forEach((stop) => stop());
    };
  }, [revision]);
  return { snapshot, error, reload: () => setRevision((value) => value + 1) };
}
