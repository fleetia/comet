import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AnimationBinding,
  Dispatch,
  InstalledCharacter,
  MotionOverride,
  Snapshot,
} from "../types";
import { animationAssetUrl, animationBinding } from "../components/characterAnimation";
import { activeCharacter, DEFAULT_EXPRESSION, moodExpression } from "../components/characterIdentity";
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

const SUSTAINED_STATES = [
  "sleep", "focus", "rest", "calendarOpen", "musicPlaying", "moodHigh", "moodLow",
] as const;
type SustainedState = (typeof SUSTAINED_STATES)[number];
type SustainedRuns = {
  definitionKey: string;
  current: string | null;
  states: Record<SustainedState, { active: boolean; generation: number; consumed: boolean }>;
};

function nextSustainedRuns(
  previous: SustainedRuns | undefined,
  definitionKey: string,
  conditions: Partial<Record<SustainedState, boolean>>,
): SustainedRuns {
  const sameDefinition = previous?.definitionKey === definitionKey;
  return {
    definitionKey,
    current: sameDefinition ? previous.current : null,
    states: Object.fromEntries(
      SUSTAINED_STATES.map((state) => {
        const active = Boolean(conditions?.[state]);
        const old = sameDefinition ? previous.states[state] : undefined;
        return [
          state,
          {
            active,
            generation: (old?.generation ?? 0) + Number(active && !old?.active),
            consumed: old?.active === active ? old.consumed : false,
          },
        ];
      }),
    ) as SustainedRuns["states"],
  };
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
  expression: string;
} {
  const reduced = useReducedMotion();
  const animation = character?.definition.animation;
  const available = enabled && !snapshot.runtime.hidden;
  const definitionKey = JSON.stringify([character?.id, character?.definition, available]);
  const conditions = {
    sleep: Boolean(
      character && snapshot.animationStates?.sleepingCharacterIds?.includes(character.id),
    ),
    focus: Boolean(snapshot.animationStates?.focus),
    rest: Boolean(snapshot.animationStates?.rest),
    calendarOpen: Boolean(snapshot.animationStates?.calendarOpen),
    musicPlaying: Boolean(snapshot.animationStates?.musicPlaying),
    moodHigh: Boolean(
      character && snapshot.animationStates?.moodHighCharacterIds?.includes(character.id),
    ),
    moodLow: Boolean(
      character && snapshot.animationStates?.moodLowCharacterIds?.includes(character.id),
    ),
  };
  const [storedRuns, setSustainedRuns] = useState(() =>
    nextSustainedRuns(undefined, definitionKey, conditions),
  );
  let sustainedRuns = storedRuns;
  if (
    storedRuns.definitionKey !== definitionKey ||
    SUSTAINED_STATES.some((state) => storedRuns.states[state].active !== conditions[state])
  ) {
    // Reconcile condition epochs before rendering, even while speech or another state owns the body.
    sustainedRuns = nextSustainedRuns(storedRuns, definitionKey, conditions);
    setSustainedRuns(sustainedRuns);
  }
  const reaction = available ? snapshot.reactions?.[character?.id ?? ""] : undefined;
  const [finishedLine, setFinishedLine] = useState("");
  const [finishedReaction, setFinishedReaction] = useState("");
  const activeReaction = reaction?.id !== finishedReaction ? reaction : undefined;
  const playback = snapshot.playback;
  const speakingLine =
    (!snapshot.panel ||
      (snapshot.panel.mode === "input" &&
        snapshot.conversation?.session.status === "active" &&
        snapshot.conversation.session.userId === snapshot.user?.id)) &&
    (!snapshot.story || snapshot.panel?.mode === "input") &&
    playback?.displayStartedAt != null &&
    activeCharacter(snapshot, playback.persona)?.id === character?.id;
  const speakingStory =
    !snapshot.panel &&
    snapshot.story?.displayStartedAt != null &&
    activeCharacter(snapshot, snapshot.story.persona)?.id === character?.id;
  const speaking = Boolean(speakingLine || speakingStory);
  const running =
    available && !reduced && (!snapshot.runtime.paused || speaking || Boolean(activeReaction));
  const lineKey = JSON.stringify([definitionKey, playback?.id]);
  const lineMotion = speakingLine && finishedLine !== lineKey ? playback?.motion : undefined;
  const motion = activeReaction ? activeReaction.motion : lineMotion;
  let binding = motionBinding(motion);
  const explicit = binding !== undefined;
  let trigger = activeReaction ? `reaction:${activeReaction.id}` : "idle";
  let sustainedState: SustainedState | undefined;
  let sustainedKey: string | null = null;
  if (binding === undefined && speaking)
    binding = animationBinding(animation, expression, "speaking");
  if (binding === undefined && !speaking && !activeReaction && !snapshot.runtime.paused) {
    // Only opt-in bindings participate; an unassigned higher-priority state falls through.
    for (const state of SUSTAINED_STATES) {
      if (
        conditions[state] &&
        (animation?.bindings[state] || ["sleep", "focus", "rest"].includes(state))
      ) {
        const run = sustainedRuns.states[state];
        sustainedState = state;
        sustainedKey = `state:${state}:${run.generation}`;
        binding = animation?.bindings[state] ?? null;
        // A one-shot keeps ownership as a static pose after completion or preemption.
        if (binding && !binding.repeat && run.consumed && sustainedRuns.current !== sustainedKey)
          binding = null;
        trigger = sustainedKey;
        break;
      }
    }
  }
  const idleExpression =
    available &&
    !speaking &&
    !reaction &&
    (conditions.moodHigh || conditions.moodLow) &&
    (!sustainedState || sustainedState === "moodHigh" || sustainedState === "moodLow")
      ? moodExpression(character, conditions.moodHigh ? 1 : -1) ?? DEFAULT_EXPRESSION
      : expression;
  if (binding === undefined) binding = animationBinding(animation, idleExpression, "idle");
  if (!activeReaction && speaking)
    trigger = `speaking:${speakingLine ? playback?.id : snapshot.story?.id}`;
  const clip = animation?.clips.find((value) => value.id === binding?.clipId);
  const key = JSON.stringify([
    definitionKey,
    activeReaction || sustainedState ? null : idleExpression,
    trigger,
    activeReaction?.phaseGeneration,
    activeReaction?.definitionRevision,
    binding,
  ]);
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
    const started = sustainedState && running && clip && (loaded.ready || loaded.error);
    setSustainedRuns((previous) => {
      if (previous.definitionKey !== definitionKey) return previous;
      if (!started || !sustainedState) {
        return previous.current === null ? previous : { ...previous, current: null };
      }
      const run = previous.states[sustainedState];
      if (!run.active || `state:${sustainedState}:${run.generation}` !== sustainedKey)
        return previous;
      const consumed = run.consumed || !binding?.repeat;
      if (previous.current === sustainedKey && run.consumed === consumed) return previous;
      return {
        ...previous,
        current: sustainedKey,
        states: { ...previous.states, [sustainedState]: { ...run, consumed } },
      };
    });
  }, [
    definitionKey,
    sustainedState,
    sustainedKey,
    running,
    clip?.id,
    binding?.repeat,
    loaded.ready,
    loaded.error,
  ]);

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
    const phaseKey = JSON.stringify([
      activeReaction.id,
      activeReaction.phaseGeneration,
      activeReaction.definitionRevision,
    ]);
    if (acknowledgement.current.id !== phaseKey)
      acknowledgement.current = {
        id: phaseKey,
        ready: false,
        readyAt: 0,
        finished: false,
      };
    const ack = acknowledgement.current;
    const send = (phase: "ready" | "finished" | "failed"): void => {
      void dispatch("acknowledge_character_reaction", {
        runId: activeReaction.id,
        phase,
        ...(activeReaction.phaseGeneration === undefined
          ? {}
          : { phaseGeneration: activeReaction.phaseGeneration }),
        ...(activeReaction.definitionRevision === undefined
          ? {}
          : { definitionRevision: activeReaction.definitionRevision }),
      }).catch(() => undefined);
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
      if (!activeReaction.phaseGeneration && activeReaction.event !== "grab-start")
        setFinishedReaction(activeReaction.id);
      send("finished");
    };
    if (activeReaction.phase === "hold") return;
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
    activeReaction?.phase,
    activeReaction?.phaseGeneration,
    activeReaction?.definitionRevision,
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
    expression: idleExpression,
  };
}
