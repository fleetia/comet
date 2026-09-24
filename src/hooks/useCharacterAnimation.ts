import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AnimationBinding,
  Dispatch,
  InstalledCharacter,
  MotionOverride,
  Snapshot,
} from "../types";
import { animationAssetUrl, animationBinding } from "../components/characterAnimation";
import { activeCharacter } from "../components/characterIdentity";
import { command } from "./useSnapshot";
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

function motionBinding(motion: MotionOverride | undefined): AnimationBinding | null | undefined {
  if (motion?.mode === "static") return null;
  if (motion?.mode === "clip") return motion;
  return undefined;
}

export function useCharacterAnimation(
  character: InstalledCharacter | undefined,
  snapshot: Snapshot,
  expression: string,
  enabled: boolean,
  dispatch: Dispatch = command,
): {
  frames: HTMLCanvasElement[] | null;
  frameIndex: number | null;
  key: string;
  cacheKey: string;
  hasAnimation: boolean;
  error: string | null;
} {
  const reduced = useReducedMotion();
  const animation = character?.definition.animation;
  const available = enabled && !snapshot.runtime.hidden && !snapshot.runtime.paused;
  const running = available && !reduced;
  const definitionKey = JSON.stringify([character?.id, character?.definition, available]);
  const reaction = available ? snapshot.reactions?.[character?.id ?? ""] : undefined;
  const [finishedLine, setFinishedLine] = useState("");
  const [finishedReaction, setFinishedReaction] = useState("");
  const activeReaction = reaction?.id !== finishedReaction ? reaction : undefined;
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
  const lineKey = JSON.stringify([definitionKey, playback?.id]);
  const lineMotion = speakingLine && finishedLine !== lineKey ? playback?.motion : undefined;
  const motion = activeReaction ? activeReaction.motion : lineMotion;
  let binding = motionBinding(motion);
  const explicit = binding !== undefined;
  let trigger = activeReaction ? `reaction:${activeReaction.id}` : "idle";
  if (binding === undefined && speaking)
    binding = animationBinding(animation, expression, "speaking");
  if (binding === undefined) binding = animationBinding(animation, expression, "idle");
  if (!activeReaction && speaking)
    trigger = `speaking:${speakingLine ? playback?.id : snapshot.story?.id}`;
  const clip = animation?.clips.find((value) => value.id === binding?.clipId);
  const key = JSON.stringify([definitionKey, activeReaction ? null : expression, trigger, binding]);
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
    if (
      !activeReaction &&
      explicit &&
      lineMotion?.mode === "clip" &&
      (progress.finished || loaded.error)
    )
      setFinishedLine(lineKey);
  }, [activeReaction, explicit, lineMotion?.mode, progress.finished, loaded.error, lineKey]);

  const acknowledgement = useRef({ id: "", ready: false, readyAt: 0, finished: false });
  useEffect(() => {
    if (!activeReaction) return;
    if (acknowledgement.current.id !== activeReaction.id)
      acknowledgement.current = {
        id: activeReaction.id,
        ready: false,
        readyAt: 0,
        finished: false,
      };
    const ack = acknowledgement.current;
    const send = (phase: "ready" | "finished" | "failed"): void => {
      void dispatch("acknowledge_character_reaction", { runId: activeReaction.id, phase }).catch(
        () => undefined,
      );
    };
    if (loaded.error) {
      if (!ack.finished) {
        ack.finished = true;
        send("failed");
      }
      return;
    }
    if (running && clip && !loaded.ready) return;
    if (!ack.ready) {
      ack.ready = true;
      ack.readyAt = performance.now();
      send("ready");
    }
    const finish = (): void => {
      if (ack.finished) return;
      ack.finished = true;
      if (activeReaction.event !== "grab-start") setFinishedReaction(activeReaction.id);
      send("finished");
    };
    if (motion?.mode === "clip" && running && clip) {
      if (progress.finished) finish();
      return;
    }
    // Static, reduced-motion and inherited one-shot reactions retain their expression briefly.
    if (activeReaction.event === "grab-start") return;
    const timer = window.setTimeout(finish, Math.max(0, ack.readyAt + 1500 - performance.now()));
    return () => window.clearTimeout(timer);
  }, [
    activeReaction?.id,
    activeReaction?.event,
    motion?.mode,
    clip?.id,
    running,
    loaded.ready,
    loaded.error,
    progress.finished,
    dispatch,
  ]);
  return {
    frames: loaded.frames,
    frameIndex: running ? progress.frameIndex : null,
    key,
    cacheKey: JSON.stringify([clip?.frames, character?.definition.spriteSize]),
    hasAnimation: Boolean(animation?.clips.length),
    error: loaded.error,
  };
}
