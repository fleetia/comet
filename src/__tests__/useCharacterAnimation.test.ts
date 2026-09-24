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

it("uses static timing with reduced motion and cancels completion when hidden or paused", () => {
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
  for (const flag of ["hidden", "paused"] as const) {
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
