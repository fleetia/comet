import { useEffect, useState, type ReactElement } from "react";
import { Icon } from "@comet/icon";
import type { WidgetView } from "../types";
import { FocusSettingsPreview } from "../PlanningTools/FocusSettingsPreview";
import { localDay, record, rows, text, type ToolAction } from "../toolData";
import * as s from "./widgetPreview.css";

export function WidgetDetailPreview({
  widget,
  act,
  disabled,
  onBusyChange,
}: {
  widget: WidgetView;
  act?: ToolAction;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
}): ReactElement | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (widget.kind !== "clock") return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [widget.kind]);
  const data = record(widget.data);
  if (widget.kind === "focus-timer" && act) {
    return (
      <FocusSettingsPreview
        key={widget.id}
        widget={widget}
        act={act}
        disabled={disabled}
        onBusyChange={onBusyChange}
      />
    );
  }
  if (widget.kind === "clock") {
    const day = rows(data.anniversaries)[0];
    const difference = day
      ? Math.round(
          (Date.parse(`${text(day.date)}T00:00:00Z`) -
            Date.parse(`${localDay(new Date(now))}T00:00:00Z`)) /
            86400000,
        )
      : 0;
    return (
      <div className={s.preview} aria-label="시계 미리보기">
        <div className={s.clockLine}>
          <time className={s.number}>
            {new Date(now).toLocaleTimeString("ko-KR", {
              hour: "numeric",
              minute: "2-digit",
              hour12: data.format === "12h",
            })}
          </time>
          <span>
            {new Date(now).toLocaleDateString("ko-KR", {
              month: "long",
              day: "numeric",
              weekday: "short",
            })}
          </span>
        </div>
        {day && (
          <div className={s.anniversary}>
            <Icon name="clock" size={14} />
            <span>{text(day.title)}</span>
            <strong>
              {difference === 0 ? "D-day" : difference > 0 ? `D-${difference}` : `D+${-difference}`}
            </strong>
          </div>
        )}
      </div>
    );
  }
  if (widget.kind === "weather") {
    const observation = record(data.observation);
    const code = typeof observation.weatherCode === "number" ? observation.weatherCode : -1;
    const condition =
      code < 0
        ? "상태 확인 불가"
        : code === 0
          ? "맑음"
          : code <= 3
            ? "구름·흐림"
            : code <= 48
              ? "안개"
              : code <= 67
                ? "비"
                : code <= 77
                  ? "눈"
                  : code <= 82
                    ? "소나기"
                    : code <= 86
                      ? "눈 소나기"
                      : "뇌우";
    return (
      <div className={s.preview} aria-label="날씨 미리보기">
        <div className={s.caption}>
          <Icon name="cloud" size={14} />
          <span>날씨</span>
          <span>{text(observation.name) || text(record(data.config).name)}</span>
        </div>
        <div className={s.weatherLine}>
          <strong className={s.number}>
            {typeof observation.temperature === "number"
              ? `${observation.temperature}${text(observation.temperatureUnit)}`
              : "—"}
          </strong>
          <span>{data.observation ? condition : "지역을 설정해 주세요"}</span>
          <Icon name="cloud" size={30} />
        </div>
        {data.status !== "ready" && data.observation && (
          <p className={s.stale}>이전 정보 · 갱신이 필요해요</p>
        )}
      </div>
    );
  }
  return null;
}
