import type { AiProvider, ApiProfile, ApiProvider, Settings } from "./types";

export const AI_PROVIDERS: ReadonlyArray<{ value: AiProvider; label: string }> = [
  { value: "local", label: "이 기기의 모델" },
  { value: "chatgpt", label: "ChatGPT" },
  { value: "claude", label: "Claude" },
  { value: "gemini", label: "Gemini" },
  { value: "glm", label: "GLM" },
  { value: "custom", label: "사용자 지정 API" },
];

export const API_DEFAULTS: Record<ApiProvider, ApiProfile> = {
  custom: { baseUrl: "https://api.openai.com/v1", apiModel: "", apiTokenParameter: "max_tokens" },
  claude: {
    baseUrl: "https://api.anthropic.com/v1",
    apiModel: "",
    apiTokenParameter: "max_tokens",
  },
  gemini: {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiModel: "",
    apiTokenParameter: "max_tokens",
  },
  glm: { baseUrl: "https://api.z.ai/api/paas/v4", apiModel: "", apiTokenParameter: "max_tokens" },
};

export const API_MODEL_EXAMPLES: Record<ApiProvider, string[]> = {
  custom: [],
  claude: ["claude-opus-5-5"],
  gemini: ["gemini-3.8-flash"],
  glm: ["glm-5.3"],
};

export function getAiProvider(settings: Settings): AiProvider {
  return settings.mode === "api" ? settings.apiProvider : settings.mode;
}

export function getAiProviderLabel(settings: Settings): string {
  return AI_PROVIDERS.find((provider) => provider.value === getAiProvider(settings))!.label;
}

export function getApiProfile(settings: Settings, provider: ApiProvider): ApiProfile {
  if (provider === settings.apiProvider) {
    return {
      baseUrl: settings.baseUrl,
      apiModel: settings.apiModel,
      apiTokenParameter: settings.apiTokenParameter,
    };
  }
  return settings.apiProfiles[provider] ?? API_DEFAULTS[provider];
}

export function selectAiProvider(settings: Settings, provider: AiProvider): Settings {
  if (provider === getAiProvider(settings)) {
    return settings;
  }
  const apiProfiles =
    settings.mode === "api"
      ? {
          ...settings.apiProfiles,
          [settings.apiProvider]: getApiProfile(settings, settings.apiProvider),
        }
      : settings.apiProfiles;
  if (provider === "local" || provider === "chatgpt") {
    return { ...settings, mode: provider, apiProfiles };
  }
  return {
    ...settings,
    ...getApiProfile(settings, provider),
    mode: "api",
    apiProvider: provider,
    apiProfiles,
  };
}
