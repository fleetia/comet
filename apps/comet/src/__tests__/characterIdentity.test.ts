import { expect, it } from "vitest";
import { activeCharacter, currentExpression, moodExpression, personaOf } from "../components/characterIdentity";
import { PREVIEW_SNAPSHOT } from "../previewSnapshot";
import type { Snapshot } from "../types";

it("lets the body and balloon resolve an admitted NPC UUID without adding a resident alias", () => {
  const guest = {
    ...PREVIEW_SNAPSHOT.characters.installed[1]!,
    id: "admitted-npc",
    definition: {
      ...PREVIEW_SNAPSHOT.characters.installed[1]!.definition,
      presenceRole: "npc" as const,
    },
  };
  const snapshot: Snapshot = {
    ...PREVIEW_SNAPSHOT,
    characters: {
      installed: [PREVIEW_SNAPSHOT.characters.installed[0]!, guest],
      active: ["builtin-a"],
    },
    runtime: { ...PREVIEW_SNAPSHOT.runtime, guestCharacterIds: [guest.id] },
    playback: {
      id: "guest-line", persona: guest.id, expression: "기쁨", text: "반가워요",
      source: "story", motion: { mode: "inherit" }, textSpeed: 1,
      displayStartedAt: null, endsAt: 1000, lineIndex: 0, lineCount: 1,
    },
  };
  expect(personaOf(snapshot, guest.id)).toBe(guest.id);
  expect(activeCharacter(snapshot, guest.id)).toBe(guest);
  expect(currentExpression(snapshot, guest.id)).toBe("기쁨");
  expect(activeCharacter(snapshot, "a")?.id).toBe("builtin-a");
  expect(activeCharacter(snapshot, "b")).toBeUndefined();

  const exited = { ...snapshot, runtime: { ...snapshot.runtime, guestCharacterIds: [] } };
  expect(personaOf(exited, guest.id)).toBeNull();
  expect(activeCharacter(exited, guest.id)).toBeUndefined();
  expect(currentExpression(exited, guest.id)).toBe("평온");
});

it("uses available built-in or custom mood expression keys", () => {
  const base = PREVIEW_SNAPSHOT.characters.installed[0]!;
  const withExpressions = (expressions: Record<string, string>) => ({
    ...base,
    definition: { ...base.definition, expressions },
  });

  const builtIn = withExpressions({ 평온: "기본", 기쁨: "기쁨", 걱정: "걱정" });
  expect(moodExpression(builtIn, 1)).toBe("기쁨");
  expect(moodExpression(builtIn, -1)).toBe("걱정");
  expect(moodExpression(builtIn, 0)).toBe("평온");
  expect(moodExpression(withExpressions({ 슬픔: "슬픔", 졸림: "졸림" }), -1)).toBe("슬픔");
  expect(moodExpression(withExpressions({ 졸림: "졸림" }), -1)).toBe("졸림");
  expect(moodExpression(withExpressions({ happy: "Happy", tired: "Tired" }), 1)).toBe("happy");
  expect(moodExpression(withExpressions({ happy: "Happy", tired: "Tired" }), -1)).toBe("tired");
  expect(moodExpression(undefined, 1)).toBeUndefined();
});

it("uses a displayed choice's expression only for its speaker", () => {
  const snapshot: Snapshot = {
    ...PREVIEW_SNAPSHOT,
    playback: null,
    story: {
      id: "scene-choice:1", persona: "builtin-a", title: "선택", prompt: "어떻게 할까?",
      choices: [], expression: "기쁨", displayStartedAt: null,
    },
  };
  expect(currentExpression(snapshot, "builtin-a")).toBe("평온");
  const displayed = { ...snapshot, story: { ...snapshot.story!, displayStartedAt: 1 } };
  expect(currentExpression(displayed, "builtin-a")).toBe("기쁨");
  expect(currentExpression(displayed, "builtin-b")).toBe("평온");
});
