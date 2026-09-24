import { useEffect, useMemo, useState } from "react";

const segmenter = new Intl.Segmenter("ko", { granularity: "grapheme" });

export function useTypewriter(id: string, text: string, speed: number, ready: boolean): string {
  const letters = useMemo(
    () => Array.from(segmenter.segment(text), ({ segment }) => segment),
    [text],
  );
  const [progress, setProgress] = useState({ id, count: 0 });
  useEffect(() => {
    if (!ready || speed <= 0) return;
    let frame = 0;
    const start = performance.now();
    function advance(now: number): void {
      const count = Math.min(letters.length, 1 + Math.floor(((now - start) * speed) / 1000));
      setProgress({ id, count });
      if (count < letters.length) frame = window.requestAnimationFrame(advance);
    }
    frame = window.requestAnimationFrame(advance);
    return () => window.cancelAnimationFrame(frame);
  }, [id, letters, speed, ready]);
  if (speed <= 0) return text;
  if (!ready || progress.id !== id) return "";
  return letters.slice(0, progress.count).join("");
}
