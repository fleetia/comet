import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { command, isDesktop } from "../../hooks/useSnapshot";
import { record, rows } from "../toolData";
import type { WidgetView } from "../types";
import type { DiaryState } from "../Planner/diaryTypes";
import { preparationProgress } from "../PreparationTool/preparationData";
import { widgetLine, widgetTrip } from "./travelSummary";
import type { TripData } from "./travelTypes";

type TripState = Pick<
  DiaryState,
  "revision" | "travels" | "travelPlans" | "travelBookings" | "travelExpenses" | "travelPeople" | "travelTransfers" | "travelPhotos"
>;

function trips(state: TripState): TripData[] {
  return (state.travels ?? []).map((travel) => {
    const of = <T extends { travelId: string }>(list: T[] | undefined) =>
      (list ?? []).filter((value) => value.travelId === travel.id);
    return {
      travel,
      plans: of(state.travelPlans),
      bookings: of(state.travelBookings),
      expenses: of(state.travelExpenses),
      people: of(state.travelPeople),
      transfers: of(state.travelTransfers),
      photos: of(state.travelPhotos),
    };
  });
}

/**
 * Trips live in the diary, so a travel widget gets its line here. The diary is read only
 * while a travel widget exists, and the line refreshes each minute for countdowns.
 */
export function useTravelWidgets(widgets: WidgetView[]): { widgets: WidgetView[]; status: "loading" | "ready" | "error"; reload: () => void } {
  const present = widgets.some((widget) => widget.kind === "travel");
  const [state, setState] = useState<TripState | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(() => isDesktop() ? "loading" : "ready");
  const [attempt, setAttempt] = useState(0);
  const [minute, setMinute] = useState(() => Math.floor(Date.now() / 60_000));
  useEffect(() => {
    if (!present || !isDesktop()) return;
    let active = true;
    let received = false;
    let unlisten: (() => void) | undefined;
    const receive = (value: TripState) => {
      if (!active) return;
      received = true;
      setState((current) => (current && current.revision > value.revision ? current : value));
      setStatus("ready");
    };
    setStatus("loading");
    void (async () => {
      try {
        const cleanup = await listen<TripState>("diary-updated", (event) => receive(event.payload));
        if (!active) { cleanup(); return; }
        unlisten = cleanup;
        receive(await command<TripState>("get_diary"));
      } catch {
        if (active && !received) setStatus("error");
      }
    })();
    const timer = window.setInterval(() => setMinute(Math.floor(Date.now() / 60_000)), 30_000);
    return () => {
      active = false;
      unlisten?.();
      window.clearInterval(timer);
    };
  }, [present, attempt]);
  const result = useMemo(() => {
    if (!present) return widgets;
    const now = new Date(minute * 60_000);
    const trip = state ? widgetTrip(trips(state), now) : undefined;
    const preparation = widgets.find((widget) => widget.kind === "preparation");
    const todo = widgets.find((widget) => widget.kind === "todo");
    const envelope = trip?.travel.envelopeId
      ? rows(record(preparation?.data).envelopes).find((value) => value.id === trip.travel.envelopeId)
      : undefined;
    const line = widgetLine(
      trip,
      envelope ? preparationProgress(envelope, rows(record(todo?.data).items)) : null,
      now,
      status,
    );
    return widgets.map((widget) =>
      widget.kind === "travel" ? { ...widget, data: { ...record(widget.data), line } } : widget,
    );
  }, [present, widgets, state, minute, status]);
  return { widgets: result, status, reload: () => setAttempt((value) => value + 1) };
}
