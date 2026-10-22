import { expect, it } from "vitest";
import { getAiProviders, getRecommendedAiProvider, selectAiProvider } from "../aiProviders";
import { PREVIEW_SNAPSHOT } from "../previewSnapshot";

it.each([
  ["macos", "apple", ["apple", "chatgpt", "local", "claude", "gemini", "glm", "custom"]],
  ["windows", "chatgpt", ["chatgpt", "local", "claude", "gemini", "glm", "custom"]],
  ["linux", null, ["local", "chatgpt", "claude", "gemini", "glm", "custom"]],
] as const)("orders providers for %s", (platform, recommended, expected) => {
  expect(getRecommendedAiProvider(platform)).toBe(recommended);
  expect(getAiProviders(platform, "claude").map((provider) => provider.value)).toEqual(expected);
});

it("keeps a saved Apple selection accessible on unsupported platforms", () => {
  expect(getAiProviders("windows", "apple").some((provider) => provider.value === "apple")).toBe(
    true,
  );
});

it("switches to Apple without losing the API profile or changing automatic generation", () => {
  const settings = {
    ...PREVIEW_SNAPSHOT.settings,
    mode: "api" as const,
    apiProvider: "claude" as const,
    baseUrl: "https://api.anthropic.com/v1",
    apiModel: "saved-model",
  };
  const apple = selectAiProvider(settings, "apple");
  expect(apple.mode).toBe("apple");
  expect(apple.appleIdleEnabled).toBe(false);
  expect(selectAiProvider(apple, "claude")).toMatchObject({
    mode: "api",
    apiProvider: "claude",
    apiModel: "saved-model",
    baseUrl: "https://api.anthropic.com/v1",
  });
});
