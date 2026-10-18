import { useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { command, errorText, isDesktop } from "./useSnapshot";

type OrbitAnchor = { x: number; y: number };
type BalloonPlacement = { orbitAnchor: OrbitAnchor | null };

export function useBalloonSizing(
  preview: boolean,
  contentKey: string,
  imageReady: boolean,
  fontKey: string,
  onError: (error: string) => void,
  surface?: "input",
) {
  const elementRef = useRef<HTMLElement>(null);
  const [measuredKey, setMeasuredKey] = useState<string | null>(null);
  const [orbitAnchor, setOrbitAnchor] = useState<OrbitAnchor | null>(null);
  const native =
    !preview &&
    isDesktop() &&
    new URLSearchParams(window.location.search).get("view") ===
      (surface === "input" ? "conversation-input" : "balloon");
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
    let measurementRevision = 0;
    let eventRevision = 0;
    let requestedAnchor: OrbitAnchor | null = null;
    let unlisten: (() => void) | undefined;
    void listen<BalloonPlacement & { contentKey: string }>("balloon-orbit-anchor", (event) => {
      if (!active || event.payload.contentKey !== contentKey || !requestedAnchor) return;
      if (!event.payload.orbitAnchor) return;
      eventRevision += 1;
      setOrbitAnchor(event.payload.orbitAnchor);
    })
      .then((dispose) => {
        if (active) unlisten = dispose;
        else dispose();
      })
      .catch((cause: unknown) => {
        if (active) onError(errorText(cause));
      });
    function measure(): void {
      if (!active) return;
      const rect = element!.getBoundingClientRect();
      const story = contentKey.startsWith("story:");
      const anchor = element!.querySelector<HTMLElement>("[data-character-orbit-anchor]");
      const width = Math.min(
        anchor ? 640 : surface === "input" ? 520 : 340,
        Math.max(48, Math.ceil(story ? Math.max(rect.width, element!.scrollWidth) : rect.width)),
      );
      const height = Math.min(
        anchor ? 600 : 520,
        Math.max(32, Math.ceil(story ? Math.max(rect.height, element!.scrollHeight) : rect.height)),
      );
      const anchorRect = anchor?.getBoundingClientRect();
      requestedAnchor = anchorRect
        ? {
            x: anchorRect.x + anchorRect.width / 2 - rect.x,
            y: anchorRect.y + anchorRect.height / 2 - rect.y,
          }
        : null;
      const size = `${width}:${height}:${requestedAnchor?.x ?? ""}:${requestedAnchor?.y ?? ""}`;
      if (size === previousSize) return;
      previousSize = size;
      const revision = ++measurementRevision;
      const previousEvent = eventRevision;
      if (!requestedAnchor) setOrbitAnchor(null);
      element!.style.visibility = "visible";
      void command<BalloonPlacement | undefined>("resize_balloon", {
        width,
        height,
        contentKey,
        ...(surface ? { surface } : {}),
        ...(requestedAnchor ? { orbitAnchor: requestedAnchor } : {}),
      })
        .then((placement) => {
          if (!active || revision !== measurementRevision) return;
          setMeasuredKey(contentKey);
          if (previousEvent === eventRevision) setOrbitAnchor(placement?.orbitAnchor ?? null);
        })
        .catch((cause: unknown) => {
          if (active && revision === measurementRevision) {
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
    const mutations = new MutationObserver(schedule);
    // Force layout so CSS font faces used by this text begin loading before waiting.
    element.getBoundingClientRect();
    void (document.fonts?.ready ?? Promise.resolve()).then(() => {
      if (!active) return;
      observer.observe(element);
      mutations.observe(element, { childList: true, subtree: true });
      // Hidden WebViews may suspend animation frames; the first measurement must not wait for one.
      measure();
    });
    return () => {
      active = false;
      observer.disconnect();
      mutations.disconnect();
      unlisten?.();
      window.cancelAnimationFrame(frame);
    };
  }, [native, contentKey, imageReady, fontKey, onError, surface]);
  return { elementRef, ready: !native || measuredKey === contentKey, orbitAnchor, native };
}
