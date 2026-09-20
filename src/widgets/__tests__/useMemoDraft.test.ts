import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { command } from "../../hooks/useSnapshot";
import { useMemoDraft } from "../useMemoDraft";

vi.mock("../../hooks/useSnapshot", () => ({
  command: vi.fn(),
  isDesktop: () => true,
  errorText: (cause: unknown) => String(cause),
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(command).mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const initial = { id: "memo", noteId: "note", body: "원문", fontSize: 16 };

it("debounces exact text and font changes into one note save", async () => {
  const { result } = renderHook(() => useMemoDraft(initial));
  act(() => result.current.edit({ body: "  첫 줄\n\n둘째 줄  " }));
  act(() => result.current.edit({ fontSize: 14 }));
  expect(command).not.toHaveBeenCalled();
  await act(async () => {
    await vi.advanceTimersByTimeAsync(400);
  });
  expect(command).toHaveBeenCalledExactlyOnceWith("save_memo_note", {
    id: "memo",
    noteId: "note",
    body: "  첫 줄\n\n둘째 줄  ",
    fontSize: 14,
    expectedBody: "원문",
  });
  expect(result.current.status).toBe("saved");
});

it("flushes edits typed during an in-flight save in order before closing", async () => {
  let finish: (() => void) | undefined;
  vi.mocked(command).mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { result, rerender } = renderHook((props) => useMemoDraft(props), {
    initialProps: initial,
  });
  act(() => result.current.edit({ body: "첫 저장" }));
  let flushed: Promise<boolean> | undefined;
  act(() => {
    flushed = result.current.flush();
  });
  act(() => result.current.edit({ body: "최신 입력" }));
  rerender({ ...initial, body: "첫 저장" });
  expect(result.current.draft.body).toBe("최신 입력");
  await act(async () => {
    finish?.();
    expect(await flushed).toBe(true);
  });
  expect(vi.mocked(command).mock.calls.map((call) => call[1])).toEqual([
    { id: "memo", noteId: "note", body: "첫 저장", fontSize: 16, expectedBody: "원문" },
    { id: "memo", noteId: "note", body: "최신 입력", fontSize: 16, expectedBody: "첫 저장" },
  ]);
  expect(result.current.status).toBe("saved");
});

it("keeps the draft after failure and retries only on explicit save or new input", async () => {
  vi.mocked(command).mockRejectedValueOnce(new Error("저장 실패"));
  const { result, rerender } = renderHook((props) => useMemoDraft(props), {
    initialProps: initial,
  });
  act(() => result.current.edit({ body: "  보존할 초안\n " }));
  await act(async () => {
    expect(await result.current.flush()).toBe(false);
  });
  rerender({ ...initial, body: "다른 변경" });
  expect(result.current.draft.body).toBe("  보존할 초안\n ");
  expect(result.current.status).toBe("error");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(command).toHaveBeenCalledTimes(1);
  await act(async () => {
    expect(await result.current.flush()).toBe(true);
  });
  expect(command).toHaveBeenLastCalledWith("save_memo_note", {
    id: "memo",
    noteId: "note",
    body: "  보존할 초안\n ",
    fontSize: 16,
    expectedBody: "원문",
  });
});

it("adopts remote changes only when there is no local draft", () => {
  const { result, rerender } = renderHook((props) => useMemoDraft(props), {
    initialProps: initial,
  });
  rerender({ ...initial, body: "다른 창에서 저장됨", fontSize: 12 });
  expect(result.current.draft).toEqual({ body: "다른 창에서 저장됨", fontSize: 12 });
});
