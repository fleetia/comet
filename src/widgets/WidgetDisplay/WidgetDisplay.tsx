import { IconButton } from "@fleetia/lagrange";
import { useEffect, useState, type ReactElement } from "react";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { useWindowDrag } from "../../hooks/useWindowDrag";
import { useWidgets } from "../useWidgets";
import { localDay, number, record, rows, text } from "../toolData";
import type { WidgetView } from "../types";
import {
  backgroundPosition,
  getWidgetAppearance,
  placementAlignment,
  widgetBackgroundUrl,
} from "../widgetAppearance";
import * as s from "./widgetDisplay.css";

function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function dayDifference(date: string, now: number): number {
  const today = Date.parse(`${localDay(new Date(now))}T00:00:00Z`);
  return Math.round((Date.parse(`${date}T00:00:00Z`) - today) / 86400000);
}

function dDayLabel(difference: number): string {
  if (difference === 0) {
    return "D-day";
  }
  return difference > 0 ? `D-${difference}` : `D+${-difference}`;
}

function weatherLabel(code: number): string {
  if (code === 0) return "맑음";
  if (code <= 3) return "구름·흐림";
  if (code <= 48) return "안개";
  if (code <= 67) return "비";
  if (code <= 77) return "눈";
  if (code <= 82) return "소나기";
  if (code <= 86) return "눈 소나기";
  return "뇌우";
}

function batteryStatus(status: string): string {
  return (
    {
      charging: "충전 중",
      discharging: "배터리 사용 중",
      charged: "충전 완료",
      "not-charging": "충전 안 함",
      ac: "외부 전원",
      unknown: "상태 확인 불가",
    }[status] ?? "상태 확인 불가"
  );
}

function DisplayContent({ widget, now }: { widget: WidgetView; now: number }): ReactElement {
  const data = record(widget.data);
  if (widget.kind === "clock") {
    const anniversaries = rows(data.anniversaries);
    return anniversaries.length > 0 ? (
      <div className={s.list}>
        {anniversaries.map((item) => (
          <div className={s.item} key={text(item.id)}>
            <strong>{text(item.title)}</strong>
            <span>{dDayLabel(dayDifference(text(item.date), now))}</span>
          </div>
        ))}
      </div>
    ) : (
      <p>기념일을 설정해 주세요.</p>
    );
  }
  const observation = record(data.observation);
  if (widget.kind === "weather") {
    if (!data.observation) {
      return <p>날씨를 조회하면 여기에 보여요.</p>;
    }
    return (
      <div className={s.list}>
        {data.status !== "ready" && <span className={s.stale}>이전 정보</span>}
        <strong>{text(observation.name)}</strong>
        <span className={s.metric}>
          {typeof observation.temperature === "number"
            ? `${observation.temperature}${text(observation.temperatureUnit)}`
            : "온도 정보 없음"}
        </span>
        <span>{weatherLabel(number(observation.weatherCode))}</span>
      </div>
    );
  }
  if (widget.kind === "device") {
    if (observation.hasBattery === false) {
      return <p>배터리 정보를 찾지 못했어요.</p>;
    }
    const batteries = rows(observation.batteries);
    return batteries.length > 0 ? (
      <div className={s.list}>
        {batteries.map((battery, index) => (
          <div className={s.item} key={index}>
            <strong>배터리 {index + 1}</strong>
            <span className={s.metric}>
              {typeof battery.percent === "number" ? `${battery.percent}%` : "—"}
            </span>
            <span>{batteryStatus(text(battery.status))}</span>
          </div>
        ))}
      </div>
    ) : (
      <p>배터리 정보를 아직 조회하지 않았어요.</p>
    );
  }
  return <p>이 위젯은 바탕화면 표시를 지원하지 않아요.</p>;
}

export function WidgetDisplay({ id }: { id: string }): ReactElement {
  const { snapshot, error } = useWidgets();
  const [dragError, setDragError] = useState<string | null>(null);
  const now = useNow();
  const widget = snapshot?.widgets.find((item) => item.id === id);
  const entry = snapshot?.catalog.find((item) => item.id === widget?.kind);
  const appearance = getWidgetAppearance(widget?.data ?? {});
  const imageUrl = widget ? widgetBackgroundUrl(widget) : null;
  const drag = useWindowDrag(isDesktop(), setDragError);

  if (!snapshot || !widget) {
    return (
      <main className={s.loading} role="status">
        {error || "표시를 불러오고 있어요."}
      </main>
    );
  }
  const alignment = placementAlignment(appearance.textPosition);
  return (
    <main
      className={s.frame}
      aria-label={entry?.name ?? "위젯 표시"}
      onPointerDown={drag.onPointerDown}
      onPointerMove={drag.onPointerMove}
      onPointerUp={drag.reset}
      onPointerCancel={drag.reset}
      style={{
        backgroundColor: appearance.backgroundColor,
        backgroundImage: imageUrl ? `url("${imageUrl}")` : undefined,
        backgroundPosition: backgroundPosition(appearance.backgroundPosition),
        color: appearance.textColor,
        ...alignment,
      }}
    >
      <IconButton
        className={s.close}
        variant="quiet"
        size="compact"
        label="바탕화면 위젯 닫기"
        disabled={!isDesktop()}
        onPointerDown={(event) => event.stopPropagation()}
        onClick={() => {
          void command("close_widget_display", { id }).catch((cause: unknown) =>
            setDragError(errorText(cause)),
          );
        }}
      >
        ×
      </IconButton>
      <div className={s.content}>
        <DisplayContent widget={widget} now={now} />
      </div>
      {(dragError || error) && <p className={s.error}>{dragError || error}</p>}
    </main>
  );
}
