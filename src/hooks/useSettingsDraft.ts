import { useEffect, useRef, useState } from "react";
import type { Settings } from "../types";
import { command, errorText } from "./useSnapshot";

export type SettingsDraft = {
  settings: Settings;
  apiKey: string;
  setApiKey: (value: string) => void;
  pending: string | null;
  error: string | null;
  notice: string | null;
  hasChanges: boolean;
  validInterval: boolean;
  change: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  run: (name: string, commandArgs?: Record<string, unknown>) => Promise<void>;
  reset: () => void;
};

export function useSettingsDraft(savedSettings: Settings): SettingsDraft {
  const [settings, setSettings] = useState<Settings>(savedSettings);
  const [apiKey, setApiKey] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = useRef(false);
  const lock = useRef(false);
  useEffect(() => {
    if (!dirty.current) {
      setSettings(savedSettings);
    }
  }, [savedSettings]);
  function change<K extends keyof Settings>(key: K, value: Settings[K]): void {
    dirty.current = true;
    setSettings((previous) => ({ ...previous, [key]: value }));
  }
  async function run(name: string, commandArgs?: Record<string, unknown>): Promise<void> {
    if (lock.current) {
      return;
    }
    lock.current = true;
    setPending(name);
    setError(null);
    setNotice(null);
    try {
      let args = commandArgs;
      if (name === "save_settings" || name === "test_connection") {
        args = { settings, apiKey: apiKey.trim() || null };
      } else if (name === "download_model") {
        args = { model: settings.localModel };
      }
      await command(name, args);
      if (name === "save_settings") {
        setApiKey("");
        dirty.current = false;
        setNotice("설정을 저장했어요.");
      }
      if (name === "clear_api_key") {
        setApiKey("");
        setNotice("저장된 API 키를 지웠어요.");
      }
      if (name === "test_connection") {
        setNotice("연결을 확인했어요.");
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      lock.current = false;
      setPending(null);
    }
  }
  const hasChanges = dirty.current || apiKey.length > 0;
  const validInterval =
    Number.isInteger(settings.idleMinutes) &&
    settings.idleMinutes >= 1 &&
    settings.idleMinutes <= 60;
  function reset(): void {
    dirty.current = false;
    setSettings(savedSettings);
    setApiKey("");
    setError(null);
    setNotice(null);
  }
  return {
    settings,
    apiKey,
    setApiKey,
    pending,
    error,
    notice,
    hasChanges,
    validInterval,
    change,
    run,
    reset,
  };
}
