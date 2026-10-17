import { useEffect, useRef, useState } from "react";
import type { AiProvider, ApiProvider, LocalModelTest, Settings } from "../types";
import { getApiProfile, selectAiProvider } from "../aiProviders";
import { command, errorText } from "./useSnapshot";

export type SettingsScope = "automatic" | "model";
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
  selectProvider: (provider: AiProvider) => void;
  run: (name: string, commandArgs?: Record<string, unknown>) => Promise<void>;
  reset: () => void;
};
type ApiKeyDrafts = Partial<Record<ApiProvider, { baseUrl: string; key: string }>>;

export function useSettingsDraft(savedSettings: Settings, scope: SettingsScope): SettingsDraft {
  const [settings, setSettings] = useState(savedSettings);
  const [apiKeys, setApiKeys] = useState<ApiKeyDrafts>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = useRef(new Set<keyof Settings>());
  const lock = useRef(false);
  const selectedKey = apiKeys[settings.apiProvider];
  const apiKey = selectedKey?.baseUrl === settings.baseUrl ? selectedKey.key : "";
  useEffect(() => {
    setSettings((previous) => ({
      ...savedSettings,
      ...Object.fromEntries([...dirty.current].map((key) => [key, previous[key]])),
    }));
  }, [savedSettings]);
  function change<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (value === savedSettings[key]) dirty.current.delete(key);
    else dirty.current.add(key);
    setSettings((previous) => ({ ...previous, [key]: value }));
    setNotice(null);
  }
  function selectProvider(provider: AiProvider): void {
    const next = selectAiProvider(settings, provider);
    for (const key of Object.keys(next) as Array<keyof Settings>) {
      if (JSON.stringify(next[key]) === JSON.stringify(savedSettings[key])) {
        dirty.current.delete(key);
      } else {
        dirty.current.add(key);
      }
    }
    setSettings(next);
    setError(null);
    setNotice(null);
  }
  function setApiKey(value: string): void {
    setApiKeys((previous) => ({
      ...previous,
      [settings.apiProvider]: { baseUrl: settings.baseUrl, key: value },
    }));
    setNotice(null);
  }
  async function run(name: string, commandArgs?: Record<string, unknown>): Promise<void> {
    if (lock.current) return;
    lock.current = true;
    setPending(name);
    setError(null);
    setNotice(null);
    try {
      let args = commandArgs;
      if (name === "save_settings") {
        args = { settings, scope, apiKey: scope === "model" ? apiKey.trim() || null : null };
        const matchingKeys = Object.fromEntries(
          (Object.entries(apiKeys) as Array<[ApiProvider, { baseUrl: string; key: string }]>)
            .filter(
              ([provider, value]) =>
                value.key.trim() && value.baseUrl === getApiProfile(settings, provider).baseUrl,
            )
            .map(([provider, value]) => [provider, { ...value, key: value.key.trim() }]),
        );
        if (
          scope === "model" &&
          Object.keys(matchingKeys).some((provider) => provider !== settings.apiProvider)
        ) {
          args.apiKeys = matchingKeys;
        }
      } else if (name === "test_connection") {
        args = { settings: { ...settings, mode: "api" }, apiKey: apiKey.trim() || null };
      } else if (name === "clear_api_key") {
        args = { settings };
      } else if (name === "download_model") {
        args = { model: settings.localModel };
      } else if (name === "test_local_model") {
        args = { settings: { ...settings, mode: "local" } };
      }
      if (name === "pick_model_file") {
        const picked = await command<string | null>(name);
        if (picked) change("localModelPath", picked);
        return;
      }
      if (name === "test_local_model") {
        const result = await command<LocalModelTest>(name, args);
        setNotice(`${(result.elapsedMs / 1000).toFixed(1)}초 · ${result.reply}`);
        return;
      }
      await command(name, args);
      if (name === "save_settings") {
        setApiKeys({});
        dirty.current.clear();
        setNotice(scope === "automatic" ? "자동 대화 설정을 저장했어요." : "AI 연결을 저장했어요.");
      } else if (name === "clear_api_key") {
        setApiKeys((previous) => {
          const next = { ...previous };
          delete next[settings.apiProvider];
          return next;
        });
        setNotice("저장된 API 키를 지웠어요.");
      } else if (name === "test_connection") {
        setNotice("연결을 확인했어요.");
      }
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      lock.current = false;
      setPending(null);
    }
  }
  function reset(): void {
    dirty.current.clear();
    setSettings(savedSettings);
    setApiKeys({});
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
    hasChanges:
      dirty.current.size > 0 || Object.values(apiKeys).some((value) => Boolean(value?.key)),
    validInterval:
      Number.isInteger(settings.idleMinutes) &&
      settings.idleMinutes >= 1 &&
      settings.idleMinutes <= 60,
    change,
    selectProvider,
    run,
    reset,
  };
}
