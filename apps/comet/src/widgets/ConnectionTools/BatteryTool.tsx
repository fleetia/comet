import { useEffect, useRef, useState, type ReactElement } from "react";
import { Button, Select, Switch } from "@comet/ui";
import { Icon } from "@comet/icon";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { record, rows, text, type DataRecord } from "../toolData";
import { useConnectionCommand } from "../useConnectionCommand";
import type { WidgetView } from "../types";
import * as toy from "../ToyTools/toyTools.css";
import * as s from "../ToyTools/playWidgets.css";
import * as settings from "./weatherSettings.css";

type BatteryConfig = {
  allowTalk: boolean;
  lowThreshold: number;
  criticalNotification: boolean;
};

const BATTERY_STATUS: Record<string, string> = {
  charging: "충전 중",
  discharging: "배터리 사용 중",
  charged: "충전 완료",
  "not-charging": "충전 안 함",
  "partially-charged": "일부 충전됨",
  ac: "전원 연결됨",
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
  const storedConfig = record(data.config);
  const stored: BatteryConfig = {
    allowTalk: storedConfig.allowTalk !== false,
    lowThreshold: typeof storedConfig.lowThreshold === "number" ? storedConfig.lowThreshold : 20,
    criticalNotification: storedConfig.criticalNotification === true,
  };
  const [draft, setDraft] = useState<BatteryConfig | null>(null);
  const [permission, setPermission] = useState("unknown");
  const [permissionBusy, setPermissionBusy] = useState(false);
  const [permissionError, setPermissionError] = useState("");
  const permissionPending = useRef(false);
  const permissionGeneration = useRef(0);
  const config = draft ?? stored;
  const observation = record(data.observation);
  const { busy, error, run } = useConnectionCommand();
  useEffect(() => {
    const generation = ++permissionGeneration.current;
    if (isDesktop()) {
      void command<string>("get_planner_notification_permission")
        .then((value) => {
          if (permissionGeneration.current === generation) setPermission(value);
        })
        .catch(() => {});
    }
    return () => {
      permissionGeneration.current += 1;
    };
  }, []);
  useEffect(() => {
    if (
      draft &&
      draft.allowTalk === stored.allowTalk &&
      draft.lowThreshold === stored.lowThreshold &&
      draft.criticalNotification === stored.criticalNotification
    ) {
      setDraft(null);
    }
  }, [draft, stored.allowTalk, stored.lowThreshold, stored.criticalNotification]);
  const device = navigator.userAgent.includes("Mac") ? "이 Mac" : "이 PC";
  const battery = rows(observation.batteries).reduce<DataRecord | undefined>(
    (lowest, current) => {
      const value = typeof current.percent === "number" ? current.percent : 101;
      const previous = typeof lowest?.percent === "number" ? lowest.percent : 101;
      return !lowest || value < previous ? current : lowest;
    },
    undefined,
  );
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
  async function save(next: BatteryConfig): Promise<void> {
    setDraft(next);
    if (!(await run("configure_connection_widget", { id: widget.id, input: next }))) {
      setDraft(null);
    }
  }
  async function enableNotification(): Promise<void> {
    if (permissionPending.current) return;
    if (!isDesktop()) {
      setPermissionError("OS 알림은 데스크톱 앱에서 사용할 수 있어요.");
      return;
    }
    permissionPending.current = true;
    setPermissionBusy(true);
    setPermissionError("");
    const generation = ++permissionGeneration.current;
    try {
      let value = await command<string>("get_planner_notification_permission");
      if (value === "prompt") {
        value = await command<string>("request_planner_notification_permission");
      }
      if (permissionGeneration.current !== generation) return;
      setPermission(value);
      await save({ ...config, criticalNotification: true });
    } catch (cause: unknown) {
      if (permissionGeneration.current === generation) setPermissionError(errorText(cause));
    } finally {
      permissionPending.current = false;
      if (permissionGeneration.current === generation) setPermissionBusy(false);
    }
  }
  return (
    <section className={toy.card} aria-label="배터리">
      <header className={toy.header}>
        <Icon name="battery" size={15} className={toy.icon} />
        <h2 className={toy.heading}>배터리</h2>
      </header>
      {!data.observation ? (
        <p className={s.status}>
          새로고침을 누르면 {device}의 배터리 잔량과 전원 상태를 주기적으로 확인해요. macOS와
          Windows에서 써요.
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
      {(error || permissionError || text(data.error)) && (
        <p role="alert" className={toy.error}>
          {error || permissionError || text(data.error)}
        </p>
      )}
      <Button
        variant={data.observation ? "ghost" : "primary"}
        className={s.wide}
        disabled={busy || permissionBusy}
        onClick={() => void refresh()}
      >
        새로고침
      </Button>
      <fieldset
        className={settings.settings}
        disabled={busy || permissionBusy || data.configured !== true}
      >
        <div className={settings.group}>
          <div className={settings.row}>
            <span className={settings.copy}>캐릭터가 배터리 얘기하기</span>
            <Switch
              aria-label="캐릭터가 배터리 얘기하기"
              checked={config.allowTalk}
              onChange={(event) => void save({ ...config, allowTalk: event.target.checked })}
            />
          </div>
          <div className={settings.row}>
            <span className={settings.copy}>낮은 배터리 기준</span>
            <Select
              aria-label="낮은 배터리 기준"
              value={config.lowThreshold}
              onChange={(event) =>
                void save({ ...config, lowThreshold: Number(event.target.value) })
              }
            >
              {Array.from({ length: 41 }, (_, index) => index + 10).map((percent) => (
                <option key={percent} value={percent}>
                  {percent}%
                </option>
              ))}
            </Select>
          </div>
          <div className={settings.row}>
            <span className={settings.copy}>위험 수준은 OS 알림도</span>
            <Switch
              aria-label="위험 수준은 OS 알림도"
              checked={config.criticalNotification}
              onChange={(event) => {
                if (event.target.checked) {
                  void enableNotification();
                } else {
                  void save({ ...config, criticalNotification: false });
                }
              }}
            />
          </div>
        </div>
      </fieldset>
      {config.criticalNotification && permission === "denied" && (
        <p className={s.status}>OS 알림이 꺼져 있어요. 시스템 설정에서 허용해 주세요.</p>
      )}
      {config.criticalNotification && (permission === "prompt" || permission === "unknown") && (
        <Button
          variant="ghost"
          disabled={busy || permissionBusy}
          onClick={() => void enableNotification()}
        >
          OS 알림 권한 확인
        </Button>
      )}
      {data.configured !== true && (
        <p className={s.status}>새로고침으로 조회를 허용한 뒤 설정할 수 있어요.</p>
      )}
    </section>
  );
}
