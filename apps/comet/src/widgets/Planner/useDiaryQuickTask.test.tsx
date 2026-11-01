import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useDiaryQuickTask } from "./useDiaryQuickTask";

beforeEach(() => localStorage.clear());

it("restores the title and its original date after remount, and clears them only after saving", async () => {
  const createTask = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce("task");
  const pending = { current: false };
  const props = { defaultDate: "2026-10-31", saving: false, pending, createTask };
  const first = renderHook(() => useDiaryQuickTask(props));
  act(() => {
    first.result.current.show();
    first.result.current.change("이어 쓸 일");
  });
  first.unmount();
  const restored = renderHook(() => useDiaryQuickTask({ ...props, defaultDate: "2026-11-01" }));
  expect(restored.result.current).toMatchObject({
    open: true,
    title: "이어 쓸 일",
    date: "2026-10-31",
  });
  await act(() => restored.result.current.submit());
  expect(restored.result.current.title).toBe("이어 쓸 일");
  await act(() => restored.result.current.submit());
  expect(createTask).toHaveBeenLastCalledWith("이어 쓸 일", "2026-10-31");
  await waitFor(() => expect(localStorage.getItem("comet:diary:quick-task")).toBeNull());
});
