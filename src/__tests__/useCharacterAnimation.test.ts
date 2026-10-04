import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCharacterAnimation } from "../hooks/useCharacterAnimation";
import { PREVIEW_SNAPSHOT } from "../previewSnapshot";
import type { InstalledCharacter, Snapshot, AnimationClip, CharacterReactionRun } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (id: string) => `sprite://${id}`,
  isTauri: () => true,
}));
const loaded = vi.hoisted(() => ({ ready: true, error: null as string | null }));
const frameSets = new Map<string, HTMLCanvasElement[]>();
vi.mock("../hooks/useAnimationFrames", () => ({
  useAnimationFrames: (clip: AnimationClip | undefined) => ({
    frames: clip && loaded.ready && !loaded.error ? frameSets.get(clip.id) : null,
    ready: Boolean(clip) && loaded.ready && !loaded.error,
    error: clip ? loaded.error : null,
  }),
}));
const dispatch = vi.fn().mockResolvedValue(undefined);
const clip = (id: string): AnimationClip => ({
  id,
  name: id,
  fps: 2,
  frames: [
    { assetId: id, x: 0, y: 0, width: 8, height: 8 },
    { assetId: id, x: 8, y: 0, width: 8, height: 8 },
  ],
});
let character: InstalledCharacter;
let snapshot: Snapshot;
beforeEach(() => {
  vi.useFakeTimers();
  loaded.ready = true;
  loaded.error = null;
  dispatch.mockReset().mockResolvedValue(undefined);
  for (const id of ["idle", "talk", "click", "happy"]) {
    frameSets.set(id, [document.createElement("canvas"), document.createElement("canvas")]);
  }
  character = structuredClone(PREVIEW_SNAPSHOT.characters.installed[0]);
  character.definition.animation = {
    clips: [clip("idle"), clip("talk"), clip("click"), clip("happy")],
    bindings: {
      idle: { clipId: "idle", repeat: true, intervalMs: 0 },
      speaking: { clipId: "talk", repeat: true, intervalMs: 0 },
    },
    overrides: {
      기쁨: { speaking: { clipId: "happy", repeat: true, intervalMs: 0 } },
      슬픔: { speaking: null },
    },
  };
  snapshot = {
    ...structuredClone(PREVIEW_SNAPSHOT),
    characters: { installed: [character], active: [character.id] },
    playback: null,
    panel: null,
    story: null,
    reactions: {},
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
function talking(): Snapshot {
  return {
    ...snapshot,
    playback: {
      id: "one",
      persona: character.id,
      expression: "평온",
      text: "안녕",
      source: "script",
      endsAt: 99999,
      displayStartedAt: 1,
      lineIndex: 0,
      lineCount: 1,
      textSpeed: 0,
    },
  };
}
function reaction(id: string, event = "click"): CharacterReactionRun {
  return {
    id,
    event,
    motion: { mode: "clip", clipId: "click", repeat: event === "grab-start", intervalMs: 0 },
  };
}
function withReaction(state: Snapshot, run: CharacterReactionRun): Snapshot {
  return { ...state, reactions: { [character.id]: run } };
}
function setup(state: Snapshot, expression = "평온") {
  return renderHook(
    ({ state, expression }) =>
      useCharacterAnimation(state.characters.installed[0], state, expression, true, dispatch),
    { initialProps: { state, expression } },
  );
}
function acknowledgements(): unknown[] {
  return dispatch.mock.calls
    .filter(([name]) => name === "acknowledge_character_reaction")
    .map(([, args]) => args);
}

it("uses shown dialogue and expression overrides, preserving time across unrelated snapshots", () => {
  const notShown = talking();
  notShown.playback!.displayStartedAt = null;
  const { result, rerender } = setup(notShown, "기쁨");
  expect(result.current.frames).toBe(frameSets.get("idle"));
  rerender({ state: talking(), expression: "기쁨" });
  expect(result.current.frames).toBe(frameSets.get("happy"));
  act(() => vi.advanceTimersByTime(500));
  rerender({ state: structuredClone(talking()), expression: "기쁨" });
  expect(result.current.frameIndex).toBe(1);
  rerender({ state: talking(), expression: "슬픔" });
  expect(result.current.frameIndex).toBeNull();
  rerender({
    state: { ...talking(), panel: { persona: character.id, mode: "menu" } },
    expression: "평온",
  });
  expect(result.current.frames).toBe(frameSets.get("idle"));
  rerender({
    state: {
      ...snapshot,
      story: {
        id: "story",
        displayStartedAt: 1,
        persona: character.id,
        title: "선택",
        prompt: "골라줘",
        choices: [],
      },
    },
    expression: "평온",
  });
  expect(result.current.frames).toBe(frameSets.get("talk"));
});

it("restarts replaced host reactions, continues across menu and expression changes, then uses latest speech", () => {
  const first = reaction("first");
  const second = reaction("second");
  const { result, rerender } = setup(withReaction(talking(), first));
  expect(result.current.frames).toBe(frameSets.get("click"));
  act(() => vi.advanceTimersByTime(500));
  rerender({ state: withReaction(talking(), second), expression: "평온" });
  expect(result.current.frameIndex).toBe(0);
  act(() => vi.advanceTimersByTime(500));
  rerender({
    state: withReaction({ ...snapshot, panel: { persona: character.id, mode: "menu" } }, second),
    expression: "기쁨",
  });
  expect(result.current.frameIndex).toBe(1);
  rerender({ state: withReaction(talking(), second), expression: "기쁨" });
  act(() => vi.advanceTimersByTime(500));
  expect(result.current.frames).toBe(frameSets.get("happy"));
  expect(acknowledgements()).toEqual([
    { runId: "first", phase: "ready" },
    { runId: "second", phase: "ready" },
    { runId: "second", phase: "finished" },
  ]);
});

it("plays a per-line motion once, resumes speech and resets for a new line or static override", () => {
  const first = talking();
  first.playback!.motion = { mode: "clip", clipId: "click", repeat: false, intervalMs: 0 };
  const { result, rerender } = setup(first, "기쁨");
  expect(result.current.frames).toBe(frameSets.get("click"));
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.frames).toBe(frameSets.get("happy"));
  const second = structuredClone(first);
  second.playback!.id = "two";
  rerender({ state: second, expression: "기쁨" });
  expect(result.current.frames).toBe(frameSets.get("click"));
  expect(result.current.frameIndex).toBe(0);
  const third = structuredClone(second);
  third.playback!.id = "three";
  third.playback!.motion = { mode: "static" };
  rerender({ state: third, expression: "기쁨" });
  expect(result.current.frames).toBeNull();
  expect(result.current.frameIndex).toBeNull();
  expect(acknowledgements()).toEqual([]);
});

it("acknowledges only the current loaded run and reports a loading failure once", () => {
  loaded.ready = false;
  const { result, rerender } = setup(withReaction(snapshot, reaction("old")));
  expect(acknowledgements()).toEqual([]);
  const state = withReaction(snapshot, reaction("new"));
  rerender({ state, expression: "평온" });
  loaded.ready = true;
  rerender({ state: structuredClone(state), expression: "평온" });
  expect(acknowledgements()).toEqual([{ runId: "new", phase: "ready" }]);
  loaded.error = "프레임을 읽지 못했어요.";
  rerender({ state: structuredClone(state), expression: "평온" });
  expect(result.current.frames).toBeNull();
  expect(result.current.error).toBe(loaded.error);
  rerender({ state: structuredClone(state), expression: "기쁨" });
  expect(acknowledgements()).toEqual([
    { runId: "new", phase: "ready" },
    { runId: "new", phase: "failed" },
  ]);
});

it("keeps a static hold through snapshot updates and cancels stale completion timers", () => {
  const run = { ...reaction("static"), motion: { mode: "static" as const } };
  const state = withReaction(snapshot, run);
  const { result, rerender } = setup(state);
  expect(result.current.frames).toBeNull();
  act(() => vi.advanceTimersByTime(750));
  rerender({ state: structuredClone(state), expression: "기쁨" });
  act(() => vi.advanceTimersByTime(750));
  expect(acknowledgements()).toContainEqual({ runId: "static", phase: "finished" });
  rerender({ state: withReaction(snapshot, { ...run, id: "old" }), expression: "평온" });
  act(() => vi.advanceTimersByTime(1000));
  rerender({ state: withReaction(snapshot, { ...run, id: "new" }), expression: "평온" });
  act(() => vi.advanceTimersByTime(500));
  expect(acknowledgements()).not.toContainEqual({ runId: "old", phase: "finished" });
  expect(acknowledgements()).not.toContainEqual({ runId: "new", phase: "finished" });
  act(() => vi.advanceTimersByTime(1000));
  expect(acknowledgements()).toContainEqual({ runId: "new", phase: "finished" });
});

it("finishes an inherited reaction 1500ms after ready even when its base clip ends or snapshots change", () => {
  character.definition.animation!.clips[0].fps = 4;
  character.definition.animation!.bindings.idle!.repeat = false;
  const run = { ...reaction("inherit"), motion: { mode: "inherit" as const } };
  const state = withReaction(snapshot, run);
  const { result, rerender } = setup(state);
  expect(acknowledgements()).toEqual([{ runId: "inherit", phase: "ready" }]);
  act(() => vi.advanceTimersByTime(500));
  expect(result.current.frameIndex).toBeNull();
  act(() => vi.advanceTimersByTime(250));
  rerender({ state: structuredClone(state), expression: "평온" });
  act(() => vi.advanceTimersByTime(749));
  expect(acknowledgements()).not.toContainEqual({ runId: "inherit", phase: "finished" });
  act(() => vi.advanceTimersByTime(1));
  expect(acknowledgements()).toEqual([
    { runId: "inherit", phase: "ready" },
    { runId: "inherit", phase: "finished" },
  ]);
});

it("holds a grab loop until release then finishes the drop and resumes the latest speaking state", () => {
  const grabbing = withReaction(talking(), reaction("grab", "grab-start"));
  const { result, rerender } = setup(grabbing);
  act(() => vi.advanceTimersByTime(3500));
  expect(result.current.frameIndex).toBe(1);
  rerender({ state: structuredClone(grabbing), expression: "기쁨" });
  expect(result.current.frameIndex).toBe(1);
  expect(acknowledgements()).toEqual([{ runId: "grab", phase: "ready" }]);
  rerender({ state: withReaction(talking(), reaction("drop", "release")), expression: "기쁨" });
  expect(result.current.frameIndex).toBe(0);
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.frames).toBe(frameSets.get("happy"));
  expect(acknowledgements()).toContainEqual({ runId: "drop", phase: "finished" });
});

it("uses static timing with reduced motion and cancels completion when hidden", () => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const { result, rerender } = setup(withReaction(snapshot, reaction("reduced")));
  expect(result.current.frameIndex).toBeNull();
  expect(result.current.frames).toBeNull();
  expect(acknowledgements()).toEqual([{ runId: "reduced", phase: "ready" }]);
  act(() => vi.advanceTimersByTime(1500));
  expect(acknowledgements()).toContainEqual({ runId: "reduced", phase: "finished" });
  for (const flag of ["hidden"] as const) {
    const state = withReaction(snapshot, reaction(flag));
    rerender({ state, expression: "평온" });
    act(() => vi.advanceTimersByTime(500));
    rerender({
      state: { ...state, runtime: { ...state.runtime, [flag]: true } },
      expression: "평온",
    });
    act(() => vi.advanceTimersByTime(2000));
    expect(acknowledgements()).not.toContainEqual({ runId: flag, phase: "finished" });
  }
});

it("keeps direct reaction and shown speech animations while paused, with ambient animation stopped", () => {
  snapshot.runtime.paused = true;
  const { result, rerender } = setup(snapshot);
  expect(result.current.frames).toBeNull();
  rerender({ state: withReaction(snapshot, reaction("paused-click")), expression: "평온" });
  expect(result.current.frames).toBe(frameSets.get("click"));
  act(() => vi.advanceTimersByTime(1000));
  expect(acknowledgements()).toContainEqual({ runId: "paused-click", phase: "finished" });
  rerender({ state: talking(), expression: "평온" });
  expect(result.current.frames).toBe(frameSets.get("talk"));
  rerender({ state: snapshot, expression: "평온" });
  expect(result.current.frames).toBeNull();
});

function directReply(): Snapshot {
  return {
    ...talking(),
    panel: { persona: character.id, mode: "input" },
    conversation: {
      session: {
        id: "session",
        userId: snapshot.user!.id,
        participants: [character.id],
        status: "active",
        title: "대화",
        createdAt: 1,
        updatedAt: 1,
        draft: "",
        continuedFrom: null,
      },
      messages: [],
      nextBefore: null,
    },
  };
}

it("animates the actually displayed direct reply alongside input, including line motion overrides", () => {
  const state = directReply();
  state.playback!.source = "wordbook";
  state.playback!.motion = { mode: "clip", clipId: "click", repeat: false, intervalMs: 0 };
  const { result, rerender } = setup(state);
  expect(result.current.frames).toBe(frameSets.get("click"));
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.frames).toBe(frameSets.get("talk"));
  const staticReply = structuredClone(state);
  staticReply.playback!.id = "static-reply";
  staticReply.playback!.motion = { mode: "static" };
  rerender({ state: staticReply, expression: "평온" });
  expect(result.current.frames).toBeNull();
  const inherited = structuredClone(staticReply);
  inherited.playback!.id = "inherited-reply";
  inherited.playback!.motion = { mode: "inherit" };
  rerender({ state: inherited, expression: "기쁨" });
  expect(result.current.frames).toBe(frameSets.get("happy"));
});

it("does not speak for input alone, preparation, a retained old answer, folded conversation or another speaker", () => {
  const state = directReply();
  const { result, rerender } = setup(state);
  expect(result.current.frames).toBe(frameSets.get("talk"));
  const variants: Snapshot[] = [
    { ...state, playback: null },
    { ...state, conversation: null },
    { ...state, user: { ...state.user!, id: "next-user" } },
    { ...state, playback: { ...state.playback!, displayStartedAt: null } },
    { ...state, playback: { ...state.playback!, persona: "other-character" } },
    {
      ...state,
      conversation: {
        ...state.conversation!,
        session: { ...state.conversation!.session, status: "paused" },
      },
    },
    { ...state, panel: { persona: character.id, mode: "history" } },
    { ...state, panel: { persona: character.id, mode: "menu" } },
    { ...state, characters: { ...state.characters, active: [] } },
  ];
  for (const variant of variants) {
    rerender({ state: variant, expression: "평온" });
    expect(result.current.frames).toBe(frameSets.get("idle"));
  }
});

it("keeps sustained states opt-in and prioritizes reaction, direct speech, calendar, music, then idle", () => {
  const both = { ...snapshot, animationStates: { musicPlaying: true, calendarOpen: true } };
  const { result, rerender } = setup(both);
  expect(result.current.frames).toBe(frameSets.get("idle"));
  character.definition.animation!.bindings.musicPlaying = {
    clipId: "happy",
    repeat: true,
    intervalMs: 0,
  };
  character.definition.animation!.bindings.calendarOpen = {
    clipId: "click",
    repeat: true,
    intervalMs: 0,
  };
  rerender({ state: structuredClone(both), expression: "평온" });
  expect(result.current.frames).toBe(frameSets.get("click"));
  const speaking = { ...directReply(), animationStates: both.animationStates };
  rerender({ state: speaking, expression: "평온" });
  expect(result.current.frames).toBe(frameSets.get("talk"));
  rerender({
    state: withReaction(speaking, { ...reaction("static-priority"), motion: { mode: "static" } }),
    expression: "평온",
  });
  expect(result.current.frames).toBeNull();
  const music = { ...both, animationStates: { musicPlaying: true, calendarOpen: false } };
  rerender({ state: music, expression: "평온" });
  expect(result.current.frames).toBe(frameSets.get("happy"));
  act(() => vi.advanceTimersByTime(500));
  rerender({ state: structuredClone(music), expression: "평온" });
  expect(result.current.frameIndex).toBe(1);
  rerender({
    state: { ...both, animationStates: { musicPlaying: false, calendarOpen: false } },
    expression: "평온",
  });
  expect(result.current.frames).toBe(frameSets.get("idle"));
  rerender({ state: music, expression: "평온" });
  expect(result.current.frameIndex).toBe(0);
  for (const flag of ["hidden"] as const) {
    rerender({
      state: { ...music, runtime: { ...music.runtime, [flag]: true } },
      expression: "평온",
    });
    expect(result.current.frames).toBeNull();
    expect(result.current.frameIndex).toBeNull();
  }
});

it("does not substitute a sustained animation for unassigned speaking or explicit static speech", () => {
  character.definition.animation!.bindings.speaking = null;
  character.definition.animation!.bindings.musicPlaying = {
    clipId: "happy",
    repeat: true,
    intervalMs: 0,
  };
  const state = { ...directReply(), animationStates: { musicPlaying: true, calendarOpen: false } };
  const { result, rerender } = setup(state);
  expect(result.current.frames).toBe(frameSets.get("idle"));
  state.playback!.motion = { mode: "static" };
  rerender({ state: structuredClone(state), expression: "평온" });
  expect(result.current.frames).toBeNull();
});

function sustainedSnapshot(calendarOpen = false): Snapshot {
  character.definition.animation!.bindings.musicPlaying = {
    clipId: "happy",
    repeat: false,
    intervalMs: 0,
  };
  character.definition.animation!.bindings.calendarOpen = {
    clipId: "click",
    repeat: false,
    intervalMs: 0,
  };
  return { ...snapshot, animationStates: { musicPlaying: true, calendarOpen } };
}

it("keeps common state timing across expression changes and never replays a completed activation", () => {
  const state = sustainedSnapshot();
  const { result, rerender } = setup(state);
  const initialKey = result.current.key;
  act(() => vi.advanceTimersByTime(500));
  rerender({ state, expression: "기쁨" });
  expect(result.current.key).toBe(initialKey);
  expect(result.current.frameIndex).toBe(1);
  act(() => vi.advanceTimersByTime(500));
  expect(result.current.frameIndex).toBeNull();
  rerender({ state, expression: "평온" });
  expect(result.current.frameIndex).toBeNull();
  const speech = { ...directReply(), animationStates: state.animationStates };
  rerender({ state: speech, expression: "평온" });
  expect(result.current.frames).toBe(frameSets.get("talk"));
  rerender({ state, expression: "평온" });
  expect(result.current.frameIndex).toBeNull();
  rerender({ state: withReaction(state, reaction("after-finished")), expression: "평온" });
  expect(result.current.frames).toBe(frameSets.get("click"));
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.frameIndex).toBeNull();
  expect(acknowledgements()).toContainEqual({ runId: "after-finished", phase: "finished" });
});

it("consumes a one-shot when it begins, so speech or a reaction interruption cannot restart it", () => {
  const state = sustainedSnapshot();
  const { result, rerender } = setup(state);
  act(() => vi.advanceTimersByTime(500));
  expect(result.current.frameIndex).toBe(1);
  rerender({
    state: { ...directReply(), animationStates: state.animationStates },
    expression: "평온",
  });
  rerender({ state, expression: "평온" });
  expect(result.current.frameIndex).toBeNull();
  const off = { ...state, animationStates: { musicPlaying: false, calendarOpen: false } };
  rerender({ state: off, expression: "평온" });
  expect(result.current.frames).toBe(frameSets.get("idle"));
  rerender({ state, expression: "평온" });
  expect(result.current.frames).toBe(frameSets.get("happy"));
  expect(result.current.frameIndex).toBe(0);
  act(() => vi.advanceTimersByTime(250));
  rerender({ state: withReaction(state, reaction("interrupt")), expression: "평온" });
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.frameIndex).toBeNull();
  rerender({ state, expression: "기쁨" });
  expect(result.current.frameIndex).toBeNull();
});

it("tracks calendar and music activations independently while higher-priority conditions mask them", () => {
  const both = sustainedSnapshot(true);
  const { result, rerender } = setup(both);
  expect(result.current.frames).toBe(frameSets.get("click"));
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.frameIndex).toBeNull();
  const music = { ...both, animationStates: { musicPlaying: true, calendarOpen: false } };
  rerender({ state: music, expression: "평온" });
  // Music has been true throughout, but had never started behind calendar.
  expect(result.current.frames).toBe(frameSets.get("happy"));
  expect(result.current.frameIndex).toBe(0);
  act(() => vi.advanceTimersByTime(500));
  rerender({ state: both, expression: "평온" });
  expect(result.current.frames).toBe(frameSets.get("click"));
  expect(result.current.frameIndex).toBe(0);
  rerender({ state: music, expression: "평온" });
  expect(result.current.frameIndex).toBeNull();
  rerender({ state: both, expression: "평온" });
  const musicOff = { ...both, animationStates: { musicPlaying: false, calendarOpen: true } };
  rerender({ state: musicOff, expression: "평온" });
  act(() => vi.advanceTimersByTime(500));
  rerender({ state: both, expression: "기쁨" });
  expect(result.current.frameIndex).toBe(1); // A music epoch must not restart calendar.
  rerender({ state: music, expression: "평온" });
  expect(result.current.frames).toBe(frameSets.get("happy"));
  expect(result.current.frameIndex).toBe(0);
});

it("does not consume a one-shot before frames load and resets on hidden or changed definition", () => {
  const state = sustainedSnapshot();
  loaded.ready = false;
  const { result, rerender } = setup(state);
  rerender({
    state: { ...directReply(), animationStates: state.animationStates },
    expression: "평온",
  });
  loaded.ready = true;
  rerender({ state, expression: "평온" });
  expect(result.current.frames).toBe(frameSets.get("happy"));
  expect(result.current.frameIndex).toBe(0);
  act(() => vi.advanceTimersByTime(1000));
  rerender({
    state: { ...state, runtime: { ...state.runtime, hidden: true } },
    expression: "평온",
  });
  rerender({ state, expression: "평온" });
  expect(result.current.frameIndex).toBe(0);
  act(() => vi.advanceTimersByTime(1000));
  const changed = structuredClone(state);
  changed.characters.installed[0].definition.name = "새 정의";
  rerender({ state: changed, expression: "평온" });
  expect(result.current.frameIndex).toBe(0);
});
