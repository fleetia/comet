import { useEffect, useRef, type RefObject } from "react";
import type { Dispatch } from "../types";
import { errorText } from "./useSnapshot";

type CollisionMask = {
  x: number;
  y: number;
  width: number;
  height: number;
  columns: number;
  rows: number;
  bits: number[];
};
type Options = {
  enabled: boolean;
  source: string | null;
  size: number;
  dispatch: Dispatch;
  onError: (message: string) => void;
  animation?: {
    key: string;
    frames: readonly HTMLCanvasElement[];
    frame: number | null;
  };
};
type Refs = {
  bodyRef: RefObject<HTMLButtonElement | null>;
  imageRef: RefObject<HTMLImageElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
};

// A webview has one character body. Keep revisions increasing across StrictMode remounts too.
let reportRevision = Date.now();

function bounds(element: HTMLElement): Pick<CollisionMask, "x" | "y" | "width" | "height"> | null {
  const { x, y, width, height } = element.getBoundingClientRect();
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    width <= 0 ||
    height <= 0 ||
    x + width > 520 ||
    y + height > 520
  ) {
    return null;
  }
  return { x, y, width, height };
}

function alphaBits(data: Uint8ClampedArray, cells: number): number[] {
  const bits = Array<number>(Math.ceil(cells / 8)).fill(0);
  for (let index = 0; index < cells; index += 1) {
    if (data[index * 4 + 3] > 0) {
      bits[Math.floor(index / 8)] |= 1 << (index % 8);
    }
  }
  return bits;
}

function imageMask(image: HTMLImageElement): CollisionMask | null {
  const rect = bounds(image);
  if (!rect || image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    return null;
  }
  const columns = Math.min(512, Math.ceil(rect.width));
  const rows = Math.min(512, Math.ceil(rect.height));
  const canvas = document.createElement("canvas");
  canvas.width = columns;
  canvas.height = rows;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("캐릭터 이미지의 충돌 영역을 읽지 못했어요.");
  }
  const contain = Math.min(rect.width / image.naturalWidth, rect.height / image.naturalHeight);
  const width = image.naturalWidth * contain;
  const height = image.naturalHeight * contain;
  context.imageSmoothingEnabled = false;
  context.drawImage(
    image,
    ((rect.width - width) / 2) * (columns / rect.width),
    ((rect.height - height) / 2) * (rows / rect.height),
    width * (columns / rect.width),
    height * (rows / rect.height),
  );
  const { data } = context.getImageData(0, 0, columns, rows);
  return { ...rect, columns, rows, bits: alphaBits(data, columns * rows) };
}

function canvasMask(
  canvas: HTMLCanvasElement,
  rect: NonNullable<ReturnType<typeof bounds>>,
): CollisionMask {
  const columns = canvas.width;
  const rows = canvas.height;
  if (columns < 1 || columns > 512 || rows < 1 || rows > 512) {
    throw new Error("캐릭터 동작의 충돌 프레임 크기가 올바르지 않아요.");
  }
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    throw new Error("캐릭터 동작의 충돌 영역을 읽지 못했어요.");
  }
  const { data } = context.getImageData(0, 0, columns, rows);
  return { ...rect, columns, rows, bits: alphaBits(data, columns * rows) };
}

export function useCharacterCollision({
  enabled,
  source,
  size,
  dispatch,
  onError,
  animation,
}: Options): Refs {
  const bodyRef = useRef<HTMLButtonElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latestReport = useRef(0);
  const latestFrame = useRef(animation?.frame ?? null);
  const selectFrame = useRef<(() => void) | null>(null);
  const animationKey = animation?.key;
  const animationFrames = animation?.frames;
  const animationFrame = animation?.frame ?? null;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let active = true;
    const body = bodyRef.current;
    const image = imageRef.current;
    const canvas = canvasRef.current;
    let cacheRevision = 0;
    let cacheReady = false;
    let lastLayout = "";
    let selectedFrame: number | null | undefined;
    function fail(cause: unknown, revision: number): void {
      if (active && latestReport.current === revision) {
        onError(errorText(cause));
      }
    }
    function report(mask: CollisionMask | null): void {
      const revision = ++reportRevision;
      latestReport.current = revision;
      try {
        void Promise.resolve(dispatch("set_character_collision", { revision, mask })).catch(
          (cause: unknown) => {
            fail(cause, revision);
          },
        );
      } catch (cause) {
        fail(cause, revision);
      }
    }
    selectFrame.current = () => {
      if (!active || !cacheReady || selectedFrame === latestFrame.current) {
        return;
      }
      selectedFrame = latestFrame.current;
      const revision = ++reportRevision;
      latestReport.current = revision;
      try {
        void Promise.resolve(
          dispatch("select_character_collision_frame", {
            revision,
            cacheRevision,
            frame: selectedFrame,
          }),
        ).catch((cause: unknown) => fail(cause, revision));
      } catch (cause) {
        fail(cause, revision);
      }
    };
    function register(masks: CollisionMask[], fallback: CollisionMask | null): void {
      const revision = ++reportRevision;
      latestReport.current = revision;
      cacheRevision = revision;
      cacheReady = false;
      selectedFrame = undefined;
      const rejected = (cause: unknown): void => {
        if (!active || cacheRevision !== revision) {
          return;
        }
        report(fallback);
        onError(errorText(cause));
      };
      try {
        void Promise.resolve(
          dispatch("set_character_collision_animation", { revision, masks, fallback }),
        )
          .then(() => {
            if (!active || cacheRevision !== revision) {
              return;
            }
            cacheReady = true;
            selectFrame.current?.();
          })
          .catch(rejected);
      } catch (cause) {
        rejected(cause);
      }
    }
    function update(): void {
      if (!active) {
        return;
      }
      let fallback: CollisionMask | null = null;
      try {
        const loaded = Boolean(
          image &&
          image.complete &&
          image.getAttribute("src") === source &&
          (!image.currentSrc || image.currentSrc === source),
        );
        if (animationFrames?.length && canvas) {
          if (animationFrames.length > 64) {
            throw new Error("캐릭터 동작의 충돌 프레임은 1~64개여야 해요.");
          }
          const rect = bounds(canvas);
          if (!rect) {
            return;
          }
          let fallbackRect = body && bounds(body);
          if (source) {
            fallbackRect = loaded && image ? bounds(image) : null;
          }
          const layout = JSON.stringify([rect, fallbackRect, loaded]);
          if (layout === lastLayout) {
            return;
          }
          lastLayout = layout;
          if (source && loaded && image) {
            fallback = imageMask(image);
          } else if (!source && fallbackRect) {
            fallback = { ...fallbackRect, columns: 1, rows: 1, bits: [1] };
          }
          register(
            animationFrames.map((frame) => canvasMask(frame, rect)),
            fallback,
          );
          return;
        }
        if (source) {
          if (!loaded || !image) {
            return;
          }
          report(imageMask(image));
          return;
        }
        const rect = body && bounds(body);
        report(rect ? { ...rect, columns: 1, rows: 1, bits: [1] } : null);
      } catch (cause) {
        cacheReady = false;
        cacheRevision = 0;
        report(fallback);
        onError(errorText(cause));
      }
    }
    function imageFailed(): void {
      if (active) {
        cacheReady = false;
        cacheRevision = 0;
        lastLayout = "";
        report(null);
        if (animationFrames?.length) {
          update();
        }
      }
    }
    report(null);
    image?.addEventListener("load", update);
    image?.addEventListener("error", imageFailed);
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (body) {
      observer?.observe(body);
    }
    if (image) {
      observer?.observe(image);
    }
    if (canvas) {
      observer?.observe(canvas);
    }
    update();
    return () => {
      active = false;
      cacheReady = false;
      selectFrame.current = null;
      observer?.disconnect();
      image?.removeEventListener("load", update);
      image?.removeEventListener("error", imageFailed);
      report(null);
    };
  }, [enabled, source, size, dispatch, onError, animationKey, animationFrames]);

  useEffect(() => {
    latestFrame.current = animationFrame;
    selectFrame.current?.();
  }, [animationFrame]);

  return { bodyRef, imageRef, canvasRef };
}
