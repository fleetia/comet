import { useLayoutEffect, useRef, useState } from "react";
import { command, errorText, isDesktop } from "./useSnapshot";

export function useBalloonSizing(
  preview: boolean,
  contentKey: string,
  imageReady: boolean,
  fontKey: string,
  onError: (error: string) => void,
) {
  const elementRef = useRef<HTMLElement>(null);
  const [measuredKey, setMeasuredKey] = useState<string | null>(null);
  const native =
    !preview &&
    isDesktop() &&
    new URLSearchParams(window.location.search).get("view") === "balloon";
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element || !native) return;
    // Native display waits for the final font metrics and image borders for this content.
    element.style.visibility = "hidden";
    setMeasuredKey(null);
    if (!imageReady) return;
    let active = true;
    let previousSize = "";
    let frame = 0;
    function measure(): void {
      if (!active) return;
      const rect = element!.getBoundingClientRect();
      const width = Math.min(320, Math.max(48, Math.ceil(rect.width)));
      const height = Math.min(520, Math.max(32, Math.ceil(rect.height)));
      const size = `${width}:${height}`;
      if (size === previousSize) return;
      previousSize = size;
      element!.style.visibility = "visible";
      void command("resize_balloon", { width, height, contentKey })
        .then(() => {
          if (active) setMeasuredKey(contentKey);
        })
        .catch((cause: unknown) => {
          if (active) {
            previousSize = "";
            onError(errorText(cause));
          }
        });
    }
    function schedule(): void {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    }
    const observer = new ResizeObserver(schedule);
    // Force layout so CSS font faces used by this text begin loading before waiting.
    element.getBoundingClientRect();
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (!active) return;
      observer.observe(element);
      // Hidden WebViews may suspend animation frames; the first measurement must not wait for one.
      measure();
    });
    return () => {
      active = false;
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [native, contentKey, imageReady, fontKey, onError]);
  return { elementRef, ready: !native || measuredKey === contentKey };
}
