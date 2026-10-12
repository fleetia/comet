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
const listeners = new Map<
  string,
  (event: { payload: { sessionId: string; phase: string } }) => void
>();
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
  listeners.clear();
  native.listen.mockReset().mockImplementation(async (name, callback) => {
    listeners.set(name, callback);
    if (name === "character-gesture") receive = callback;
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
    result.current.onPointerDown?.(pointer(0, { ctrlKey: true }));
    result.current.onPointerMove?.(pointer(5));
  });
  expect(dispatch).not.toHaveBeenCalled();
  act(() => {
    result.current.onPointerMove?.(pointer(6));
    result.current.onPointerMove?.(pointer(30));
  });
  await act(async () => {});
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
  act(() => result.current.onPointerDown?.(pointer(1, { metaKey: true })));
  expect(pointerTarget.hasPointerCapture(1)).toBe(true);
  act(() => result.current.onPointerMove?.(pointer(-20, { buttons: 0 })));
  expect(dispatch).not.toHaveBeenCalled();
  let capturedAtNativeRequest: boolean | undefined;
  dispatch.mockImplementation(async () => {
    capturedAtNativeRequest = pointerTarget.hasPointerCapture(1);
  });
  // Pointer capture keeps this outside-body coordinate routed to the original button.
  act(() => result.current.onPointerMove?.(pointer(-20)));
  await act(async () => {});
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
  expect(dispatch.mock.calls.filter(([name]) => name === "begin_character_drag")).toHaveLength(1);
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
    result.current.onPointerDown?.(pointer(0, { ctrlKey: true }));
    result.current.onPointerMove?.(pointer(9));
  });
  rerender({ enabled: false, resetKey: "friend:hidden" });
  await act(async () => reject(new Error("stale")));
  expect(error).not.toHaveBeenCalled();
  expect(unlisten).toHaveBeenCalledTimes(2);
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
  expect(unlisten).toHaveBeenCalledTimes(4);
});

it("reports current native errors without producing a click or menu reaction", async () => {
  dispatch.mockRejectedValueOnce(new Error("native drag failed"));
  const { result } = setup();
  await act(async () => {});
  act(() => {
    result.current.onPointerDown?.(pointer(0, { ctrlKey: true }));
    result.current.onPointerMove?.(pointer(10));
  });
  await act(async () => {});
  act(() => result.current.onClick?.(mouse()));
  act(() => vi.advanceTimersByTime(1000));
  expect(error).toHaveBeenCalledExactlyOnceWith("native drag failed");
  expect(click).not.toHaveBeenCalled();
  expect(menu).not.toHaveBeenCalled();
});

it("keeps ordinary touch stationary and emits one stroke at either movement threshold", async () => {
  const { result } = setup();
  await act(async () => {});
  act(() => {
    result.current.onPointerDown?.(pointer(0));
    result.current.onPointerMove?.(pointer(8, { ctrlKey: true }));
    result.current.onPointerMove?.(pointer(40));
    result.current.onPointerUp?.(pointer(40, { buttons: 0 }));
    result.current.onClick?.(mouse());
  });
  await act(async () => {});
  expect(dispatch).toHaveBeenCalledExactlyOnceWith("trigger_character_interaction", {
    action: "stroke",
    bodyPart: undefined,
    sessionId: expect.any(String),
    phase: "ended",
  });
  expect(click).not.toHaveBeenCalled();
  dispatch.mockClear();
  act(() => {
    result.current.onPointerDown?.(pointer(0));
    for (const x of [6, 0, 6, 0]) result.current.onPointerMove?.(pointer(x));
    result.current.onPointerUp?.(pointer(0, { buttons: 0 }));
    result.current.onClick?.(mouse());
  });
  await act(async () => {});
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(dispatch.mock.calls[0][1].action).toBe("stroke");
});

it("consumes menu movement once, fixes the initial mode and suppresses simple armed clicks", async () => {
  const { result } = setup();
  await act(async () => {});
  act(() => listeners.get("character-move-armed")?.({ payload: { sessionId: "", phase: "" } }));
  act(() => {
    result.current.onPointerDown?.(pointer(0));
    result.current.onPointerMove?.(pointer(6));
  });
  await act(async () => {});
  expect(dispatch.mock.calls[0][0]).toBe("begin_character_drag");
  const sessionId = dispatch.mock.calls[0][1].sessionId;
  act(() => receive({ payload: { sessionId, phase: "ended" } }));
  dispatch.mockClear();
  act(() => {
    result.current.onPointerDown?.(pointer(0));
    result.current.onPointerMove?.(pointer(8));
    result.current.onPointerUp?.(pointer(8));
  });
  await act(async () => {});
  expect(dispatch.mock.calls[0][0]).toBe("trigger_character_interaction");
  dispatch.mockClear();
  act(() => listeners.get("character-move-armed")?.({ payload: { sessionId: "", phase: "" } }));
  act(() => {
    result.current.onPointerDown?.(pointer(0));
    result.current.onPointerUp?.(pointer(1));
    result.current.onClick?.(mouse());
    vi.advanceTimersByTime(1000);
  });
  expect(dispatch).not.toHaveBeenCalled();
  expect(click).not.toHaveBeenCalled();
});

it("confirms cheek at 450ms, never turns it into movement and cancels without an effect", async () => {
  pointerTarget.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 100, height: 100 }) as DOMRect;
  const { result } = renderHook(() =>
    useCharacterGestures({
      enabled: true,
      resetKey: "cheek",
      dispatch,
      regions: [{ id: "cheek", name: "볼", x: 0, y: 0, width: 1, height: 1 }],
      cheekRegionIds: ["cheek"],
      onClick: click,
      onDoubleClick: doubleClick,
      onMenu: menu,
      onError: error,
    }),
  );
  await act(async () => {});
  act(() => {
    result.current.onPointerDown?.(pointer(0));
    vi.advanceTimersByTime(449);
  });
  expect(dispatch).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(1);
    result.current.onPointerMove?.(pointer(50, { ctrlKey: true }));
    result.current.onPointerUp?.(pointer(50));
    result.current.onClick?.(mouse());
  });
  await act(async () => {});
  expect(dispatch.mock.calls.map(([name, args]) => [name, args.phase])).toEqual([
    ["trigger_character_interaction", "started"],
    ["trigger_character_interaction", "ended"],
  ]);
  expect(dispatch.mock.calls[0][1].sessionId).toBe(dispatch.mock.calls[1][1].sessionId);
  expect(click).not.toHaveBeenCalled();
  dispatch.mockClear();
  act(() => {
    result.current.onPointerDown?.(pointer(0));
    vi.advanceTimersByTime(450);
  });
  await act(async () => {});
  act(() => {
    result.current.onBlur?.({} as never);
    result.current.onClick?.(mouse());
  });
  await act(async () => {});
  expect(dispatch.mock.calls.map(([, args]) => args.phase)).toEqual(["started", "cancelled"]);
  expect(click).not.toHaveBeenCalled();
});

it("discards a pending poke and an unconfirmed cheek on blur, Escape and cancellation", async () => {
  const { result } = setup();
  await act(async () => {});
  act(() => {
    result.current.onClick?.(mouse());
    result.current.onBlur?.({} as never);
    result.current.onClick?.(mouse());
    result.current.onPointerDown?.(pointer(0));
    result.current.onKeyDown?.(key("Escape"));
    result.current.onClick?.(mouse());
    vi.advanceTimersByTime(1000);
  });
  expect(click).not.toHaveBeenCalled();
  expect(dispatch).not.toHaveBeenCalled();
});

it("keeps a late synthetic click suppressed after hiding and showing until fresh pointer-down", async () => {
  const { result, rerender } = setup();
  await act(async () => {});
  act(() => result.current.onClick?.(mouse()));
  rerender({ enabled: false, resetKey: "friend:hidden" });
  rerender({ enabled: true, resetKey: "friend:shown" });
  await act(async () => {});
  act(() => {
    result.current.onClick?.(mouse());
    vi.advanceTimersByTime(1000);
  });
  expect(click).not.toHaveBeenCalled();
  act(() => {
    result.current.onPointerDown?.(pointer(0));
    result.current.onPointerUp?.(pointer(0));
    result.current.onClick?.(mouse());
    vi.advanceTimersByTime(700);
  });
  expect(click).toHaveBeenCalledTimes(1);
});

it("preserves a menu Move reservation during native focus handoff but cancels it on Escape", async () => {
  const { result } = setup();
  await act(async () => {});
  act(() => {
    listeners.get("character-move-armed")?.({ payload: { sessionId: "", phase: "" } });
    result.current.onBlur?.({} as never);
    result.current.onPointerDown?.(pointer(0));
    result.current.onPointerMove?.(pointer(10));
  });
  await act(async () => {});
  expect(dispatch).toHaveBeenCalledExactlyOnceWith("begin_character_drag", {
    sessionId: expect.any(String),
  });
  act(() =>
    receive({ payload: { sessionId: dispatch.mock.calls[0][1].sessionId, phase: "ended" } }),
  );
  dispatch.mockClear();
  act(() => {
    listeners.get("character-move-armed")?.({ payload: { sessionId: "", phase: "" } });
    result.current.onKeyDown?.(key("Escape"));
    result.current.onPointerDown?.(pointer(0));
    result.current.onPointerMove?.(pointer(10));
    result.current.onPointerUp?.(pointer(10));
  });
  await act(async () => {});
  expect(dispatch).toHaveBeenCalledWith(
    "trigger_character_interaction",
    expect.objectContaining({ action: "stroke" }),
  );
  expect(dispatch.mock.calls.filter(([name]) => name === "begin_character_drag")).toHaveLength(0);
});

it("returns from automatic movement before native pickup and never starts after release", async () => {
  let finishContact: () => void = () => {};
  native.command.mockImplementation(async (name: string) => {
    if (name === "begin_character_contact")
      return new Promise<void>((resolve) => {
        finishContact = resolve;
      });
    return { doubleClickMs: 700 };
  });
  const { result } = setup();
  await act(async () => {});
  act(() => {
    result.current.onPointerDown?.(pointer(0, { ctrlKey: true }));
    result.current.onPointerMove?.(pointer(10));
  });
  expect(native.command).toHaveBeenCalledWith("begin_character_contact");
  expect(dispatch).not.toHaveBeenCalled();
  await act(async () => finishContact());
  expect(dispatch).toHaveBeenCalledExactlyOnceWith("begin_character_drag", {
    sessionId: expect.any(String),
  });
  act(() =>
    receive({ payload: { sessionId: dispatch.mock.calls[0][1].sessionId, phase: "ended" } }),
  );
  dispatch.mockClear();
  act(() => {
    result.current.onPointerDown?.(pointer(0, { ctrlKey: true }));
    result.current.onPointerMove?.(pointer(10));
    result.current.onPointerUp?.(pointer(10));
  });
  await act(async () => finishContact());
  expect(dispatch).not.toHaveBeenCalled();
});

it("keeps native contact ordering when diagnostic delivery never resolves", async () => {
  let finishContact: () => void = () => {};
  native.command.mockImplementation(async (name: string) => {
    if (name === "trace_character_gesture") return new Promise<void>(() => {});
    if (name === "begin_character_contact") {
      return new Promise<void>((resolve) => {
        finishContact = resolve;
      });
    }
    return { doubleClickMs: 700, traceEnabled: true };
  });
  const { result } = setup();
  await act(async () => {});
  act(() => {
    result.current.onPointerDown?.(pointer(0, { metaKey: true }));
    for (let index = 0; index < 100; index += 1) {
      result.current.onPointerMove?.(pointer(10));
    }
    result.current.onPointerUp?.(pointer(10));
  });
  await act(async () => finishContact());
  expect(dispatch).not.toHaveBeenCalled();
  const traces = native.command.mock.calls
    .filter(([name]) => name === "trace_character_gesture")
    .map(([, args]) => args.event);
  expect(traces.filter(({ phase }) => phase === "move")).toHaveLength(1);
  expect(traces).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ phase: "up", nativeRequested: false }),
      expect.objectContaining({ phase: "begin-skipped", pointerCurrent: false }),
    ]),
  );
  act(() => {
    result.current.onPointerDown?.(pointer(0, { metaKey: true }));
    result.current.onPointerMove?.(pointer(10));
  });
  await act(async () => finishContact());
  expect(dispatch).toHaveBeenCalledExactlyOnceWith("begin_character_drag", {
    sessionId: expect.any(String),
  });
});

it("reports the actual OS reduced-motion preference and changes to the native body", async () => {
  let change: (() => void) | undefined;
  const preference = {
    matches: false,
    addEventListener: vi.fn((_name, callback) => {
      change = callback;
    }),
    removeEventListener: vi.fn(),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => preference),
  );
  const { unmount } = setup();
  await act(async () => {});
  expect(native.command).toHaveBeenCalledWith("report_character_motion_preference", {
    reducedMotion: false,
  });
  act(() => {
    preference.matches = true;
    change?.();
  });
  expect(native.command).toHaveBeenCalledWith("report_character_motion_preference", {
    reducedMotion: true,
  });
  unmount();
  expect(preference.removeEventListener).toHaveBeenCalledWith("change", change);
  vi.unstubAllGlobals();
});

it("leaves capture handoff cancellation to native terminal events and still cancels on Escape", async () => {
  const { result } = setup();
  await act(async () => {});
  act(() => {
    result.current.onPointerDown?.(pointer(0, { ctrlKey: true }));
    result.current.onPointerMove?.(pointer(10));
  });
  await act(async () => {});
  const sessionId = dispatch.mock.calls[0][1].sessionId;
  act(() => {
    result.current.onPointerCancel?.(pointer(10));
    result.current.onClick?.(mouse());
  });
  expect(dispatch.mock.calls.filter(([name]) => name === "cancel_character_drag")).toHaveLength(0);
  expect(click).not.toHaveBeenCalled();
  act(() => result.current.onKeyDown?.(key("Escape")));
  await act(async () => {});
  expect(dispatch).toHaveBeenCalledWith("cancel_character_drag", { sessionId });
  act(() => receive({ payload: { sessionId, phase: "cancelled" } }));
  act(() => result.current.onClick?.(mouse()));
  expect(click).not.toHaveBeenCalled();
});

it("orders explicit cancellation after an in-flight native drag request is registered", async () => {
  let finishRequest: () => void = () => {};
  dispatch.mockImplementation((name) =>
    name === "begin_character_drag"
      ? new Promise<void>((resolve) => {
          finishRequest = resolve;
        })
      : Promise.resolve(),
  );
  const { result } = setup();
  await act(async () => {});
  act(() => {
    result.current.onPointerDown?.(pointer(0, { ctrlKey: true }));
    result.current.onPointerMove?.(pointer(10));
  });
  await act(async () => {});
  const sessionId = dispatch.mock.calls[0][1].sessionId;
  act(() => result.current.onKeyDown?.(key("Escape")));
  await act(async () => {});
  expect(dispatch.mock.calls.filter(([name]) => name === "cancel_character_drag")).toHaveLength(0);
  await act(async () => finishRequest());
  expect(dispatch).toHaveBeenCalledWith("cancel_character_drag", { sessionId });
  act(() => result.current.onClick?.(mouse()));
  expect(click).not.toHaveBeenCalled();
});
