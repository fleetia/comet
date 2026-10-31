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

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function useSettingsDraft(savedSettings: Settings, scope: SettingsScope): SettingsDraft {
  const [settings, setSettings] = useState(savedSettings);
  const [apiKeys, setApiKeys] = useState<ApiKeyDrafts>({});
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dirty = useRef(new Set<keyof Settings>());
  const saved = useRef(savedSettings);
  const current = useRef(settings);
  const lock = useRef(false);
  const generation = useRef(0);
  const selectedKey = apiKeys[settings.apiProvider];
  const apiKey = selectedKey?.baseUrl === settings.baseUrl ? selectedKey.key : "";
  current.current = settings;
  useEffect(() => {
    saved.current = savedSettings;
    for (const key of dirty.current) {
      if (sameValue(current.current[key], savedSettings[key])) dirty.current.delete(key);
    }
    const next = {
      ...savedSettings,
      ...Object.fromEntries([...dirty.current].map((key) => [key, current.current[key]])),
    };
    current.current = next;
    setSettings(next);
  }, [savedSettings]);
  function change<K extends keyof Settings>(key: K, value: Settings[K]): void {
    if (sameValue(value, saved.current[key])) dirty.current.delete(key);
    else dirty.current.add(key);
    current.current = { ...current.current, [key]: value };
    setSettings(current.current);
    setNotice(null);
  }
  function selectProvider(provider: AiProvider): void {
    const next = selectAiProvider(current.current, provider);
    for (const key of Object.keys(next) as Array<keyof Settings>) {
      if (sameValue(next[key], saved.current[key])) {
        dirty.current.delete(key);
      } else {
        dirty.current.add(key);
      }
    }
    current.current = next;
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
    const submitted = current.current;
    const submittedFields = [...dirty.current];
    const operationGeneration = generation.current;
    try {
      let args = commandArgs;
      if (name === "save_settings") {
        args = {
          settings: submitted,
          scope,
          apiKey: scope === "model" ? apiKey.trim() || null : null,
        };
        const matchingKeys = Object.fromEntries(
          (Object.entries(apiKeys) as Array<[ApiProvider, { baseUrl: string; key: string }]>)
            .filter(
              ([provider, value]) =>
                value.key.trim() && value.baseUrl === getApiProfile(submitted, provider).baseUrl,
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
        if (picked && operationGeneration === generation.current) change("localModelPath", picked);
        return;
      }
      if (name === "test_local_model" || name === "test_apple_model") {
        const result = await command<LocalModelTest>(name, args);
        if (operationGeneration === generation.current) {
          setNotice(`${(result.elapsedMs / 1000).toFixed(1)}초 · ${result.reply}`);
        }
        return;
      }
      await command(name, args);
      if (operationGeneration !== generation.current) return;
      if (name === "save_settings") {
        setApiKeys((previous) =>
          Object.fromEntries(
            Object.entries(previous).filter(
              ([provider, value]) =>
                !sameValue(value, apiKeys[provider as ApiProvider]) ||
                value?.baseUrl !== getApiProfile(submitted, provider as ApiProvider).baseUrl,
            ),
          ),
        );
        saved.current = {
          ...saved.current,
          ...Object.fromEntries(submittedFields.map((key) => [key, submitted[key]])),
        };
        for (const key of submittedFields) {
          if (sameValue(current.current[key], submitted[key])) dirty.current.delete(key);
          else dirty.current.add(key);
        }
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
      if (operationGeneration === generation.current) setError(errorText(cause));
    } finally {
      lock.current = false;
      setPending(null);
    }
  }
  function reset(): void {
    generation.current += 1;
    dirty.current.clear();
    current.current = saved.current;
    setSettings(saved.current);
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
      dirty.current.size > 0 ||
      Object.entries(apiKeys).some(
        ([provider, value]) =>
          Boolean(value?.key.trim()) &&
          value?.baseUrl === getApiProfile(settings, provider as ApiProvider).baseUrl,
      ),
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
