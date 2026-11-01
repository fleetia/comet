import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useDiaryLeave } from "./useDiaryLeave";

afterEach(cleanup);

it("replays only the last request after saving through the current draft guard", () => {
  const first = vi.fn(), last = vi.fn();
  const { result, rerender } = renderHook(
    ({ saving, unsaved }) => useDiaryLeave({ saving, unsaved, closingUnsaved: false }),
    { initialProps: { saving: true, unsaved: false } },
  );
  act(() => { result.current.navigate(first); result.current.navigate(last); });
  expect(first).not.toHaveBeenCalled();
  expect(last).not.toHaveBeenCalled();
  rerender({ saving: false, unsaved: true });
  expect(result.current.leave?.action).toBe(last);
  expect(first).not.toHaveBeenCalled();
  expect(last).not.toHaveBeenCalled();
  act(() => result.current.leave?.action());
  expect(last).toHaveBeenCalledOnce();
});
