import type { InstalledCharacter, Persona, Snapshot } from "../types";
export function activeCharacter(
  snapshot: Snapshot,
  persona: Persona,
): InstalledCharacter | undefined {
  const id = snapshot.characters.active[persona === "a" ? 0 : 1];
  return snapshot.characters.installed.find((character) => character.id === id);
}
export function characterName(snapshot: Snapshot, persona: Persona): string {
  return activeCharacter(snapshot, persona)?.definition.name ?? persona.toUpperCase();
}
