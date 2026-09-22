import { FormField, Button, TextField } from "@fleetia/lagrange";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { record, rows, text, number, type DataRecord } from "../toolData";
import { useConnectionCommand } from "../useConnectionCommand";
import type { WidgetValue, WidgetView } from "../types";
import { MusicTool } from "../MusicTool/MusicTool";
import { MusicSettings } from "../MusicTool/MusicSettings";
import * as c from "../../lagrange.css";
import * as s from "../tools.css";
function stamp(value: WidgetValue | undefined): string {
  return typeof value === "number" ? new Date(value).toLocaleString() : "아직 조회하지 않았어요";
}
function weatherLabel(code: number): string {
  if (code === 0) {
    return "맑음";
  }
  if (code <= 3) {
    return "구름·흐림";
  }
  if (code <= 48) {
    return "안개";
  }
  if (code <= 67) {
    return "비";
  }
  if (code <= 77) {
    return "눈";
  }
  if (code <= 82) {
    return "소나기";
  }
  if (code <= 86) {
    return "눈 소나기";
  }
  return "뇌우";
}
type Props = {
  widget: WidgetView;
  mode?: "settings" | "tool";
  onDirtyChange?: (dirty: boolean) => void;
};
export function ConnectionTool(props: Props): ReactElement {
  if (props.widget.kind === "music") {
    return props.mode === "settings" ? (
      <MusicSettings widget={props.widget} onDirtyChange={props.onDirtyChange} />
    ) : (
      <MusicTool widget={props.widget} />
    );
  }
  return <InformationConnectionTool {...props} />;
}
function InformationConnectionTool({ widget, mode = "tool", onDirtyChange }: Props): ReactElement {
  const d = record(widget.data),
    observation = record(d.observation);
  const { busy, error, run } = useConnectionCommand();
  const [regionDirty, setRegionDirty] = useState(false);
  useEffect(() => {
    onDirtyChange?.(mode === "settings" && regionDirty);
  }, [regionDirty, mode, onDirtyChange]);
  const stale = d.status !== "ready";
  return (
    <fieldset className={s.body} disabled={busy}>
      {error && (
        <p role="alert" className={c.error}>
          {error}
        </p>
      )}
      {text(d.error) && <p className={c.error}>{text(d.error)}</p>}
      {d.status === "unsupported" && (
        <p role="status">이 운영체제에서는 해당 연결을 지원하지 않습니다.</p>
      )}
      {mode === "tool" && d.observation && (
        <section className={s.item} aria-label="마지막 조회 정보">
          {stale && <p className={c.error}>이전 정보 · 현재 상태를 확인하지 못했어요.</p>}
          {widget.kind === "weather" && (
            <>
              <h2>{text(observation.name)}</h2>
              <p className={s.number}>
                {typeof observation.temperature === "number"
                  ? `${observation.temperature}${text(observation.temperatureUnit)}`
                  : "온도 정보 없음"}
              </p>
              <p>{weatherLabel(number(observation.weatherCode))} · 기상 모델 정보</p>
              <p className={c.quiet}>모델 시각: {stamp(observation.observedAt)}</p>
              <p className={c.quiet}>
                {text(observation.attribution) || "Weather data by Open-Meteo (CC BY 4.0)"}
              </p>
            </>
          )}
          {widget.kind === "device" && (
            <>
              {observation.hasBattery === false ? (
                <p>이 기기에는 조회 가능한 배터리가 없어요.</p>
              ) : (
                rows(observation.batteries).map((battery, index) => (
                  <p key={index}>
                    배터리 {index + 1}:{" "}
                    {typeof battery.percent === "number" ? `${battery.percent}%` : "잔량 확인 불가"}{" "}
                    ·{" "}
                    {{
                      charging: "충전 중",
                      discharging: "배터리 사용 중",
                      charged: "충전 완료",
                      "not-charging": "충전 안 함",
                      ac: "외부 전원",
                      unknown: "상태 확인 불가",
                    }[text(battery.status)] || "상태 확인 불가"}
                  </p>
                ))
              )}
              <p className={c.quiet}>
                전원:{" "}
                {observation.powerSource === "ac"
                  ? "외부 전원"
                  : observation.powerSource === "battery"
                    ? "배터리"
                    : "확인 불가"}
              </p>
            </>
          )}
          <p className={c.quiet}>마지막 조회 성공: {stamp(d.lastSuccessAt)}</p>
        </section>
      )}
      {mode === "tool" && d.configured === true && (
        <>
          <Button
            variant="primary"
            onClick={() => void run("refresh_connection_widget", { id: widget.id })}
          >
            정보 다시 조회
          </Button>
          <p className={c.quiet}>
            최소 조회 간격:{" "}
            {widget.kind === "weather" ? "30분" : widget.kind === "music" ? "15초" : "1분"}
          </p>
          {!d.observation && <p>아직 성공적으로 조회한 정보가 없어요.</p>}
        </>
      )}
      {mode === "settings" && widget.kind === "weather" && (
        <section className={s.section} aria-label="날씨 지역 설정">
          <h2 className={s.sectionTitle}>{d.configured === true ? "지역 변경" : "지역 선택"}</h2>
          <WeatherRegion id={widget.id} run={run} onDirtyChange={setRegionDirty} />
        </section>
      )}
      {mode === "settings" && widget.kind === "device" && d.configured !== true && (
        <>
          <p>이 기기의 배터리 잔량과 전원 상태를 읽습니다. macOS와 Windows에서 지원합니다.</p>
          <Button
            variant="primary"
            onClick={() => void run("configure_connection_widget", { id: widget.id, input: {} })}
          >
            기기 정보 조회 허용
          </Button>
        </>
      )}
      {mode === "tool" && d.configured !== true && <p>설정창의 위젯에서 연결을 설정해 주세요.</p>}
      {mode === "settings" && widget.kind === "device" && d.configured === true && (
        <p>이 기기의 배터리와 전원 정보 조회를 허용했습니다.</p>
      )}
      {busy && <p role="status">연결 정보를 처리하고 있어요.</p>}
    </fieldset>
  );
}
function WeatherRegion({
  id,
  run,
  onDirtyChange,
}: {
  id: string;
  run: (name: string, args: Record<string, unknown>) => Promise<boolean>;
  onDirtyChange: (dirty: boolean) => void;
}): ReactElement {
  const [query, setQuery] = useState(""),
    [results, setResults] = useState<DataRecord[] | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const pending = useRef(false);
  useEffect(() => {
    onDirtyChange(query.length > 0);
  }, [query, onDirtyChange]);
  async function search(): Promise<void> {
    if (!isDesktop()) {
      setError("지역 검색과 연결은 데스크톱 앱에서 사용할 수 있어요.");
      return;
    }
    if (pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const response = await command<WidgetValue>("search_weather_regions", { query });
      setResults(rows(response));
    } catch (cause: unknown) {
      setError(errorText(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section className={s.section}>
      <p className={c.quiet}>
        위치를 자동 추측하지 않아요. 입력한 지역 이름을 Open-Meteo에 검색합니다.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <FormField className={c.field} label="지역 이름" required>
          <TextField
            disabled={busy}
            minLength={2}
            maxLength={100}

            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setResults(null);
            }}
          />
        </FormField>
        <Button type="submit" variant="secondary" disabled={busy}>
          지역 검색
        </Button>
      </form>
      {error && (
        <p role="alert" className={c.error}>
          {error}
        </p>
      )}
      {results?.length === 0 && <p>검색한 지역이 없어요. 다른 이름으로 검색해 주세요.</p>}
      {results?.map((region) => (
        <Button
          variant="secondary"
          key={number(region.id)}
          onClick={async () => {
            if (
              await run("configure_connection_widget", {
                id,
                input: {
                  name: text(region.name),
                  latitude: number(region.latitude),
                  longitude: number(region.longitude),
                },
              })
            ) {
              setQuery("");
              setResults(null);
            }
          }}
        >
          {text(region.name)} · {text(region.admin1)} · {text(region.country)} 선택
        </Button>
      ))}
      {query && (
        <Button
          variant="quiet"
          disabled={busy}
          onClick={() => {
            setQuery("");
            setResults(null);
          }}
        >
          지역 입력 지우기
        </Button>
      )}
      {busy && <p role="status">지역을 검색하고 있어요.</p>}
    </section>
  );
}
