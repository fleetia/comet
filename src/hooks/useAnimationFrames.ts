import { useEffect, useMemo, useState } from "react";
import type { AnimationClip } from "../types";
import { errorText } from "./useSnapshot";

type Loaded = { key: string; frames: HTMLCanvasElement[] | null; error: string | null };

export function useAnimationFrames(
  clip: AnimationClip | undefined,
  sources: Record<string, string>,
  size: number,
): {
  frames: HTMLCanvasElement[] | null;
  ready: boolean;
  error: string | null;
} {
  const key = useMemo(
    () => JSON.stringify([clip?.frames ?? [], sources, size]),
    [clip?.frames, sources, size],
  );
  const [loaded, setLoaded] = useState<Loaded>({ key: "", frames: null, error: null });
  useEffect(() => {
    const [frames, urls, dimension] = JSON.parse(key) as [
      AnimationClip["frames"],
      Record<string, string>,
      number,
    ];
    if (!frames.length) return;
    let active = true;
    const images = new Map<string, HTMLImageElement>();
    async function prepare(): Promise<void> {
      try {
        await Promise.all(
          [...new Set(frames.map((frame) => frame.assetId))].map(async (id) => {
            if (!urls[id]) throw new Error("동작 이미지를 찾을 수 없어요.");
            const image = new Image();
            image.crossOrigin = "anonymous";
            images.set(id, image);
            await new Promise<void>((resolve, reject) => {
              image.onload = () => resolve();
              image.onerror = () => reject(new Error("동작 이미지를 읽지 못했어요."));
              image.src = urls[id];
            });
          }),
        );
        if (!active) return;
        const rendered = frames.map((frame) => {
          const image = images.get(frame.assetId)!;
          if (
            frame.width <= 0 ||
            frame.height <= 0 ||
            frame.x < 0 ||
            frame.y < 0 ||
            frame.x + frame.width > image.naturalWidth ||
            frame.y + frame.height > image.naturalHeight
          ) {
            throw new Error("프레임 영역이 이미지 범위를 벗어났어요.");
          }
          const canvas = document.createElement("canvas");
          canvas.width = dimension;
          canvas.height = dimension;
          const context = canvas.getContext("2d");
          if (!context) throw new Error("동작을 그릴 수 없어요.");
          const ratio = Math.min(dimension / frame.width, dimension / frame.height);
          const width = frame.width * ratio;
          const height = frame.height * ratio;
          context.imageSmoothingEnabled = false;
          context.drawImage(
            image,
            frame.x,
            frame.y,
            frame.width,
            frame.height,
            (dimension - width) / 2,
            (dimension - height) / 2,
            width,
            height,
          );
          return canvas;
        });
        setLoaded({ key, frames: rendered, error: null });
      } catch (cause) {
        if (active) setLoaded({ key, frames: null, error: errorText(cause) });
      }
    }
    void prepare();
    return () => {
      active = false;
      images.forEach((image) => {
        image.onload = null;
        image.onerror = null;
        image.src = "";
      });
    };
  }, [key]);
  const current = loaded.key === key ? loaded : null;
  return {
    frames: current?.frames ?? null,
    ready: Boolean(current?.frames),
    error: current?.error ?? null,
  };
}
