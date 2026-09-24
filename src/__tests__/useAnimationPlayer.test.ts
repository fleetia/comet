import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useAnimationPlayer } from "../hooks/useAnimationPlayer";
import type { AnimationClip } from "../types";

const clip: AnimationClip = {
  id: "blink",
  name: "깜빡",
  fps: 2,
  frames: [
    { assetId: "a", x: 0, y: 0, width: 8, height: 8 },
    { assetId: "b", x: 0, y: 0, width: 8, height: 8 },
  ],
};
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("waits for decoded frames, plays once at independent fps, and finishes", () => {
  vi.useFakeTimers();
  const { result, rerender } = renderHook(
    ({ ready }) =>
      useAnimationPlayer({
        clip,
        binding: { repeat: false, intervalMs: 0 },
        runKey: "one",
        enabled: true,
        ready,
      }),
    { initialProps: { ready: false } },
  );
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.frameIndex).toBeNull();
  rerender({ ready: true });
  expect(result.current.frameIndex).toBe(0);
  act(() => vi.advanceTimersByTime(500));
  expect(result.current.frameIndex).toBe(1);
  act(() => vi.advanceTimersByTime(500));
  expect(result.current).toMatchObject({ frameIndex: null, finished: true });
  expect(vi.getTimerCount()).toBe(0);
});

it("shows the static fallback in repeat gaps and does not restart on equal data", () => {
  vi.useFakeTimers();
  const { result, rerender, unmount } = renderHook(
    ({ runKey, enabled }) =>
      useAnimationPlayer({
        clip: structuredClone(clip),
        binding: { repeat: true, intervalMs: 1000 },
        runKey,
        enabled,
        ready: true,
      }),
    { initialProps: { runKey: "one", enabled: true } },
  );
  act(() => vi.advanceTimersByTime(500));
  rerender({ runKey: "one", enabled: true });
  expect(result.current.frameIndex).toBe(1);
  act(() => vi.advanceTimersByTime(500));
  expect(result.current.frameIndex).toBeNull();
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current.frameIndex).toBe(0);
  rerender({ runKey: "one", enabled: false });
  expect(result.current.frameIndex).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
  rerender({ runKey: "two", enabled: true });
  expect(result.current.frameIndex).toBe(0);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
