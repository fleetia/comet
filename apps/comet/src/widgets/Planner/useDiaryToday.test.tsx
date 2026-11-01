import { useState } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useDiaryToday } from "./useDiaryToday";

afterEach(() => { cleanup(); vi.useRealTimers(); });

it("follows midnight and focus, but preserves explicitly chosen days", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 8, 23, 59, 59));
  const { result } = renderHook(() => {
    const [day, setDay] = useState("2026-10-08");
    const [following, setFollowing] = useState(true);
    useDiaryToday(following, day, setDay);
    return { day, setDay, setFollowing };
  });

  act(() => vi.advanceTimersByTime(1100));
  expect(result.current.day).toBe("2026-10-09");
  act(() => { result.current.setFollowing(false); result.current.setDay("2026-10-04"); });
  act(() => { vi.setSystemTime(new Date(2026, 9, 10, 8)); window.dispatchEvent(new Event("focus")); });
  expect(result.current.day).toBe("2026-10-04");
  act(() => { result.current.setFollowing(true); result.current.setDay("2026-10-09"); });
  expect(result.current.day).toBe("2026-10-10");
});
