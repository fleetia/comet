import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@comet/icon";
import { Button, ContentChoice, SegmentedControl, Select, Switch, TextInput } from "@comet/ui";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { record, rows, text, type DataRecord } from "../toolData";
import type { WidgetView } from "../types";
import { useConnectionCommand } from "../useConnectionCommand";
import { weatherConfig, type WeatherConfig } from "./weatherData";
import * as s from "./weatherSettings.css";

export function WeatherSettings({
  widget,
  sideContainer,
  disabled = false,
  onDirtyChange,
  onBusyChange,
}: {
  widget: WidgetView;
  sideContainer?: HTMLElement | null;
  disabled?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}): ReactElement {
  const data = record(widget.data);
  const stored = weatherConfig(data);
  const [draft, setDraft] = useState<WeatherConfig | null>(null);
  const config = draft ?? stored;
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DataRecord[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [localError, setLocalError] = useState("");
  const searchPending = useRef(false);
  const current = useRef(0);
  useEffect(() => {
    current.current += 1;
    return () => {
      current.current += 1;
    };
  }, [widget.id]);
  const { busy, error, run } = useConnectionCommand();
  const locked = disabled || busy || searching;
  useEffect(() => {
    onDirtyChange?.(draft !== null || query.length > 0);
  }, [draft, query, onDirtyChange]);
  useEffect(() => {
    onBusyChange?.(busy || searching);
  }, [busy, searching, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  async function save(next: WeatherConfig): Promise<boolean> {
    setDraft(next);
    if (!next.name) return false;
    if (await run("configure_connection_widget", { id: widget.id, input: next })) {
      setDraft((current) => (current === next ? null : current));
      return true;
    }
    return false;
  }
  async function search(): Promise<void> {
    if (searchPending.current || !query.trim()) return;
    if (!isDesktop()) {
      setLocalError("지역 검색과 연결은 데스크톱 앱에서 사용할 수 있어요.");
      return;
    }
    searchPending.current = true;
    setSearching(true);
    setLocalError("");
    const generation = current.current;
    try {
      const result = rows(await command("search_weather_regions", { query }));
      if (current.current === generation) setResults(result);
    } catch (cause) {
      if (current.current === generation) setLocalError(errorText(cause));
    } finally {
      searchPending.current = false;
      if (current.current === generation) setSearching(false);
    }
  }
  async function choose(region: DataRecord): Promise<void> {
    const next = {
      ...config,
      name: text(region.name),
      latitude: Number(region.latitude),
      longitude: Number(region.longitude),
    };
    if (await save(next)) setQuery("");
  }
  function locate(): void {
    if (!navigator.geolocation) {
      setLocalError("현재 위치를 지원하지 않는 환경이에요. 지역 이름으로 검색해 주세요.");
      return;
    }
    setSearching(true);
    setLocalError("");
    const generation = current.current;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (current.current !== generation) return;
        setSearching(false);
        void choose({
          name: "현재 위치",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      () => {
        if (current.current !== generation) return;
        setSearching(false);
        setLocalError("위치 권한을 확인해 주세요. 지역 이름으로도 검색할 수 있어요.");
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 },
    );
  }
  const regions = results ?? (stored.name ? [record(data.config)] : []);
  const fetchControls = (
    <fieldset className={s.side} disabled={locked}>
      <h2 className={s.heading}>가져오기</h2>
      <div className={s.group}>
        <div className={s.row}>
          <span className={s.copy}>
            확인 간격<span className={s.caption}>최소 15분 간격이에요</span>
          </span>
          <Select
            aria-label="날씨 확인 간격"
            value={config.refreshIntervalMinutes}
            onChange={(event) =>
              void save({ ...config, refreshIntervalMinutes: Number(event.target.value) })
            }
          >
            {[15, 30, 60, 120].map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes}분마다
              </option>
            ))}
          </Select>
        </div>
        <div className={s.row}>
          <span className={s.copy}>
            지금 다시 확인
            <span className={s.caption}>
              {typeof data.lastSuccessAt === "number"
                ? `마지막 확인 ${new Date(data.lastSuccessAt).toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" })}`
                : "아직 조회하지 않았어요"}
            </span>
          </span>
          <Button
            variant="ghost"
            size="small"
            disabled={data.configured !== true}
            onClick={() => void run("refresh_connection_widget", { id: widget.id })}
          >
            <Icon name="habit" size={15} />
            다시 확인
          </Button>
        </div>
      </div>
    </fieldset>
  );
  return (
    <>
      {sideContainer ? createPortal(fetchControls, sideContainer) : fetchControls}
      <fieldset className={s.settings} disabled={locked}>
        <section className={s.section} aria-label="날씨 지역 설정">
          <h2 className={s.heading}>지역</h2>
          <form
            className={s.form}
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <span className={s.searchField}>
              <button type="submit" className={s.searchButton} aria-label="지역 검색">
                <Icon name="search" size={15} />
              </button>
              <TextInput
                aria-label="지역 이름"
                placeholder="지역 이름으로 검색"
                minLength={2}
                maxLength={100}
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setResults(null);
                }}
              />
            </span>
            <Button variant="ghost" onClick={locate}>
              <Icon name="pin" size={15} />
              현재 위치 쓰기
            </Button>
          </form>
          <div className={s.results} role="group" aria-label="지역 검색 결과">
            {regions.map((region, index) => {
              const current =
                region.latitude === stored.latitude && region.longitude === stored.longitude;
              return (
                <ContentChoice
                  key={`${String(region.id ?? region.name)}-${index}`}
                  className={s.result}
                  variant="location"
                  title={text(region.name)}
                  description={[
                    text(region.admin1),
                    text(region.country),
                    current ? "지금 지역" : "",
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                  leading={<Icon name="pin" size={16} />}
                  selected={current}
                  disabled={current}
                  aria-label={`${[text(region.name), text(region.admin1), text(region.country)].filter(Boolean).join(" · ")} ${current ? "현재 지역" : "선택"}`}
                  onClick={() => void choose(region)}
                />
              );
            })}
          </div>
          {results?.length === 0 && (
            <p className={s.caption}>검색한 지역이 없어요. 다른 이름으로 검색해 주세요.</p>
          )}
          <p className={s.caption}>
            고르면 바로 바뀌어요. 현재 위치는 이 기기의 위치 권한이 필요해요.
          </p>
        </section>
        <section className={s.section}>
          <h2 className={s.heading}>보여 줄 정보</h2>
          <div className={s.group}>
            <div className={s.row}>
              <span className={s.copy}>온도 단위</span>
              <SegmentedControl
                appearance="contained"
                label="온도 단위"
                value={config.temperatureUnit}
                options={[
                  { value: "celsius", label: "°C" },
                  { value: "fahrenheit", label: "°F" },
                ]}
                onValueChange={(value) =>
                  void save({
                    ...config,
                    temperatureUnit: value === "fahrenheit" ? "fahrenheit" : "celsius",
                  })
                }
              />
            </div>
            <div className={s.row}>
              <span className={s.copy}>체감 온도</span>
              <Switch
                aria-label="체감 온도"
                checked={config.showApparent}
                onChange={(event) => void save({ ...config, showApparent: event.target.checked })}
              />
            </div>
            <div className={s.row}>
              <span className={s.copy}>습도와 바람</span>
              <Switch
                aria-label="습도와 바람"
                checked={config.showDetails}
                onChange={(event) => void save({ ...config, showDetails: event.target.checked })}
              />
            </div>
          </div>
        </section>
        <section className={s.section}>
          <h2 className={s.heading}>대화</h2>
          <div className={s.group}>
            <div className={s.row}>
              <span className={s.copy}>
                친구들이 날씨 이야기하기
                <span className={s.caption}>비가 오면 우산을 챙기라고 말해 줘요</span>
              </span>
              <Switch
                aria-label="친구들이 날씨 이야기하기"
                checked={config.allowTalk}
                onChange={(event) => void save({ ...config, allowTalk: event.target.checked })}
              />
            </div>
          </div>
        </section>
        {(error || localError || text(data.error)) && (
          <p className={s.error} role="alert">
            {error || localError || text(data.error)}
          </p>
        )}
        {draft && !busy && (
          <Button variant="ghost" onClick={() => setDraft(null)}>
            설정 변경 취소
          </Button>
        )}
      </fieldset>
    </>
  );
}
