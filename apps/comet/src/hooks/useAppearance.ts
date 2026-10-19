import { useEffect, useState, useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import type { Appearance } from "../types";
import { DEFAULT_APPEARANCE } from "../appearance";
import { command, errorText, isDesktop } from "./useSnapshot";

type State = { appearance: Appearance; error: string | null };

// One store per window: the theme root and the theme settings page share it, so an edit
// shows at once while saves run one at a time and later edits replace queued ones.
const CACHE_KEY = "comet.appearance";
let state: State = { appearance: cached() ?? DEFAULT_APPEARANCE, error: null };
let queued: Appearance | null = null;
let saving = false;
let started = false;
const listeners = new Set<() => void>();

// The last look seen by any window, so a new window does not flash the default theme
// before the saved value arrives. The saved value always replaces it.
function cached(): Appearance | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? { ...DEFAULT_APPEARANCE, ...(JSON.parse(raw) as Partial<Appearance>) } : null;
  } catch {
    return null;
  }
}

function set(next: Partial<State>): void {
  state = { ...state, ...next };
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(state.appearance));
  } catch {
    /* The cache only avoids a first-frame flash. */
  }
  for (const listener of listeners) listener();
}

function accept(saved: Appearance, fromServer = false): void {
  // Local edits still waiting to be saved win over older broadcasts. The first read replaces
  // the cached look even when the cache carries a newer revision from another profile.
  if (typeof saved !== "object" || saved === null) return;
  if (queued || saving || (!fromServer && saved.revision < state.appearance.revision)) return;
  set({ appearance: { ...DEFAULT_APPEARANCE, ...saved } });
}

function start(): void {
  if (started || !isDesktop()) return;
  started = true;
  void listen<Appearance>("appearance", (event) => accept(event.payload)).catch(
    (cause: unknown) => set({ error: errorText(cause) }),
  );
  void command<Appearance>("get_appearance")
    .then((saved) => accept(saved, true))
    .catch((cause: unknown) => set({ error: errorText(cause) }));
}

async function flush(): Promise<void> {
  if (saving) return;
  saving = true;
  try {
    while (queued) {
      const next = queued;
      queued = null;
      try {
        const saved = await command<Appearance>("save_appearance", { appearance: next });
        const revision = saved?.revision ?? state.appearance.revision;
        set({
          appearance: queued || !saved ? { ...state.appearance, revision } : saved,
          error: null,
        });
      } catch (cause) {
        queued = null;
        const current = await command<Appearance>("get_appearance").catch(() => null);
        set({ appearance: current ?? state.appearance, error: errorText(cause) });
      }
    }
  } finally {
    saving = false;
  }
}

/** Shows the change in this window now and saves it for every window. */
export function updateAppearance(next: Appearance): void {
  set({ appearance: next, error: null });
  if (!isDesktop()) return;
  queued = next;
  void flush();
}

function subscribe(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppearance(): State {
  return useSyncExternalStore(subscribe, () => state);
}

export function useSystemDark(): boolean {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => window.matchMedia?.(query).matches ?? true);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const change = (): void => setDark(media.matches);
    change();
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  return dark;
}
