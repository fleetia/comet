import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useTypewriter } from "../hooks/useTypewriter";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("starts only after sizing, reveals whole graphemes at the requested speed and preserves newlines", () => {
  vi.useFakeTimers();
  const text = "한👩‍💻\n글";
  const { result, rerender } = renderHook(({ ready }) => useTypewriter("one", text, 2, ready), {
    initialProps: { ready: false },
  });
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current).toBe("");
  rerender({ ready: true });
  act(() => vi.advanceTimersByTime(32));
  expect(result.current).toBe("한");
  act(() => vi.advanceTimersByTime(500));
  expect(result.current).toBe("한👩‍💻");
  act(() => vi.advanceTimersByTime(1000));
  expect(result.current).toBe(text);
});

it("cancels old lines and reveals instant speed without a timer", () => {
  vi.useFakeTimers();
  const { result, rerender, unmount } = renderHook(
    ({ id, text, speed }) => useTypewriter(id, text, speed, true),
    {
      initialProps: { id: "one", text: "이전 대사는 취소", speed: 1 },
    },
  );
  act(() => vi.advanceTimersByTime(1100));
  expect(result.current).toBe("이전");
  rerender({ id: "two", text: "새 대사", speed: 1 });
  expect(result.current).toBe("");
  act(() => vi.advanceTimersByTime(32));
  expect(result.current).toBe("새");
  rerender({ id: "three", text: "바로 표시", speed: 0 });
  expect(result.current).toBe("바로 표시");
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
