import { useEffect, useRef, type RefObject } from "react";
import { command, errorText, isDesktop } from "./useSnapshot";

export function useBalloonSizing(
  preview: boolean,
  onError: (error: string) => void,
): RefObject<HTMLElement | null> {
  const elementRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = elementRef.current;
    if (
      !element ||
      preview ||
      !isDesktop() ||
      new URLSearchParams(window.location.search).get("view") !== "balloon"
    ) {
      return;
    }
    const measuredElement = element;
    let active = true;
    let previousHeight = 0;
    let frame = 0;
    function measure(): void {
      const height = Math.min(
        520,
        Math.max(110, Math.ceil(measuredElement.getBoundingClientRect().height)),
      );
      if (height === previousHeight) {
        return;
      }
      previousHeight = height;
      void command("resize_balloon", { height }).catch((cause: unknown) => {
        if (active) {
          onError(errorText(cause));
        }
      });
    }
    function schedule(): void {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    }
    const observer = new ResizeObserver(schedule);
    observer.observe(element);
    schedule();
    return () => {
      active = false;
      observer.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [preview, onError]);
  return elementRef;
}
