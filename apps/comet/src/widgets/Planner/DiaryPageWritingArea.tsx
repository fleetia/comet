import { useLayoutEffect, useRef, type ComponentPropsWithoutRef, type ReactElement } from "react";
import * as s from "./diaryPage.css";

export function DiaryPageWritingArea({
  value,
  ...props
}: ComponentPropsWithoutRef<"textarea">): ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const area = ref.current;
    if (!area) return;
    const fit = (): void => {
      area.style.height = "auto";
      area.style.height = `${Math.max(32, area.scrollHeight)}px`;
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    let width = area.clientWidth;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      // Hidden journals become measurable on reveal; width also changes wrapping.
      // Ignore our own height changes to avoid a resize feedback loop.
      if (area.clientWidth === width) return;
      width = area.clientWidth;
      cancelAnimationFrame(frame);
      if (width > 0) frame = requestAnimationFrame(fit);
    });
    observer.observe(area);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [value]);
  return <textarea {...props} ref={ref} value={value} rows={1} className={s.writing} />;
}
