import type { ReactElement } from "react";
import { Icon } from "@comet/icon";
import type { WidgetView } from "../types";
import { record, rows, text } from "../toolData";
import * as toy from "../ToyTools/toyTools.css";
import * as s from "../ToyTools/playWidgets.css";

/** Marble slots from Figma's twelve-marble jar, filled bottom row first. */
const MARBLES = [
  [30, 66, "#FF9F85"],
  [42, 70, "#FFCC33"],
  [54, 66, "#77D9CA"],
  [66, 70, "#B6A0EA"],
  [36, 56, "#79AFFF"],
  [48, 58, "#FF8BC4"],
  [60, 56, "#FF9F85"],
  [66, 58, "#B6A0EA"],
  [30, 52, "#79AFFF"],
  [54, 48, "#77D9CA"],
  [42, 46, "#FFCC33"],
  [48, 38, "#FF8BC4"],
] as const;

function Jar({ count }: { count: number }): ReactElement {
  return (
    <svg className={s.jar} viewBox="0 0 96 86" fill="none" aria-hidden="true">
      <path
        d="M59 6H37a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3h22a3 3 0 0 0 3-3V9a3 3 0 0 0-3-3Z"
        fill="#C8A983"
      />
      <path
        d="M36 15h24v6c9 4 14 11 14 22v28a9 9 0 0 1-9 9H31a9 9 0 0 1-9-9V43c0-11 5-18 14-22v-6Z"
        fill="#EEF1FF"
        fillOpacity="0.12"
        stroke="#EEF1FF"
        strokeOpacity="0.55"
        strokeWidth="1.5"
      />
      {MARBLES.slice(0, count).map(([x, y, fill]) => (
        <g key={`${x}-${y}`}>
          <circle cx={x} cy={y} r="5.5" fill={fill} />
          <circle cx={x - 1.6} cy={y - 1.8} r="1.4" fill="white" fillOpacity="0.7" />
        </g>
      ))}
    </svg>
  );
}

export function CompletionJarTool({ widget }: { widget: WidgetView }): ReactElement {
  const completed = rows(record(widget.data).completed);
  const recent = completed
    .slice(0, 2)
    .map((item) => text(item.title))
    .filter(Boolean);
  return (
    <section className={toy.card} aria-label="모은 구슬">
      <header className={s.jarHeader}>
        <Icon name="marble" size={15} className={toy.icon} />
        <h2 className={toy.heading}>모은 구슬</h2>
        <span className={s.jarCount} aria-label="완료 구슬 수">
          {completed.length}
        </span>
      </header>
      <div className={s.jarBody}>
        <Jar count={Math.min(completed.length, MARBLES.length)} />
        <p className={s.recent}>
          {recent.length > 0
            ? `최근 · ${recent.join(", ")}`
            : "할 일을 직접 완료하면 구슬이 하나씩 모여요."}
        </p>
      </div>
    </section>
  );
}
