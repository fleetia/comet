import { convertFileSrc } from "@tauri-apps/api/core";
import { isDesktop } from "../hooks/useSnapshot";
import type { InstalledCharacter, Persona, Snapshot } from "../types";

export const DEFAULT_EXPRESSION = "평온";
export const BALLOON_SPRITE = "$balloon";

export type Slice = { top: number; right: number; bottom: number; left: number };
// Nine-slice cut that keeps exactly the centre 1px row and column stretchable.
export function centerSlice(width: number, height: number): Slice {
  const top = Math.max(0, Math.floor((height - 1) / 2));
  const left = Math.max(0, Math.floor((width - 1) / 2));
  return { top, right: Math.max(0, width - 1 - left), bottom: Math.max(0, height - 1 - top), left };
}

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
export function currentExpression(snapshot: Snapshot, persona: Persona): string {
  return snapshot.playback?.persona === persona ? snapshot.playback.expression : DEFAULT_EXPRESSION;
}
export function resolveExpression(
  character: InstalledCharacter | undefined,
  expression: string,
): string {
  return character && expression in character.definition.expressions
    ? expression
    : DEFAULT_EXPRESSION;
}
export function expressionLabel(
  character: InstalledCharacter | undefined,
  expression: string,
): string {
  const key = resolveExpression(character, expression);
  return character?.definition.expressions[key] ?? key;
}
export function spriteUrl(
  character: InstalledCharacter | undefined,
  expression: string,
): string | null {
  const sprite = character?.sprites[expression];
  if (!character || !sprite || !isDesktop()) return null;
  const query = new URLSearchParams({ expression, v: String(sprite.updatedAt) });
  return `${convertFileSrc(character.id, "sprite")}?${query}`;
}
export function spriteSource(
  character: InstalledCharacter | undefined,
  expression: string,
): string | null {
  return (
    spriteUrl(character, resolveExpression(character, expression)) ??
    spriteUrl(character, DEFAULT_EXPRESSION)
  );
}
