import type { JSX } from "react";
import trail1 from "./assets/focus-comet-trail-1.svg";
import trail2 from "./assets/focus-comet-trail-2.svg";
import trail3 from "./assets/focus-comet-trail-3.svg";
import trail4 from "./assets/focus-comet-trail-4.svg";
import trail5 from "./assets/focus-comet-trail-5.svg";

const segments = [
  { src: trail1, x: 177.14, y: 84.68, width: 3.3573, height: 11.8901 },
  { src: trail2, x: 175.86, y: 75.87, width: 4.28039, height: 11.8104 },
  { src: trail3, x: 173.66, y: 67.25, width: 5.20069, height: 11.6207 },
  { src: trail4, x: 170.58, y: 58.91, width: 6.08079, height: 11.3408 },
  { src: trail5, x: 166.64, y: 50.93, width: 6.94065, height: 10.9807 },
];

export function TimerCometTrail({
  center,
  radius,
  angle,
}: {
  center: number;
  radius: number;
  angle: number;
}): JSX.Element {
  // The original 188px dial centers at (94, 94), with its comet at (179, 95.1).
  const rotation = ((angle - Math.atan2(1.1, 85)) * 180) / Math.PI;
  const scale = radius / Math.hypot(85, 1.1);
  return (
    <g
      aria-hidden
      pointerEvents="none"
      transform={`translate(${center} ${center}) rotate(${rotation}) scale(${scale}) translate(-94 -94)`}
    >
      {segments.map(({ src, ...bounds }) => (
        <image key={src} href={src} {...bounds} />
      ))}
    </g>
  );
}
