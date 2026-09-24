import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAnimationFrames } from "../hooks/useAnimationFrames";
import type { AnimationClip } from "../types";

let images: HTMLImageElement[];
let context: CanvasRenderingContext2D;
const sources = { sheet: "sprite://sheet", replacement: "sprite://replacement" };
const clip: AnimationClip = {
  id: "walk",
  name: "걷기",
  fps: 8,
  frames: [
    { assetId: "sheet", x: 0, y: 0, width: 8, height: 4 },
    { assetId: "sheet", x: 8, y: 0, width: 8, height: 4 },
  ],
};

beforeEach(() => {
  images = [];
  context = {
    drawImage: vi.fn(),
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context);
  vi.stubGlobal(
    "Image",
    vi.fn(function () {
      const image = document.createElement("img");
      Object.defineProperties(image, {
        naturalWidth: { value: 16 },
        naturalHeight: { value: 4 },
      });
      images.push(image);
      return image;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("loads each sheet once and prepares contained cropped frames with transparent margins", async () => {
  const { result, rerender } = renderHook(
    ({ animation }) => useAnimationFrames(animation, sources, 16),
    {
      initialProps: { animation: clip },
    },
  );
  expect(result.current).toMatchObject({ ready: false, frames: null, error: null });
  expect(images).toHaveLength(1);
  expect(images[0].crossOrigin).toBe("anonymous");
  await act(async () => {
    images[0].dispatchEvent(new Event("load"));
  });
  expect(result.current.ready).toBe(true);
  expect(result.current.frames?.map((canvas) => [canvas.width, canvas.height])).toEqual([
    [16, 16],
    [16, 16],
  ]);
  expect(context.drawImage).toHaveBeenNthCalledWith(1, images[0], 0, 0, 8, 4, 0, 4, 16, 8);
  expect(context.drawImage).toHaveBeenNthCalledWith(2, images[0], 8, 0, 8, 4, 0, 4, 16, 8);
  expect(context.imageSmoothingEnabled).toBe(false);
  rerender({ animation: structuredClone(clip) });
  expect(images).toHaveLength(1);
  expect(context.drawImage).toHaveBeenCalledTimes(2);
});

it.each(["load", "crop"] as const)(
  "returns no drawable frames after a %s failure",
  async (failure) => {
    const animation =
      failure === "crop" ? { ...clip, frames: [{ ...clip.frames[0], x: 15 }] } : clip;
    const { result } = renderHook(() => useAnimationFrames(animation, sources, 16));
    await act(async () => {
      images[0].dispatchEvent(new Event(failure === "load" ? "error" : "load"));
    });
    expect(result.current.frames).toBeNull();
    expect(result.current.ready).toBe(false);
    expect(result.current.error).toBe(
      failure === "load"
        ? "동작 이미지를 읽지 못했어요."
        : "프레임 영역이 이미지 범위를 벗어났어요.",
    );
    expect(context.drawImage).not.toHaveBeenCalled();
  },
);

it("ignores queued load completion and errors from clips that were replaced or disabled", async () => {
  const { result, rerender } = renderHook(
    ({ animation }: { animation: AnimationClip | undefined }) =>
      useAnimationFrames(animation, sources, 16),
    { initialProps: { animation: clip as AnimationClip | undefined } },
  );
  const oldImage = images[0];
  const oldLoad = oldImage.onload;
  const replacement = {
    ...clip,
    id: "replacement",
    frames: clip.frames.map((frame) => ({ ...frame, assetId: "replacement" })),
  };
  rerender({ animation: replacement });
  await act(async () => {
    images[1].dispatchEvent(new Event("load"));
  });
  const currentFrames = result.current.frames;
  expect(currentFrames).not.toBeNull();
  await act(async () => {
    oldLoad?.call(oldImage, new Event("load"));
  });
  expect(result.current.frames).toBe(currentFrames);
  expect(result.current.error).toBeNull();
  expect(context.drawImage).toHaveBeenCalledTimes(2);

  rerender({ animation: clip });
  const pendingImage = images[2];
  const pendingError = pendingImage.onerror;
  rerender({ animation: undefined });
  await act(async () => {
    pendingError?.call(pendingImage, new Event("error"));
  });
  expect(result.current).toEqual({ frames: null, ready: false, error: null });
});
