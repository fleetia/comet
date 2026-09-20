import { useLayoutEffect } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi, type MockInstance } from "vitest";
import { useCharacterCollision } from "../hooks/useCharacterCollision";

const source = "sprite://localhost/character?expression=default&v=1";
const dispatch = vi.fn().mockResolvedValue(undefined);
const onError = vi.fn();
let resizeCallbacks: ResizeObserverCallback[];
let drawImage: ReturnType<typeof vi.fn>;
let pixels: Uint8ClampedArray;
let context: CanvasRenderingContext2D;

beforeEach(() => {
  dispatch.mockReset().mockResolvedValue(undefined);
  onError.mockReset();
  resizeCallbacks = [];
  pixels = new Uint8ClampedArray(5 * 5 * 4);
  drawImage = vi.fn();
  context = {
    drawImage,
    getImageData: vi.fn(() => ({ data: pixels })),
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
  vi.stubGlobal(
    "ResizeObserver",
    vi.fn(function (callback: ResizeObserverCallback) {
      resizeCallbacks.push(callback);
      return { observe: vi.fn(), disconnect: vi.fn() };
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Props = { enabled: boolean; source: string | null; size: number };
function setup(initialProps: Props = { enabled: true, source, size: 5 }): {
  rerender: (props: Props) => void;
  unmount: () => void;
  image: HTMLImageElement;
  imageBounds: MockInstance<() => DOMRect>;
  bodyBounds: MockInstance<() => DOMRect>;
} {
  const body = document.createElement("button");
  const image = document.createElement("img");
  const bodyBounds = vi
    .spyOn(body, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(0, 0, 112, 88));
  const imageBounds = vi
    .spyOn(image, "getBoundingClientRect")
    .mockReturnValue(new DOMRect(4, 14, 5, 5));
  Object.defineProperties(image, {
    complete: { configurable: true, value: false },
    naturalWidth: { configurable: true, value: 10 },
    naturalHeight: { configurable: true, value: 6 },
  });
  const hook = renderHook(
    (props: Props) => {
      const refs = useCharacterCollision({ ...props, dispatch, onError });
      useLayoutEffect(() => {
        refs.bodyRef.current = body;
        refs.imageRef.current = props.source ? image : null;
        if (props.source) {
          image.setAttribute("src", props.source);
        }
      }, [refs.bodyRef, refs.imageRef, props.source]);
      return refs;
    },
    { initialProps },
  );
  return { ...hook, image, imageBounds, bodyBounds };
}

function load(image: HTMLImageElement, currentSource = source): void {
  Object.defineProperties(image, {
    complete: { configurable: true, value: true },
    currentSrc: { configurable: true, value: currentSource },
  });
  act(() => image.dispatchEvent(new Event("load")));
}

function resize(callback: ResizeObserverCallback): void {
  act(() => callback([], {} as ResizeObserver));
}

it("reports the displayed image alpha, preserving transparent padding and holes after contain sizing", () => {
  // A ring surrounded by clear pixels, with a clear center and a partly transparent edge.
  for (const index of [6, 7, 8, 11, 13, 16, 17, 18]) {
    pixels[index * 4 + 3] = index === 6 ? 1 : 255;
  }
  const { image } = setup();
  expect(dispatch).toHaveBeenLastCalledWith("set_character_collision", {
    revision: expect.any(Number),
    mask: null,
  });
  load(image);
  expect(drawImage).toHaveBeenCalledExactlyOnceWith(image, 0, 1, 5, 3);
  expect(context.imageSmoothingEnabled).toBe(false);
  expect(dispatch).toHaveBeenLastCalledWith("set_character_collision", {
    revision: expect.any(Number),
    mask: { x: 4, y: 14, width: 5, height: 5, columns: 5, rows: 5, bits: [192, 41, 7, 0] },
  });
  expect(onError).not.toHaveBeenCalled();
});

it("uses the visible text body bounds, refreshes resize, and clears before hidden callbacks can restore it", () => {
  const { rerender, bodyBounds } = setup({ enabled: true, source: null, size: 64 });
  expect(dispatch).toHaveBeenLastCalledWith("set_character_collision", {
    revision: expect.any(Number),
    mask: { x: 0, y: 0, width: 112, height: 88, columns: 1, rows: 1, bits: [1] },
  });
  bodyBounds.mockReturnValue(new DOMRect(0, 0, 72, 72));
  resize(resizeCallbacks[0]);
  expect(dispatch.mock.lastCall?.[1].mask.width).toBe(72);
  rerender({ enabled: false, source: null, size: 64 });
  expect(dispatch.mock.lastCall?.[1].mask).toBeNull();
  const reports = dispatch.mock.calls.length;
  resize(resizeCallbacks[0]);
  expect(dispatch).toHaveBeenCalledTimes(reports);
  expect(drawImage).not.toHaveBeenCalled();
});

it("clears an old expression, rejects stale loads and resize callbacks, and reports only the new source", () => {
  const { image, rerender, unmount } = setup();
  load(image);
  const oldResize = resizeCallbacks[0];
  const nextSource = "sprite://localhost/character?expression=happy&v=2";
  rerender({ enabled: true, source: nextSource, size: 5 });
  expect(dispatch.mock.lastCall?.[1].mask).toBeNull();
  const reports = dispatch.mock.calls.length;
  resize(oldResize);
  load(image, source);
  expect(dispatch).toHaveBeenCalledTimes(reports);
  load(image, nextSource);
  expect(dispatch.mock.lastCall?.[1].mask).not.toBeNull();
  unmount();
  expect(dispatch.mock.lastCall?.[1].mask).toBeNull();
  const revisions = dispatch.mock.calls.map((call) => call[1].revision as number);
  expect(revisions.every((revision, index) => index === 0 || revision > revisions[index - 1])).toBe(
    true,
  );
});

it("does not report inactive, hidden, or preview bodies until enabled", () => {
  const { image, rerender } = setup({ enabled: false, source, size: 5 });
  load(image);
  expect(dispatch).not.toHaveBeenCalled();
  expect(resizeCallbacks).toHaveLength(0);
  rerender({ enabled: true, source, size: 5 });
  expect(dispatch.mock.lastCall?.[1].mask).not.toBeNull();
});

it("clears unreadable image alpha and reports the error instead of colliding with a solid image box", () => {
  vi.mocked(context.getImageData).mockImplementation(() => {
    throw new DOMException("Canvas is not origin-clean", "SecurityError");
  });
  const { image } = setup();
  load(image);
  expect(dispatch.mock.calls.every((call) => call[1].mask === null)).toBe(true);
  expect(onError).toHaveBeenCalledExactlyOnceWith("SecurityError: Canvas is not origin-clean");
});

it("ignores stale command errors after an expression change and reports current failures", async () => {
  let rejectOld: (cause: Error) => void = () => {};
  dispatch.mockImplementationOnce(
    () =>
      new Promise<void>((_, reject) => {
        rejectOld = reject;
      }),
  );
  const { rerender, image } = setup();
  const nextSource = "sprite://localhost/character?expression=happy&v=2";
  rerender({ enabled: true, source: nextSource, size: 5 });
  await act(async () => rejectOld(new Error("old failure")));
  expect(onError).not.toHaveBeenCalled();
  dispatch.mockRejectedValueOnce(new Error("current failure"));
  load(image, nextSource);
  await act(async () => {});
  expect(onError).toHaveBeenCalledExactlyOnceWith("current failure");
});

it("rebuilds at a changed displayed size and caps the raster at 512 by 512", () => {
  const { image, imageBounds, rerender } = setup();
  load(image);
  imageBounds.mockReturnValue(new DOMRect(4, 4, 512, 512));
  pixels = new Uint8ClampedArray(512 * 512 * 4);
  rerender({ enabled: true, source, size: 512 });
  expect(dispatch.mock.lastCall?.[1].mask).toMatchObject({
    x: 4,
    y: 4,
    width: 512,
    height: 512,
    columns: 512,
    rows: 512,
  });
  expect(dispatch.mock.lastCall?.[1].mask.bits).toHaveLength((512 * 512) / 8);
});
