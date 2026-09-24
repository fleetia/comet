import type { KeyboardEvent, MouseEvent, PointerEvent } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCharacterGestures } from "../hooks/useCharacterGestures";

const native = vi.hoisted(() => ({ listen: vi.fn(), command: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("../hooks/useSnapshot", () => ({
  command: native.command,
  isDesktop: () => true,
  errorText: (cause: unknown) => String(cause instanceof Error ? cause.message : cause),
}));
const click = vi.fn();
const doubleClick = vi.fn();
const menu = vi.fn();
const error = vi.fn();
const dispatch = vi.fn();
const unlisten = vi.fn();
let receive: (event: { payload: { sessionId: string; phase: string } }) => void;
let pointerTarget: HTMLButtonElement;
let captured: Set<number>;

beforeEach(() => {
  vi.useFakeTimers();
  for (const callback of [click, doubleClick, menu, error, dispatch, unlisten])
    callback.mockReset();
  dispatch.mockResolvedValue(undefined);
  native.command.mockReset().mockResolvedValue({ doubleClickMs: 700 });
  native.listen.mockReset().mockImplementation(async (_name, callback) => {
    receive = callback;
    return unlisten;
  });
  captured = new Set();
  pointerTarget = document.createElement("button");
  pointerTarget.setPointerCapture = vi.fn((id: number) => {
    captured.add(id);
  });
  pointerTarget.hasPointerCapture = vi.fn((id: number) => captured.has(id));
  pointerTarget.releasePointerCapture = vi.fn((id: number) => {
    captured.delete(id);
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function setup(
  initialProps = { enabled: true, resetKey: "friend:definition1" },
): ReturnType<typeof renderHook<ReturnType<typeof useCharacterGestures>, typeof initialProps>> {
  return renderHook(
    (props) =>
      useCharacterGestures({
        ...props,
        onClick: click,
        onDoubleClick: doubleClick,
        onMenu: menu,
        onError: error,
        dispatch,
      }),
    { initialProps },
  );
}
function mouse(detail = 1): MouseEvent<HTMLButtonElement> {
  return { detail, preventDefault: vi.fn() } as unknown as MouseEvent<HTMLButtonElement>;
}
function pointer(x: number, extra = {}): PointerEvent<HTMLButtonElement> {
  return {
    pointerId: 1,
    clientX: x,
    clientY: 0,
    button: 0,
    buttons: 1,
    currentTarget: pointerTarget,
    ...extra,
  } as PointerEvent<HTMLButtonElement>;
}
function key(value: string, extra = {}): KeyboardEvent<HTMLButtonElement> {
  return {
    key: value,
    preventDefault: vi.fn(),
    repeat: false,
    ...extra,
  } as unknown as KeyboardEvent<HTMLButtonElement>;
}

it("waits for the actual OS interval and cancels both single-click candidates on double-click", async () => {
  const { result } = setup();
  await act(async () => {});
  act(() => result.current.onClick?.(mouse()));
  act(() => vi.advanceTimersByTime(699));
  expect(click).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(click).toHaveBeenCalledTimes(1);
  click.mockClear();
  act(() => result.current.onClick?.(mouse()));
  act(() => vi.advanceTimersByTime(300));
  act(() => {
    result.current.onClick?.(mouse(2));
    result.current.onDoubleClick?.(mouse(2));
  });
  act(() => vi.advanceTimersByTime(1000));
  expect(click).not.toHaveBeenCalled();
  expect(doubleClick).toHaveBeenCalledTimes(1);
  expect(menu).not.toHaveBeenCalled();
});

it("holds an early click until settings arrive and discards delayed settings after replacement", async () => {
  let resolve: (settings: { doubleClickMs: number }) => void = () => {};
  native.command.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  const { result, rerender } = setup();
  act(() => result.current.onClick?.(mouse()));
  act(() => vi.advanceTimersByTime(400));
  expect(click).not.toHaveBeenCalled();
  await act(async () => resolve({ doubleClickMs: 700 }));
  act(() => vi.advanceTimersByTime(300));
  expect(click).toHaveBeenCalledTimes(1);
  act(() => result.current.onClick?.(mouse()));
  rerender({ enabled: true, resetKey: "friend:definition2" });
  act(() => vi.advanceTimersByTime(1000));
  expect(click).toHaveBeenCalledTimes(1);
});

it("requests one native drag only after threshold and suppresses the post-drag browser click", async () => {
  const { result } = setup();
  await act(async () => {});
  act(() => {
    result.current.onPointerDown?.(pointer(0));
    result.current.onPointerMove?.(pointer(5));
  });
  expect(dispatch).not.toHaveBeenCalled();
  act(() => {
    result.current.onPointerMove?.(pointer(6));
    result.current.onPointerMove?.(pointer(30));
  });
  expect(dispatch).toHaveBeenCalledExactlyOnceWith("begin_character_drag", {
    sessionId: expect.any(String),
  });
  const sessionId = dispatch.mock.calls[0][1].sessionId as string;
  await act(async () => {});
  // Resolving the command never fabricates a drop; the native notification ends the session.
  act(() => receive({ payload: { sessionId, phase: "ended" } }));
  act(() => result.current.onClick?.(mouse()));
  act(() => vi.advanceTimersByTime(1000));
  expect(click).not.toHaveBeenCalled();
  act(() => {
    result.current.onPointerDown?.(pointer(0));
    result.current.onClick?.(mouse());
  });
  act(() => vi.advanceTimersByTime(700));
  expect(click).toHaveBeenCalledTimes(1);
});

it("captures pending movement outside the body and releases capture before native drag ownership", async () => {
  const { result } = setup();
  await act(async () => {});
  act(() => result.current.onPointerDown?.(pointer(1)));
  expect(pointerTarget.hasPointerCapture(1)).toBe(true);
  act(() => result.current.onPointerMove?.(pointer(-20, { buttons: 0 })));
  expect(dispatch).not.toHaveBeenCalled();
  let capturedAtNativeRequest: boolean | undefined;
  dispatch.mockImplementation(async () => {
    capturedAtNativeRequest = pointerTarget.hasPointerCapture(1);
  });
  // Pointer capture keeps this outside-body coordinate routed to the original button.
  act(() => result.current.onPointerMove?.(pointer(-20)));
  expect(dispatch).toHaveBeenCalledExactlyOnceWith("begin_character_drag", {
    sessionId: expect.any(String),
  });
  expect(capturedAtNativeRequest).toBe(false);
  act(() => {
    result.current.onPointerUp?.(pointer(-20, { buttons: 0 }));
    result.current.onPointerCancel?.(pointer(-20, { buttons: 0 }));
    result.current.onClick?.(mouse());
  });
  act(() => vi.advanceTimersByTime(1000));
  expect(click).not.toHaveBeenCalled();
  expect(dispatch).toHaveBeenCalledTimes(1);
});

it("cleans pending capture on pointer up, cancellation, reset and unmount without starting a drag", async () => {
  const { result, rerender, unmount } = setup();
  await act(async () => {});
  act(() => {
    result.current.onPointerDown?.(pointer(0));
    result.current.onPointerUp?.(pointer(2, { buttons: 0 }));
  });
  expect(pointerTarget.hasPointerCapture(1)).toBe(false);
  act(() => {
    result.current.onPointerDown?.(pointer(0));
    result.current.onPointerCancel?.(pointer(2));
    result.current.onPointerMove?.(pointer(10));
  });
  expect(pointerTarget.hasPointerCapture(1)).toBe(false);
  act(() => result.current.onPointerDown?.(pointer(0)));
  rerender({ enabled: true, resetKey: "friend:replacement" });
  expect(pointerTarget.hasPointerCapture(1)).toBe(false);
  act(() => result.current.onPointerDown?.(pointer(0)));
  unmount();
  expect(pointerTarget.hasPointerCapture(1)).toBe(false);
  expect(dispatch).not.toHaveBeenCalled();
});

it("right-click and keyboard menu cancel pending clicks; keyboard activation never waits or repeats", async () => {
  const { result } = setup();
  await act(async () => {});
  act(() => {
    result.current.onClick?.(mouse());
    result.current.onContextMenu?.(mouse());
    result.current.onKeyDown?.(key("F10", { shiftKey: true }));
    result.current.onKeyDown?.(key("ContextMenu"));
  });
  act(() => vi.advanceTimersByTime(1000));
  expect(click).not.toHaveBeenCalled();
  expect(menu).toHaveBeenCalledTimes(3);
  act(() => {
    result.current.onKeyDown?.(key("Enter"));
    result.current.onKeyDown?.(key("Enter", { repeat: true }));
    result.current.onKeyDown?.(key(" "));
    result.current.onKeyDown?.(key(" ", { repeat: true }));
  });
  expect(click).toHaveBeenCalledTimes(1);
  act(() => result.current.onKeyUp?.(key(" ")));
  expect(click).toHaveBeenCalledTimes(2);
  act(() => result.current.onClick?.(mouse(0)));
  expect(click).toHaveBeenCalledTimes(3);
});

it("discards pending clicks, stale native errors and late listener registration after hiding", async () => {
  let reject: (cause: Error) => void = () => {};
  dispatch.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const { result, rerender, unmount } = setup();
  await act(async () => {});
  act(() => {
    result.current.onPointerDown?.(pointer(0));
    result.current.onPointerMove?.(pointer(9));
  });
  rerender({ enabled: false, resetKey: "friend:hidden" });
  await act(async () => reject(new Error("stale")));
  expect(error).not.toHaveBeenCalled();
  expect(unlisten).toHaveBeenCalledTimes(1);
  unmount();
  let resolveListener: (cleanup: () => void) => void = () => {};
  native.listen.mockImplementationOnce(
    () =>
      new Promise((done) => {
        resolveListener = done;
      }),
  );
  const next = setup();
  act(() => next.result.current.onClick?.(mouse()));
  next.unmount();
  await act(async () => resolveListener(unlisten));
  act(() => vi.advanceTimersByTime(1000));
  expect(click).not.toHaveBeenCalled();
  expect(unlisten).toHaveBeenCalledTimes(2);
});

it("reports current native errors without producing a click or menu reaction", async () => {
  dispatch.mockRejectedValueOnce(new Error("native drag failed"));
  const { result } = setup();
  await act(async () => {});
  act(() => {
    result.current.onPointerDown?.(pointer(0));
    result.current.onPointerMove?.(pointer(10));
  });
  await act(async () => {});
  act(() => result.current.onClick?.(mouse()));
  act(() => vi.advanceTimersByTime(1000));
  expect(error).toHaveBeenCalledExactlyOnceWith("native drag failed");
  expect(click).not.toHaveBeenCalled();
  expect(menu).not.toHaveBeenCalled();
});
