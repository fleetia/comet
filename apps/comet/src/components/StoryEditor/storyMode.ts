import type { ScenarioDefinition } from "../../types";

export type StoryMode = "scene" | "proposal";

export function changeStoryMode(scenario: ScenarioDefinition, mode: StoryMode): ScenarioDefinition {
  const line = { persona: scenario.centerId, expression: "평온", text: "" };
  return {
    ...scenario,
    purpose: "story",
    chapters:
      mode === "scene"
        ? [{ id: crypto.randomUUID(), title: "", next: "end", steps: [{ kind: "line", ...line }] }]
        : null,
    revealAffinity: null,
    defer: [],
    intro: mode === "proposal" ? [{ ...line }] : [],
    accept: mode === "proposal" ? [{ ...line }] : [],
    decline: mode === "proposal" ? [{ ...line }] : [],
    ending: mode === "proposal" ? [{ ...line }] : [],
    acceptKeywords: mode === "proposal" ? ["좋아"] : [],
    declineKeywords: mode === "proposal" ? ["다음에"] : [],
    proceedKeywords: mode === "proposal" ? ["계속하자"] : [],
    cancelKeywords: mode === "proposal" ? ["그만하자"] : [],
    acceptNextId: null,
    declineNextId: null,
  };
}
