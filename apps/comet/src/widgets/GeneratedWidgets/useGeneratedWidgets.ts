import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { Workshop } from "./types";

const INITIAL: Workshop = {
  widgets: [],
  automatic: true,
  runtime: "javascript",
  generationEligibility: {
    allowed: false,
    reason: "위젯을 제작할 모델을 확인하고 있어요.",
    model: "",
    parameterBillions: null,
    source: "unknown",
  },
};

export function useGeneratedWidgets(): {
  workshop: Workshop;
  error: string | null;
  reload: () => void;
} {
  const [workshop, setWorkshop] = useState(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const request = useRef(0);
  const reload = useCallback(() => {
    request.current += 1;
    setRevision((value) => value + 1);
  }, []);
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    let cleanup: (() => void) | undefined;
    async function refresh(): Promise<void> {
      if (!active) return;
      const current = ++request.current;
      try {
        const value = await command<Workshop>("get_generated_widgets");
        if (active && current === request.current) {
          setWorkshop({ ...value, widgets: value.widgets.filter((widget) => widget.installed) });
          setError(null);
        }
      } catch (cause: unknown) {
        if (active && current === request.current) setError(errorText(cause));
      }
    }
    void listen("generated-widgets-changed", () => void refresh())
      .then((unlisten) => {
        if (!active) {
          unlisten();
          return;
        }
        cleanup = unlisten;
        void refresh();
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
      cleanup?.();
    };
  }, [revision]);
  return { workshop, error, reload };
}
