import { useLayoutEffect, useRef, type JSX, type RefObject, type CSSProperties } from "react";

type Props = {
  frames: readonly HTMLCanvasElement[] | null;
  index: number | null;
  size: number;
  label: string;
  className?: string;
  canvasRef?: RefObject<HTMLCanvasElement | null>;
  style?: CSSProperties;
};

export function AnimationFrameView({
  frames,
  index,
  size,
  label,
  className,
  canvasRef,
  style,
}: Props): JSX.Element {
  const localRef = useRef<HTMLCanvasElement>(null);
  const ref = canvasRef ?? localRef;
  const visible = index !== null && Boolean(frames?.[index]);
  useLayoutEffect(() => {
    if (!frames) {
      if (ref.current) ref.current.width = size;
      return;
    }
    const context = ref.current?.getContext("2d");
    if (!context) return;
    context.clearRect(0, 0, size, size);
    if (index !== null && frames?.[index]) context.drawImage(frames[index], 0, 0);
  }, [ref, frames, index, size]);
  return (
    <canvas
      ref={ref}
      width={size}
      height={size}
      className={className}
      role="img"
      aria-label={label}
      aria-hidden={!visible}
      style={{
        width: size,
        height: size,
        visibility: visible ? "visible" : "hidden",
        ...style,
      }}
    />
  );
}
