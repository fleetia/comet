import { useEffect, useState, type ReactElement } from "react";
import { Button, Dialog, FormField, Select, Switch, TextInput } from "@comet/ui";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { ordinalDay } from "./travelData";
import {
  DAY_COLORS,
  bounds,
  parseMapLink,
  photoPoint,
  projector,
  routes,
  tileZoom,
  tilesFor,
  toMicro,
  unprojector,
  type Coordinate,
  type Frame,
} from "./travelGeo";
import type { TravelPlan, TravelSettings, TripData } from "./travelTypes";
import * as s from "./travel.css";

const FRAME: Frame = { width: 840, height: 360, padding: 48 };

function useTiles(enabled: boolean, keys: string[]): Record<string, string> {
  const [urls, setUrls] = useState<Record<string, string>>({});
  const signature = keys.join("|");
  useEffect(() => {
    if (!enabled || !isDesktop() || !keys.length) return;
    let active = true;
    const created: string[] = [];
    void (async () => {
      for (const key of keys) {
        const [z, x, y] = key.split("/").map(Number);
        try {
          const bytes = await command<ArrayBuffer>("travel_map_tile", { z, x, y });
          if (!active) return;
          const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
          created.push(url);
          setUrls((current) => ({ ...current, [key]: url }));
        } catch {
          // Missing tiles leave the drawn map visible underneath.
        }
      }
    })();
    return () => {
      active = false;
      for (const url of created) URL.revokeObjectURL(url);
      setUrls({});
    };
    // The key list is captured by its signature.
  }, [enabled, signature]);
  return urls;
}

/** Long flights curve like the design's dashed arcs; ground moves stay straight. */
function segment(a: { x: number; y: number }, b: { x: number; y: number }, curved: boolean): string {
  if (!curved) return `M${a.x},${a.y} L${b.x},${b.y}`;
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 - Math.max(30, Math.abs(b.x - a.x) * 0.25);
  return `M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}`;
}

function layout(trip: TripData, days: string[]) {
  const { routes: lines, unplaced } = routes(days, trip.plans);
  const stops = lines.flatMap((route) => route.stops);
  const photos = trip.photos
    .map((photo) => photoPoint(photo, trip.plans))
    .filter((value): value is Coordinate => value !== null);
  return { lines, stops, photos, unplaced, box: bounds([...stops.map((stop) => stop.at), ...photos]) };
}

/** The drawn map: day routes as constellations, optionally over real tiles. */
export function MapSketch({
  trip,
  days,
  tiles: showTiles = false,
  compact = false,
  pinning,
  onPick,
}: {
  trip: TripData;
  days: string[];
  tiles?: boolean;
  compact?: boolean;
  pinning?: string;
  onPick?: (at: Coordinate) => void;
}): ReactElement | null {
  const { lines, stops, photos, box } = layout(trip, days);
  const project = box ? projector(box, FRAME) : null;
  const tiles = box && showTiles ? tilesFor(box, FRAME, tileZoom(box, FRAME)) : [];
  const urls = useTiles(showTiles, tiles.map((tile) => `${tile.z}/${tile.x}/${tile.y}`));
  if (!box || !project) return null;
  return (
    <figure className={s.mapFrame} data-tiles={showTiles} data-compact={compact}>
      {tiles.map((tile) => {
        const url = urls[`${tile.z}/${tile.x}/${tile.y}`];
        return url ? (
          <img
            key={`${tile.z}/${tile.x}/${tile.y}`}
            className={s.tile}
            src={url}
            alt=""
            style={{
              left: `${(tile.left / FRAME.width) * 100}%`,
              top: `${(tile.top / FRAME.height) * 100}%`,
              width: `${(tile.size / FRAME.width) * 100}%`,
            }}
          />
        ) : null;
      })}
      <svg
        className={s.mapSvg}
        viewBox={`0 0 ${FRAME.width} ${FRAME.height}`}
        role="img"
        aria-label={`여행 지도 · 장소 ${stops.length}곳`}
        data-pinning={Boolean(pinning)}
        onClick={(event) => {
          if (!pinning || !onPick) return;
          const rect = event.currentTarget.getBoundingClientRect();
          const x = ((event.clientX - rect.left) / rect.width) * FRAME.width;
          const y = ((event.clientY - rect.top) / rect.height) * FRAME.height;
          onPick(unprojector(box, FRAME)(x, y));
        }}
      >
        {photos.map((point, index) => {
          const at = project(point);
          return <circle key={`photo-${index}`} cx={at.x} cy={at.y} r={2.5} className={s.photoDot} />;
        })}
        {lines.map((route) =>
          route.stops.slice(1).map((stop, index) => {
            const from = route.stops[index];
            // Only the leg that arrives by a move is drawn as a dashed arc.
            const flight = stop.plan.kind === "move";
            return (
              <path
                key={`${route.day}-${stop.plan.id}`}
                d={segment(project(from.at), project(stop.at), flight)}
                className={s.route}
                data-color={DAY_COLORS[route.day % DAY_COLORS.length]}
                data-dashed={flight}
              />
            );
          }),
        )}
        {stops.map((stop) => {
          const at = project(stop.at);
          return (
            <g key={stop.plan.id}>
              <circle cx={at.x} cy={at.y} r={6} className={s.stop} />
              <text x={at.x} y={at.y - 12} className={s.stopLabel} textAnchor="middle">
                {stop.plan.place || stop.plan.title}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className={s.legend}>
        {lines.map((route) => (
          <span key={route.day} className={s.inline}>
            <span className={s.legendLine} data-color={DAY_COLORS[route.day % DAY_COLORS.length]} />
            {ordinalDay(trip.travel, days[route.day])}
          </span>
        ))}
        {pinning && <strong>‘{pinning}’ 자리를 지도에서 눌러 주세요</strong>}
      </figcaption>
    </figure>
  );
}

export function TravelMap({
  trip,
  days,
  settings,
  busy,
  onSettings,
  onPlace,
  onOpenDay,
}: {
  trip: TripData;
  days: string[];
  settings: TravelSettings;
  busy: boolean;
  onSettings: (next: TravelSettings) => void;
  onPlace: (plan: TravelPlan, at: Coordinate | null) => Promise<boolean>;
  onOpenDay: (date: string) => void;
}): ReactElement {
  const { stops, unplaced, box } = layout(trip, days);
  const [placing, setPlacing] = useState<TravelPlan | null>(null);
  const [pinning, setPinning] = useState<TravelPlan | null>(null);
  return (
    <>
      <div className={s.heading}>
        <h2 className={s.pageTitle}>{settings.mapTiles ? "실제 지도" : "그린 지도"}</h2>
        <p className={s.caption}>
          날짜별 경로를 별자리처럼 이어 봐요.{" "}
          {settings.mapTiles ? "타일은 OpenStreetMap에서 받아 이 컴퓨터에 30일 보관해요." : "네트워크 없이 볼 수 있어요."}
        </p>
      </div>
      {box ? (
        <MapSketch
          trip={trip}
          days={days}
          tiles={settings.mapTiles}
          pinning={pinning?.title}
          onPick={(at) => {
            const plan = pinning;
            setPinning(null);
            if (plan) void onPlace(plan, at);
          }}
        />
      ) : (
        <div className={s.mapEmpty}>
          <p className={s.sectionTitle}>아직 위치를 붙인 장소가 없어요</p>
          <p className={s.caption}>지도 링크(네이버·카카오·구글·OpenStreetMap)를 붙여 넣거나 위도·경도를 적으면 점과 선으로 그려요.</p>
        </div>
      )}
      {unplaced.length > 0 && (
        <section className={s.list} aria-label="위치 없는 일정">
          <h3 className={s.sectionTitle}>위치 없는 일정 {unplaced.length}개 · 일정 순서로만 보여요</h3>
          {unplaced.slice(0, 8).map((plan) => (
            <div key={plan.id} className={s.inline}>
              <span className={s.grow}>
                {ordinalDay(trip.travel, plan.date)} · {plan.title}
              </span>
              <Button size="small" variant="ghost" disabled={busy} onClick={() => setPlacing(plan)}>
                위치 붙이기
              </Button>
              {box && (
                <Button size="small" variant="ghost" disabled={busy} onClick={() => setPinning(plan)}>
                  지도에서 찍기
                </Button>
              )}
            </div>
          ))}
        </section>
      )}
      <div className={s.actions}>
        {days[0] && (
          <Button variant="ghost" onClick={() => onOpenDay(days[0])}>
            첫날 일정
          </Button>
        )}
        {stops.length > 0 && (
          <Select
            aria-label="자리를 바꿀 장소"
            value=""
            disabled={busy}
            onChange={(event) => {
              const plan = trip.plans.find((value) => value.id === event.target.value);
              if (plan) setPlacing(plan);
            }}
          >
            <option value="">장소 자리 바꾸기</option>
            {stops.map((stop) => (
              <option key={stop.plan.id} value={stop.plan.id}>
                {stop.plan.title}
              </option>
            ))}
          </Select>
        )}
      </div>
      <section className={s.settings} aria-label="지도 설정">
        <Switch
          label="실제 지도 타일"
          description="같은 점과 선을 OpenStreetMap 지도 위에 그려요. 켜면 지도 타일 요청이 밖으로 나가요."
          checked={settings.mapTiles}
          disabled={busy}
          onChange={(event) => onSettings({ ...settings, mapTiles: event.target.checked })}
        />
        <Switch
          label="주소 검색"
          description="장소 이름이나 주소로 위치를 찾아요(OpenStreetMap Nominatim, 1초에 한 번). 국내 상세 주소는 덜 정확할 수 있어요."
          checked={settings.addressSearch}
          disabled={busy}
          onChange={(event) => onSettings({ ...settings, addressSearch: event.target.checked })}
        />
      </section>
      {placing && (
        <PlacePicker
          plan={placing}
          search={settings.addressSearch}
          busy={busy}
          onSave={(at) => onPlace(placing, at)}
          onClose={() => setPlacing(null)}
        />
      )}
    </>
  );
}

export function PlacePicker({
  plan,
  search,
  busy,
  onSave,
  onClose,
}: {
  plan: TravelPlan;
  search: boolean;
  busy: boolean;
  onSave: (at: Coordinate | null) => Promise<boolean>;
  onClose: () => void;
}): ReactElement {
  const [link, setLink] = useState("");
  const [query, setQuery] = useState(plan.place || plan.title);
  const [results, setResults] = useState<{ name: string; lat: number; lng: number }[]>([]);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const parsed = link.trim() ? parseMapLink(link) : null;
  async function find(): Promise<void> {
    setSearching(true);
    setError("");
    try {
      const found = await command<{ name: string; lat: number; lng: number }[]>("travel_geocode", { query });
      setResults(found);
      if (!found.length) setError("찾은 곳이 없어요. 다른 이름으로 찾아보거나 지도 링크를 붙여 주세요.");
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setSearching(false);
    }
  }
  const save = (at: Coordinate | null) => void onSave(at).then((done) => done && onClose());
  return (
    <Dialog
      isOpen
      title={`‘${plan.title}’ 위치`}
      closeLabel="위치 정하기 닫기"
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <div className={s.form}>
        <FormField
          label="지도 링크나 위도·경도"
          description="네이버·카카오·구글·OpenStreetMap 공유 링크를 붙여 넣어요. 짧은 링크는 지도에서 연 뒤의 주소를 써 주세요."
          error={link.trim() && !parsed ? "링크에서 위치를 읽지 못했어요." : undefined}
        >
          <TextInput value={link} placeholder="33.4996, 126.5312" disabled={busy} onChange={(event) => setLink(event.target.value)} />
        </FormField>
        {search && (
          <div className={s.inline}>
            <TextInput
              aria-label="찾을 장소"
              value={query}
              maxLength={200}
              disabled={busy || searching}
              onChange={(event) => setQuery(event.target.value)}
            />
            <Button variant="ghost" disabled={busy || searching || !query.trim()} onClick={() => void find()}>
              {searching ? "찾는 중" : "주소로 찾기"}
            </Button>
          </div>
        )}
        {results.map((result) => (
          <Button
            key={`${result.lat},${result.lng}`}
            variant="ghost"
            disabled={busy}
            onClick={() => save({ lat: result.lat / 1e6, lng: result.lng / 1e6 })}
          >
            {result.name}
          </Button>
        ))}
        {error && (
          <p role="alert" className={s.caption}>
            {error}
          </p>
        )}
        <div className={s.formActions}>
          {plan.lat !== undefined && (
            <Button variant="danger" className={s.deleteAction} disabled={busy} onClick={() => save(null)}>
              위치 지우기
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            취소
          </Button>
          <Button disabled={busy || !parsed} onClick={() => parsed && save(parsed)}>
            이 위치로
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function placeInput(plan: TravelPlan, at: Coordinate | null): Record<string, unknown> {
  const micro = at ? toMicro(at) : null;
  return {
    ...plan,
    time: plan.time ?? "",
    lat: micro?.lat ?? null,
    lng: micro?.lng ?? null,
    expected: plan,
  };
}
