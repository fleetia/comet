import { useEffect, useState, type ReactElement } from "react";
import { Button } from "@comet/ui";
import { Icon } from "@comet/icon";
import { record, text } from "../toolData";
import { useConnectionCommand } from "../useConnectionCommand";
import type { WidgetView } from "../types";
import { FreeformWidget } from "../WidgetDisplay/DesktopWidget";
import { weatherLookupState } from "./weatherData";
import * as s from "./weatherSettings.css";

/** The weather window shows the same desktop weather widget plus refresh and attribution. */
export function WeatherTool({ widget }: { widget: WidgetView }): ReactElement {
  const data = record(widget.data);
  const observation = record(data.observation);
  const weatherState = weatherLookupState(data);
  const { busy, error, run } = useConnectionCommand();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <section className={s.observation} aria-label="날씨">
      {!data.observation ? (
        <p className={s.caption}>
          {weatherState.lookup === "unconfigured"
            ? "설정 → 위젯 → 날씨에서 지역을 고르면 날씨를 보여 드려요."
            : weatherState.lookup === "syncing"
              ? "날씨를 확인 중이에요."
              : weatherState.lookup === "failed"
                ? "날씨를 확인하지 못했어요. 다시 확인해 주세요."
                : "아직 날씨를 확인하지 않았어요."}
        </p>
      ) : (
        <>
          <FreeformWidget widget={widget} now={now} />
          <p className={s.caption}>
            {typeof data.lastSuccessAt === "number"
              ? `${new Date(data.lastSuccessAt).toLocaleTimeString("ko-KR", {
                  hour: "numeric",
                  minute: "2-digit",
                })}에 확인`
              : weatherState.previousRegion === "checking"
                ? "새 지역 확인 중"
                : "새 지역 확인 실패"}{" "}
            · {text(observation.attribution) || "Weather data by Open-Meteo (CC BY 4.0)"}
          </p>
        </>
      )}
      {(error || text(data.error)) && (
        <p role="alert" className={s.error}>
          {error || text(data.error)}
        </p>
      )}
      <Button
        size="small"
        variant="ghost"
        disabled={busy || data.configured !== true}
        onClick={() => void run("refresh_connection_widget", { id: widget.id })}
      >
        <Icon name="habit" size={15} />
        다시 확인
      </Button>
    </section>
  );
}
