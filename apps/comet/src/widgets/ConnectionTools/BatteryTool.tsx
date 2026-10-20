import type { ReactElement } from "react";
import { Button } from "@comet/ui";
import { Icon } from "@comet/icon";
import { record, rows, text } from "../toolData";
import { useConnectionCommand } from "../useConnectionCommand";
import type { WidgetView } from "../types";
import * as toy from "../ToyTools/toyTools.css";
import * as s from "../ToyTools/playWidgets.css";

const BATTERY_STATUS: Record<string, string> = {
  charging: "충전 중",
  discharging: "배터리 사용 중",
  charged: "충전 완료",
  "not-charging": "충전 안 함",
};

function BatteryLevel({ percent, charging }: { percent: number; charging: boolean }): ReactElement {
  return (
    <svg className={s.batteryIcon} viewBox="0 0 44 22" fill="none" aria-hidden="true">
      <rect x="1" y="1" width="38" height="20" rx="5" stroke="#A9B2DA" strokeWidth="1.6" />
      <rect
        x="4"
        y="4"
        width={Math.max(2, (32 * percent) / 100)}
        height="14"
        rx="3"
        fill="#77D9CA"
      />
      <path d="M41 8v6" stroke="#A9B2DA" strokeWidth="2" strokeLinecap="round" />
      {charging && <path d="M17 6l-4 6h4l-2 5 5-7h-4l2-4h-1Z" fill="#1A1433" />}
    </svg>
  );
}

/** The battery widget asks once, then shows the latest observation and a refresh. */
export function BatteryTool({ widget }: { widget: WidgetView }): ReactElement {
  const data = record(widget.data);
  const observation = record(data.observation);
  const { busy, error, run } = useConnectionCommand();
  const device = navigator.userAgent.includes("Mac") ? "이 Mac" : "이 PC";
  const battery = rows(observation.batteries)[0];
  const percent = typeof battery?.percent === "number" ? battery.percent : null;
  const power =
    observation.powerSource === "ac"
      ? "전원 연결됨"
      : observation.powerSource === "battery"
        ? "전원 분리됨"
        : "";
  const refresh = async (): Promise<void> => {
    if (
      data.configured !== true &&
      !(await run("configure_connection_widget", { id: widget.id, input: {} }))
    )
      return;
    await run("refresh_connection_widget", { id: widget.id });
  };
  return (
    <section className={toy.card} aria-label="배터리">
      <header className={toy.header}>
        <Icon name="battery" size={15} className={toy.icon} />
        <h2 className={toy.heading}>배터리</h2>
      </header>
      {!data.observation ? (
        <p className={s.status}>
          {device}의 배터리 잔량과 전원 상태를 읽어요. macOS와 Windows에서 써요.
        </p>
      ) : observation.hasBattery === false ? (
        <p className={s.status} role="status">
          {device}에는 읽을 수 있는 배터리가 없어요.
        </p>
      ) : (
        <div className={s.battery}>
          <BatteryLevel percent={percent ?? 0} charging={text(battery?.status) === "charging"} />
          <span className={s.batteryValue}>{percent === null ? "—" : `${percent}%`}</span>
        </div>
      )}
      {data.observation && observation.hasBattery !== false && (
        <p className={s.status} role="status">
          {[BATTERY_STATUS[text(battery?.status)] ?? "상태 확인 불가", power]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {(error || text(data.error)) && (
        <p role="alert" className={toy.error}>
          {error || text(data.error)}
        </p>
      )}
      <Button
        variant={data.observation ? "ghost" : "primary"}
        className={s.wide}
        disabled={busy}
        onClick={() => void refresh()}
      >
        새로고침
      </Button>
    </section>
  );
}
