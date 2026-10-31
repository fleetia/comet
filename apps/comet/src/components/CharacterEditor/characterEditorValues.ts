import type { AnimationAsset, InstalledCharacter } from "../../types";
import { DEFAULT_EXPRESSION } from "../characterIdentity";
import { DEFAULT_BALLOON_STYLE } from "../balloonTypography";
import { animationError, gestureDefinitionError } from "../AnimationEditor/helpers";
import { motionError } from "../MotionSelect/MotionSelect";
import { reactionError } from "../ReactionEditor/reactionValidation";
import type { CharacterEditorProps } from "./CharacterEditor.types";

export const MAX_RELATIONSHIPS = 32;

type CharacterEditorValues = {
  expressionKeys: string[];
  relationshipTargets: InstalledCharacter[];
  trialActors: InstalledCharacter[];
  nextTarget: InstalledCharacter | undefined;
  validRelationships: boolean;
  validBalloonStyle: boolean;
  dialogueError: string | null | undefined;
  valid: boolean;
};

export function getCharacterEditorValues({
  definition,
  character,
  installed,
  presentIds,
  animationAssets,
  reactionTarget,
}: Pick<CharacterEditorProps, "definition" | "character" | "presentIds"> & {
  installed: InstalledCharacter[];
  animationAssets: AnimationAsset[];
  reactionTarget?: string | null;
}): CharacterEditorValues {
  const expressionKeys = Object.keys(definition.expressions);
  const relationshipTargets = installed.filter((candidate) => candidate.id !== character?.id);
  const trialMembers = character
    ? installed
        .filter(
          (member) =>
            member.id === character.id ||
            (character.packId !== null && member.packId === character.packId),
        )
        .map((member) => (member.id === character.id ? { ...member, definition } : member))
    : [];
  if (character && !trialMembers.some((member) => member.id === character.id)) {
    trialMembers.push({ ...character, definition });
  }
  const trialCenter = installed.find(
    (member) => member.definition.presenceRole !== "npc" && presentIds?.includes(member.id),
  );
  const trialActors =
    trialMembers.some((member) => member.definition.presenceRole !== "npc") || !trialCenter
      ? trialMembers
      : [...trialMembers, trialCenter];
  const availableTargets = relationshipTargets.filter(
    (candidate) => !definition.relationships.some(({ targetId }) => targetId === candidate.id),
  );
  const nextTarget =
    availableTargets.find((candidate) => candidate.id === reactionTarget) ?? availableTargets[0];
  const validRelationships =
    definition.relationships.length <= MAX_RELATIONSHIPS &&
    new Set(definition.relationships.map(({ targetId }) => targetId)).size ===
      definition.relationships.length &&
    definition.relationships.every(
      ({ targetId, description }) =>
        targetId !== character?.id &&
        (relationshipTargets.some((target) => target.id === targetId) ||
          character?.definition.relationships.some((saved) => saved.targetId === targetId)) &&
        Boolean(description.trim()) &&
        Array.from(description).length <= 500,
    );
  const balloonStyle = definition.balloonStyle ?? DEFAULT_BALLOON_STYLE;
  const textSpeed = balloonStyle.textSpeed ?? 0;
  const validBalloonStyle =
    Number.isInteger(balloonStyle.fontSize) &&
    balloonStyle.fontSize >= 12 &&
    balloonStyle.fontSize <= 40 &&
    Number.isInteger(textSpeed) &&
    textSpeed >= 0 &&
    textSpeed <= 100 &&
    Array.from(balloonStyle.fontFamily).length <= 100 &&
    (balloonStyle.textColor === null || /^#[0-9a-f]{6}$/i.test(balloonStyle.textColor));
  const dialogueError =
    gestureDefinitionError(definition) ??
    reactionError(definition) ??
    [
      ...definition.greeting,
      ...definition.idleLines,
      ...definition.departureLines,
      ...definition.returnLines,
      ...(definition.npc?.entryLines ?? []),
      ...definition.relationships.flatMap((relationship) => relationship.replyLines ?? []),
    ]
      .map((line) => motionError(line.motion, definition.animation?.clips ?? []))
      .find(Boolean);
  const valid =
    Boolean(definition.name.trim()) &&
    Array.from(definition.instructions).length <= 2000 &&
    validRelationships &&
    [
      definition.npc?.entryLines ?? [],
      ...definition.relationships.map((relationship) => relationship.replyLines ?? []),
    ].every(
      (lines) =>
        lines.length <= 8 &&
        lines.every(
          (line) =>
            Boolean(line.text.trim()) &&
            Array.from(line.text).length <= 500 &&
            expressionKeys.includes(line.expression),
        ),
    ) &&
    validBalloonStyle &&
    !dialogueError &&
    !animationError(definition.animation, {
      ...character?.animationAssets,
      ...Object.fromEntries(animationAssets.map((asset) => [asset.assetId, asset])),
    }) &&
    DEFAULT_EXPRESSION in definition.expressions &&
    Number.isInteger(definition.spriteSize) &&
    definition.spriteSize >= 32 &&
    definition.spriteSize <= 512 &&
    expressionKeys.every((key) => definition.expressions[key]?.trim()) &&
    [
      definition.greeting,
      definition.idleLines,
      definition.departureLines,
      definition.returnLines,
    ].every((lines) => lines.length > 0 && lines.every((line) => line.text.trim())) &&
    definition.departureLines.length <= 8 &&
    definition.returnLines.length <= 8;
  return {
    expressionKeys,
    relationshipTargets,
    trialActors,
    nextTarget,
    validRelationships,
    validBalloonStyle,
    dialogueError,
    valid,
  };
}

export function relationshipTargetName(
  target: InstalledCharacter,
  installed: InstalledCharacter[],
): string {
  const sameName = installed.filter(
    (candidate) => candidate.definition.name === target.definition.name,
  );
  if (sameName.length < 2) {
    return target.definition.name;
  }
  const suffix = target.id.slice(-8);
  const hasSharedSuffix = sameName.some(
    (candidate) => candidate.id !== target.id && candidate.id.endsWith(suffix),
  );
  return `${target.definition.name} · ${hasSharedSuffix ? target.id : suffix}`;
}

export function entries(value: string): string[] {
  return value === "" ? [] : value.split("\n");
}
