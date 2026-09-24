import { useEffect, useState } from "react";
import type { AnimationBinding, AnimationClip } from "../types";

type Options = {
  clip: AnimationClip | undefined;
  binding: Pick<AnimationBinding, "repeat" | "intervalMs"> | undefined;
  runKey: string;
  enabled: boolean;
  ready: boolean;
};
type Progress = { frameIndex: number | null; finished: boolean };

export function useAnimationPlayer({ clip, binding, runKey, enabled, ready }: Options): Progress {
  const count = clip?.frames.length ?? 0;
  const fps = clip?.fps ?? 8;
  const repeat = binding?.repeat ?? false;
  const interval = binding?.intervalMs ?? 0;
  const key = JSON.stringify([runKey, clip, repeat, interval, enabled, ready]);
  const [state, setState] = useState<Progress & { key: string }>({
    key: "",
    frameIndex: null,
    finished: false,
  });
  useEffect(() => {
    if (!enabled || !ready || count === 0) return;
    let timer = 0;
    const started = performance.now();
    const duration = (count * 1000) / fps;
    const cycle = duration + interval;
    function advance(): void {
      const elapsed = performance.now() - started;
      const finished = !repeat && elapsed >= duration;
      const position = repeat ? elapsed % cycle : elapsed;
      const frameIndex =
        finished || position >= duration
          ? null
          : Math.min(count - 1, Math.floor((position * fps) / 1000));
      setState((previous) =>
        previous.key === key && previous.frameIndex === frameIndex && previous.finished === finished
          ? previous
          : { key, frameIndex, finished },
      );
      if (!finished) {
        const next =
          position >= duration
            ? cycle - position
            : ((Math.floor((position * fps) / 1000) + 1) * 1000) / fps - position;
        timer = window.setTimeout(advance, Math.max(1, Math.ceil(next)));
      }
    }
    advance();
    return () => window.clearTimeout(timer);
  }, [key, count, fps, repeat, interval, enabled, ready]);
  if (!enabled || !ready || !count) return { frameIndex: null, finished: false };
  return state.key === key ? state : { frameIndex: 0, finished: false };
}
