import { useLayoutEffect, useRef, type RefObject } from "react";

export function useSlidingIndicator(selector: string): {
  containerRef: RefObject<HTMLDivElement | null>;
  indicatorRef: RefObject<HTMLSpanElement | null>;
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (!container || !indicator) {
      return;
    }
    let isDisposed = false;
    let resetTimeout: number | undefined;
    const update = (): void => {
      if (isDisposed) {
        return;
      }
      const selected = container.querySelector<HTMLElement>(selector);
      indicator.hidden = !selected;
      container.toggleAttribute("data-indicator-ready", !!selected);
      if (!selected) {
        return;
      }
      indicator.style.transform = `translateX(${selected.offsetLeft}px)`;
      indicator.style.top = `${selected.offsetTop}px`;
      indicator.style.width = `${selected.offsetWidth}px`;
      indicator.style.height = `${selected.offsetHeight}px`;
      indicator.toggleAttribute(
        "data-disabled",
        selected.matches(":disabled") || !!selected.querySelector(":disabled"),
      );
    };
    function scheduleUpdate(): void {
      // Read after React's controlled radio restoration.
      queueMicrotask(update);
    }
    function scheduleResetUpdate(): void {
      // Trusted reset events may run microtasks before restoring native defaults.
      window.clearTimeout(resetTimeout);
      resetTimeout = window.setTimeout(update, 0);
    }
    update();
    const observer = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(update);
    observer?.observe(container);
    for (const child of container.children) {
      if (child !== indicator) {
        observer?.observe(child);
      }
    }
    const input = container.querySelector<HTMLInputElement>('input[type="radio"]');
    const form = input?.form;
    const changeRoot = container.ownerDocument;
    function handleRadioChange(event: Event): void {
      const target = event.target;
      if (
        !(target instanceof HTMLInputElement) ||
        target.type !== "radio" ||
        !input ||
        target.name !== input.name ||
        target.form !== input.form
      ) {
        return;
      }
      scheduleUpdate();
    }
    if (input) {
      changeRoot.addEventListener("change", handleRadioChange);
    }
    form?.addEventListener("reset", scheduleResetUpdate);
    window.addEventListener("resize", update);
    return () => {
      isDisposed = true;
      window.clearTimeout(resetTimeout);
      observer?.disconnect();
      changeRoot.removeEventListener("change", handleRadioChange);
      form?.removeEventListener("reset", scheduleResetUpdate);
      window.removeEventListener("resize", update);
    };
  });

  return { containerRef, indicatorRef };
}
