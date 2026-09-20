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
};
type Refs = {
  bodyRef: RefObject<HTMLButtonElement | null>;
  imageRef: RefObject<HTMLImageElement | null>;
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
  const bits = Array<number>(Math.ceil((columns * rows) / 8)).fill(0);
  for (let index = 0; index < columns * rows; index += 1) {
    if (data[index * 4 + 3] > 0) {
      bits[Math.floor(index / 8)] |= 1 << (index % 8);
    }
  }
  return { ...rect, columns, rows, bits };
}

export function useCharacterCollision({ enabled, source, size, dispatch, onError }: Options): Refs {
  const bodyRef = useRef<HTMLButtonElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const latestReport = useRef(0);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let active = true;
    const body = bodyRef.current;
    const image = imageRef.current;
    function report(mask: CollisionMask | null): void {
      const revision = ++reportRevision;
      latestReport.current = revision;
      try {
        void Promise.resolve(dispatch("set_character_collision", { revision, mask })).catch(
          (cause: unknown) => {
            if (active && latestReport.current === revision) {
              onError(errorText(cause));
            }
          },
        );
      } catch (cause) {
        if (active && latestReport.current === revision) {
          onError(errorText(cause));
        }
      }
    }
    function update(): void {
      if (!active) {
        return;
      }
      try {
        if (source) {
          if (
            !image ||
            !image.complete ||
            image.getAttribute("src") !== source ||
            (image.currentSrc && image.currentSrc !== source)
          ) {
            return;
          }
          report(imageMask(image));
          return;
        }
        const rect = body && bounds(body);
        report(rect ? { ...rect, columns: 1, rows: 1, bits: [1] } : null);
      } catch (cause) {
        report(null);
        onError(errorText(cause));
      }
    }
    function imageFailed(): void {
      if (active) {
        report(null);
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
    update();
    return () => {
      active = false;
      observer?.disconnect();
      image?.removeEventListener("load", update);
      image?.removeEventListener("error", imageFailed);
      report(null);
    };
  }, [enabled, source, size, dispatch, onError]);

  return { bodyRef, imageRef };
}
