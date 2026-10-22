import { useEffect } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { updateAnalyticsConsent } from "../analytics";

/** Keep standalone windows' consent current without retaining application data. */
export function useAnalyticsConsent(): void {
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let receivedEvent = false;
    let unlisten: (() => void) | undefined;
    void listen<boolean>("analytics-consent", (event) => {
      if (!active) return;
      receivedEvent = true;
      updateAnalyticsConsent(event.payload === true);
    })
      .then(async (cleanup) => {
        if (!active) {
          cleanup();
          return;
        }
        unlisten = cleanup;
        const initial = await invoke<boolean>("get_analytics_consent");
        if (active && !receivedEvent) updateAnalyticsConsent(initial === true);
      })
      .catch(() => {
        // A failed consent channel must not leave this window opted in,
        // but a newer event already carries the current consent.
        if (active && !receivedEvent) updateAnalyticsConsent(false);
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);
}
