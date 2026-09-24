import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCharacterAnimation } from "../hooks/useCharacterAnimation";
import { PREVIEW_SNAPSHOT } from "../previewSnapshot";
import type { InstalledCharacter, Snapshot, AnimationClip } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (id: string) => `sprite://${id}`,
  isTauri: () => true,
}));
vi.mock("../hooks/useAnimationFrames", () => ({
  useAnimationFrames: (clip: AnimationClip | undefined) => ({
    frames: clip ? [] : null,
    ready: Boolean(clip),
    error: null,
  }),
}));
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
  character = structuredClone(PREVIEW_SNAPSHOT.characters.installed[0]);
  character.definition.animation = {
    clips: [clip("idle"), clip("talk"), clip("click"), clip("happy")],
    bindings: {
      idle: { clipId: "idle", repeat: true, intervalMs: 0 },
      speaking: { clipId: "talk", repeat: true, intervalMs: 0 },
      click: { clipId: "click", repeat: false, intervalMs: 0 },
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

it("keeps talking animation through instant text, applies expression overrides and excludes panels", () => {
  const { result, rerender } = renderHook(
    ({ state, expression }) => useCharacterAnimation(character, state, expression, true),
    { initialProps: { state: talking(), expression: "기쁨" } },
  );
  expect(result.current.key).toContain("happy");
  act(() => vi.advanceTimersByTime(500));
  rerender({ state: structuredClone(talking()), expression: "기쁨" });
  expect(result.current.frameIndex).toBe(1);
  rerender({ state: talking(), expression: "슬픔" });
  expect(result.current.frameIndex).toBeNull();
  rerender({
    state: { ...talking(), panel: { persona: character.id, mode: "menu" } },
    expression: "평온",
  });
  expect(result.current.key).toContain('"idle"');
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
  expect(result.current.key).toContain("speaking:story");
});

it("restarts clicks without queuing, returns to latest state, cancels on hide and definition change", () => {
  const { result, rerender } = renderHook(
    ({ state, person }) => useCharacterAnimation(person, state, "평온", true),
    { initialProps: { state: talking(), person: character } },
  );
  act(() => result.current.click());
  expect(result.current.key).toContain("click:1");
  act(() => vi.advanceTimersByTime(500));
  act(() => result.current.click());
  expect(result.current.frameIndex).toBe(0);
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.key).toContain("speaking:one");
  act(() => result.current.click());
  rerender({
    state: { ...snapshot, runtime: { ...snapshot.runtime, hidden: true } },
    person: character,
  });
  expect(result.current.frameIndex).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  rerender({ state: snapshot, person: character });
  expect(result.current.key).not.toContain("click:");
  act(() => result.current.click());
  rerender({
    state: snapshot,
    person: { ...character, definition: { ...character.definition, name: "바뀐 이름" } },
  });
  expect(result.current.key).not.toContain("click:");
});

it("does not start before display or while paused, and respects reduced motion", () => {
  const state = talking();
  state.playback!.displayStartedAt = null;
  const { result, rerender } = renderHook(
    ({ state }) => useCharacterAnimation(character, state, "평온", true),
    { initialProps: { state } },
  );
  expect(result.current.key).not.toContain("speaking:");
  rerender({ state: { ...talking(), runtime: { ...snapshot.runtime, paused: true } } });
  expect(result.current.frameIndex).toBeNull();
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  const reduced = renderHook(() => useCharacterAnimation(character, talking(), "평온", true));
  act(() => reduced.result.current.click());
  expect(reduced.result.current.frameIndex).toBeNull();
});

it("finishes a click without restarting when the menu interrupts speech and changes expression", () => {
  const { result, rerender } = renderHook(
    ({ state, expression }) => useCharacterAnimation(character, state, expression, true),
    { initialProps: { state: talking(), expression: "기쁨" } },
  );
  act(() => result.current.click());
  act(() => vi.advanceTimersByTime(500));
  expect(result.current.frameIndex).toBe(1);
  const clickKey = result.current.key;

  // Opening the native menu interrupts playback and resets the displayed expression.
  rerender({
    state: { ...snapshot, panel: { persona: character.id, mode: "menu" } },
    expression: "평온",
  });
  expect(result.current.key).toBe(clickKey);
  expect(result.current.frameIndex).toBe(1);
  act(() => vi.advanceTimersByTime(499));
  expect(result.current.key).toBe(clickKey);
  act(() => vi.advanceTimersByTime(1));
  expect(result.current.key).not.toContain("click:");
  expect(result.current.key).toContain('"idle"');
  expect(result.current.key).not.toContain("speaking:");
  expect(result.current.frameIndex).toBe(0);
});
