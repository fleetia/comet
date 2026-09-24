import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";

export const SETTINGS_SECTIONS = [
  { id: "characters", label: "캐릭터", group: "관리" },
  { id: "widgets", label: "위젯", group: "관리" },
  { id: "automatic", label: "자동 대화", group: "대화" },
  { id: "wordbook", label: "개인 단어장", group: "대화" },
  { id: "talk", label: "대화팩", group: "대화" },
  { id: "user", label: "사용자", group: "앱" },
  { id: "model", label: "AI 연결", group: "앱" },
  { id: "general", label: "일반", group: "앱" },
] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

function sectionFrom(value: unknown): SettingsSection | null {
  if (value === "memory") return "characters";
  if (value === "updates") return "general";
  return SETTINGS_SECTIONS.find((item) => item.id === value)?.id ?? null;
}

export function useSettingsNavigation(initialSection?: string): {
  section: SettingsSection;
  visited: ReadonlySet<SettingsSection>;
  navigate: (value: string) => void;
  navigationError: string | null;
  memoryTabRequest: number;
} {
  const initial = initialSection ?? new URLSearchParams(window.location.search).get("section");
  const [memoryTabRequest, setMemoryTabRequest] = useState(initial === "memory" ? 1 : 0);
  const [section, setSection] = useState<SettingsSection>(sectionFrom(initial) ?? "characters");
  const [visited, setVisited] = useState<ReadonlySet<SettingsSection>>(() => new Set([section]));
  const [navigationError, setNavigationError] = useState<string | null>(null);
  const navigationRevision = useRef(0);

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
    if (isDesktop()) {
      void command("set_settings_section", { section: next }).catch((cause: unknown) =>
        setNavigationError(errorText(cause)),
      );
    }
  }
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    let cleanup: (() => void) | undefined;
    const revision = navigationRevision.current;
    void listen<string>("open-settings-section", (event) => {
      if (active) select(event.payload);
    })
      .then(async (unlisten) => {
        if (!active) {
          unlisten();
          return;
        }
        cleanup = unlisten;
        const latest = await command<string>("get_settings_section");
        if (active && navigationRevision.current === revision) select(latest);
      })
      .catch((cause: unknown) => {
        if (active) setNavigationError(errorText(cause));
      });
    return () => {
      active = false;
      cleanup?.();
    };
  }, []);
  return { section, visited, navigate, navigationError, memoryTabRequest };
}
