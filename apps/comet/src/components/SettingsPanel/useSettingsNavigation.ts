import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { trackSettingsView } from "../../analytics";

export const SETTINGS_SECTIONS = [
  { id: "characters", label: "친구들", group: "관리" },
  { id: "widgets", label: "위젯", group: "관리" },
  { id: "automatic", label: "대화", group: "대화" },
  { id: "dialogue", label: "대사", group: "대화" },
  { id: "desktop", label: "바탕화면", group: "앱" },
  { id: "organizer", label: "Ex-brain", group: "앱" },
  { id: "user", label: "사용자", group: "앱" },
  { id: "model", label: "AI 연결", group: "앱" },
  { id: "general", label: "일반", group: "앱" },
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

function sectionFrom(value: unknown): SettingsSection | null {
  if (value === "memory") {
    return "characters";
  }
  if (value === "updates") {
    return "general";
  }
  if (value === "wordbook" || value === "talk") {
    return "dialogue";
  }
  return SETTINGS_SECTIONS.find((item) => item.id === value)?.id ?? null;
}

export function useSettingsNavigation(initialSection?: string): {
  section: SettingsSection;
  visited: ReadonlySet<SettingsSection>;
  navigate: (value: string) => void;
  navigationError: string | null;
  memoryTabRequest: number;
  characterRequest: { id: string; revision: number } | null;
} {
  const initial = initialSection ?? new URLSearchParams(window.location.search).get("section");
  const [memoryTabRequest, setMemoryTabRequest] = useState(initial === "memory" ? 1 : 0);
  const [section, setSection] = useState<SettingsSection>(sectionFrom(initial) ?? "characters");
  const [visited, setVisited] = useState<ReadonlySet<SettingsSection>>(() => new Set([section]));
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const [characterRequest, setCharacterRequest] = useState<{ id: string; revision: number } | null>(
    null,
  );
  const navigationRevision = useRef(0);
  const manualNavigationRevision = useRef(0);
  const receivedCharacterRequest = useRef<string | null>(null);
  const lastTrackedSection = useRef<SettingsSection | null>(null);

  function select(value: string): void {
    const next = sectionFrom(value);
    if (!next) return;
    if (value === "memory") setMemoryTabRequest((previous) => previous + 1);
    navigationRevision.current += 1;
    setSection(next);
    setVisited((previous) => (previous.has(next) ? previous : new Set([...previous, next])));
  }
  function navigate(value: string): void {
    const next = sectionFrom(value);
    if (!next) return;
    select(value);
    manualNavigationRevision.current = navigationRevision.current;
    setCharacterRequest(null);
    if (isDesktop()) {
      void command("set_settings_section", {
        section: next === "desktop" || next === "user" || next === "organizer" ? "general" : next,
      }).catch((cause: unknown) => setNavigationError(errorText(cause)));
    }
  }
  useEffect(() => {
    if (!isDesktop() || lastTrackedSection.current === section) {
      return;
    }
    lastTrackedSection.current = section;
    trackSettingsView(section);
  }, [section]);
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    let cleanup: (() => void) | undefined;
    const revision = navigationRevision.current;
    async function selectNative(value: string): Promise<void> {
      select(value);
      const selectedRevision = navigationRevision.current;
      if (value !== "characters" && value !== "memory") return;
      const request = await command<{ id: string; requestId: string } | null>(
        "get_settings_character",
      );
      if (!active || !request) return;
      if (navigationRevision.current !== selectedRevision) {
        if (
          manualNavigationRevision.current === navigationRevision.current &&
          manualNavigationRevision.current > selectedRevision
        ) {
          await command("ack_settings_character", { requestId: request.requestId });
        }
        return;
      }
      if (receivedCharacterRequest.current !== request.requestId) {
        receivedCharacterRequest.current = request.requestId;
        setCharacterRequest({ id: request.id, revision: selectedRevision });
      }
      await command("ack_settings_character", { requestId: request.requestId });
    }
    void listen<string>("open-settings-section", (event) => {
      if (active)
        void selectNative(event.payload).catch((cause: unknown) => {
          if (active) setNavigationError(errorText(cause));
        });
    })
      .then(async (unlisten) => {
        if (!active) {
          unlisten();
          return;
        }
        cleanup = unlisten;
        const latest = await command<string>("get_settings_section");
        if (active && navigationRevision.current === revision) await selectNative(latest);
      })
      .catch((cause: unknown) => {
        if (active) setNavigationError(errorText(cause));
      });
    return () => {
      active = false;
      cleanup?.();
    };
  }, []);
  return { section, visited, navigate, navigationError, memoryTabRequest, characterRequest };
}
