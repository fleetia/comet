import { expect, it } from "vitest";
import { activeCharacter, currentExpression, personaOf } from "../components/characterIdentity";
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
