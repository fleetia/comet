import { useEffect, useMemo, useState } from "react";
import type { AnimationBinding, InstalledCharacter, Snapshot } from "../types";
import { animationAssetUrl, animationBinding } from "../components/characterAnimation";
import { activeCharacter } from "../components/characterIdentity";
import { useAnimationFrames } from "./useAnimationFrames";
import { useAnimationPlayer } from "./useAnimationPlayer";

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = (): void => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

export function useCharacterAnimation(
  character: InstalledCharacter | undefined,
  snapshot: Snapshot,
  expression: string,
  enabled: boolean,
): {
  frames: HTMLCanvasElement[] | null;
  frameIndex: number | null;
  key: string;
  cacheKey: string;
  click: () => void;
  hasAnimation: boolean;
  error: string | null;
} {
  const reduced = useReducedMotion();
  const animation = character?.definition.animation;
  const running = enabled && !reduced && !snapshot.runtime.hidden && !snapshot.runtime.paused;
  const definitionKey = JSON.stringify([character?.id, character?.definition, running]);
  const [click, setClick] = useState({ key: "", sequence: 0 });
  const [completedClick, setCompletedClick] = useState(0);
  useEffect(() => {
    setClick((previous) => ({ key: "", sequence: previous.sequence }));
  }, [definitionKey]);
  const clicking =
    click.key === definitionKey &&
    click.sequence > completedClick &&
    Boolean(animation?.bindings.click);
  const playback = snapshot.playback;
  const speakingLine =
    !snapshot.panel &&
    !snapshot.story &&
    playback?.displayStartedAt != null &&
    activeCharacter(snapshot, playback.persona)?.id === character?.id;
  const speakingStory =
    !snapshot.panel &&
    snapshot.story?.displayStartedAt != null &&
    activeCharacter(snapshot, snapshot.story.persona)?.id === character?.id;
  const speaking = Boolean(speakingLine || speakingStory);
  let binding: AnimationBinding | null | undefined;
  let trigger: string = "idle";
  if (clicking) {
    binding = animation?.bindings.click;
    trigger = `click:${click.sequence}`;
  } else if (speaking) {
    binding = animationBinding(animation, expression, "speaking");
    trigger = `speaking:${speakingLine ? playback?.id : snapshot.story?.id}`;
  }
  if (binding === undefined) binding = animationBinding(animation, expression, "idle");
  const clip = animation?.clips.find((value) => value.id === binding?.clipId);
  const key = JSON.stringify([definitionKey, clicking ? null : expression, trigger, binding]);
  const sources = useMemo(
    () =>
      Object.fromEntries(
        (clip?.frames ?? []).map((frame) => [
          frame.assetId,
          animationAssetUrl(character?.id ?? "", frame.assetId),
        ]),
      ),
    [clip?.frames, character?.id],
  );
  const loaded = useAnimationFrames(
    running ? clip : undefined,
    sources,
    character?.definition.spriteSize ?? 64,
  );
  const progress = useAnimationPlayer({
    clip,
    binding: binding ?? undefined,
    runKey: key,
    enabled: running,
    ready: loaded.ready,
  });
  useEffect(() => {
    if (clicking && (progress.finished || loaded.error)) setCompletedClick(click.sequence);
  }, [clicking, click.sequence, progress.finished, loaded.error]);
  return {
    frames: loaded.frames,
    frameIndex: running ? progress.frameIndex : null,
    key,
    cacheKey: JSON.stringify([clip?.frames, character?.definition.spriteSize]),
    hasAnimation: Boolean(animation?.clips.length),
    error: loaded.error,
    click: () => {
      if (running && animation?.bindings.click)
        setClick((previous) => ({ key: definitionKey, sequence: previous.sequence + 1 }));
    },
  };
}
