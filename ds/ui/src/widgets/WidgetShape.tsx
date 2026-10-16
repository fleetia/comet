import { useId, type CSSProperties, type ReactElement } from "react";
import { SHAPE_PATHS } from "./shapePaths";
import shape01 from "./assets/shapes/01.svg";
import shape02 from "./assets/shapes/02.svg";
import shape03 from "./assets/shapes/03.svg";
import shape04 from "./assets/shapes/04.svg";
import shape05 from "./assets/shapes/05.svg";
import shape06 from "./assets/shapes/06.svg";
import shape07 from "./assets/shapes/07.svg";
import shape08 from "./assets/shapes/08.svg";
import shape09 from "./assets/shapes/09.svg";
import shape10 from "./assets/shapes/10.svg";
import shape11 from "./assets/shapes/11.svg";
import shape12 from "./assets/shapes/12.svg";
import shape13 from "./assets/shapes/13.svg";
import shape14 from "./assets/shapes/14.svg";
import shape15 from "./assets/shapes/15.svg";
import shape16 from "./assets/shapes/16.svg";
import shape17 from "./assets/shapes/17.svg";
import shape18 from "./assets/shapes/18.svg";
import shape19 from "./assets/shapes/19.svg";
import shape20 from "./assets/shapes/20.svg";
import shape21 from "./assets/shapes/21.svg";
import shape22 from "./assets/shapes/22.svg";
import circleShape from "../choices/assets/widget-circle.svg";
import cloudShape from "../choices/assets/widget-cloud.svg";
const shapeIcons = {
  "01": shape01,
  "02": shape02,
  "03": shape03,
  "04": shape04,
  "05": shape05,
  "06": shape06,
  "07": shape07,
  "08": shape08,
  "09": shape09,
  "10": shape10,
  "11": shape11,
  "12": shape12,
  "13": shape13,
  "14": shape14,
  "15": shape15,
  "16": shape16,
  "17": shape17,
  "18": shape18,
  "19": shape19,
  "20": shape20,
  "21": shape21,
  "22": shape22,
  circle: circleShape,
  cloud: cloudShape,
};

export type ShapePreset = keyof typeof SHAPE_PATHS | "default";
export type ShapePoint = { x: number; y: number };
export type WidgetShape = {
  source: "preset" | "drawing" | "image";
  preset: ShapePreset;
  cloudCount: number;
  roundness: number;
  rotation: number;
  flipX: boolean;
  flipY: boolean;
  fitContent: boolean;
  width: number;
  height: number;
  strokes: ShapePoint[][];
};
export type FreeformAppearanceProps = {
  shape?: WidgetShape;
  backgroundImage?: string;
  backgroundColor?: string;
  textColor?: string;
  contentStyle?: CSSProperties;
  imagePosition?: string;
  /** Vector preset drawn instead of the artwork once a `default` shape is recoloured or filled. */
  fallbackPreset?: Exclude<ShapePreset, "default">;
};
export const SHAPE_GROUPS = [
  {
    label: "기본",
    items: [
      ["12", "사각형"],
      ["01", "둥근 사각형"],
      ["13", "캡슐"],
      ["circle", "원"],
      ["02", "타원"],
      ["14", "접힌 종이"],
    ],
  },
  {
    label: "둥근",
    items: [
      ["03", "아치"],
      ["15", "잎"],
      ["cloud", "구름"],
      ["04", "조약돌"],
      ["16", "꽃"],
      ["05", "물방울"],
    ],
  },
  {
    label: "각진",
    items: [
      ["17", "삼각형"],
      ["06", "마름모"],
      ["18", "오각형"],
      ["07", "육각형"],
      ["19", "팔각형"],
      ["08", "방패"],
    ],
  },
  {
    label: "재미",
    items: [
      ["20", "하트"],
      ["09", "별"],
      ["21", "말풍선"],
      ["10", "티켓"],
      ["22", "우표"],
      ["11", "책갈피"],
    ],
  },
] as const;

function cloudPath(count: number, roundness: number): string {
  const points: ShapePoint[] = [];
  const lobes = Math.max(2, Math.min(8, count));
  for (let index = 0; index <= 96; index++) {
    const angle = Math.PI + (index / 96) * Math.PI * 2;
    const radius = 9 + (1 - Math.cos(angle * lobes)) * (0.7 + roundness / 100);
    points.push({ x: 12 + Math.cos(angle) * radius, y: 12 + Math.sin(angle) * radius * 0.66 });
  }
  return pointsPath(points);
}
function pointsPath(points: readonly ShapePoint[]): string {
  return (
    points
      .map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(3)} ${point.y.toFixed(3)}`)
      .join(" ") + " Z"
  );
}
export function widgetShapePath(shape: WidgetShape): string {
  if (shape.source === "drawing" && shape.strokes.length)
    return shape.strokes
      .filter((stroke) => stroke.length >= 3)
      .map(pointsPath)
      .join(" ");
  if (shape.preset === "cloud" && (shape.cloudCount !== 4 || shape.roundness !== 70))
    return cloudPath(shape.cloudCount, shape.roundness);
  return SHAPE_PATHS[shape.preset === "default" ? "01" : shape.preset];
}
export function WidgetShapeGraphic({
  preset,
  className,
}: {
  preset: ShapePreset;
  className?: string;
}): ReactElement {
  return (
    <img
      className={className}
      width="24"
      height="24"
      src={shapeIcons[preset === "default" ? "01" : preset]}
      alt=""
    />
  );
}
export function ShapeBackground({
  shape,
  image,
  color,
  style,
  position = "center center",
}: {
  shape: WidgetShape;
  image?: string;
  color: string;
  style?: CSSProperties;
  position?: string;
}): ReactElement {
  const id = useId().replace(/:/g, "");
  const path = widgetShapePath(shape);
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      preserveAspectRatio="none"
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        transform: `rotate(${shape.rotation}deg) scale(${shape.flipX ? -1 : 1}, ${shape.flipY ? -1 : 1})`,
        ...style,
      }}
    >
      <defs>
        <clipPath id={id}>
          <path d={path} />
        </clipPath>
      </defs>
      <path
        d={path}
        fill={image ? "transparent" : color}
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="0.12"
        strokeLinejoin="round"
      />
      {image && (
        <image
          href={image}
          x="0"
          y="0"
          width="24"
          height="24"
          preserveAspectRatio={`${position.includes("left") ? "xMin" : position.includes("right") ? "xMax" : "xMid"}${position.includes("top") ? "YMin" : position.includes("bottom") ? "YMax" : "YMid"} slice`}
          clipPath={`url(#${id})`}
        />
      )}
    </svg>
  );
}
