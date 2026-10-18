import type { Photo, TravelPlan } from "./travelTypes";
import { plansOn } from "./travelData";

export type Coordinate = { lat: number; lng: number };

/** Day lines follow the list colour order, as the design's map rules say. */
export const DAY_COLORS = ["blue", "coral", "green", "violet", "yellow", "pink", "gray"] as const;

const MICRO = 1_000_000;

function valid(lat: number, lng: number): Coordinate | null {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
    ? { lat, lng }
    : null;
}

function fromMercator(x: number, y: number): Coordinate | null {
  const lng = (x / 20037508.34) * 180;
  const lat = (Math.atan(Math.exp((y / 20037508.34) * Math.PI)) * 360) / Math.PI - 90;
  return valid(lat, lng);
}

/**
 * Reads a position from a pasted map link or "lat, lng" text. Google, Naver, Kakao and
 * OpenStreetMap share links work; nothing is fetched to resolve short links.
 */
export function parseMapLink(text: string): Coordinate | null {
  const value = decodeURIComponent(text.trim());
  const pair = (a: string, b: string) => valid(Number(a), Number(b));
  const patterns: [RegExp, (m: RegExpMatchArray) => Coordinate | null][] = [
    [/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/, (m) => pair(m[1], m[2])],
    [/@(-?\d+\.\d+),(-?\d+\.\d+)/, (m) => pair(m[1], m[2])],
    [/[?&](?:q|query|ll|center)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/, (m) => pair(m[1], m[2])],
    [/[?&]mlat=(-?\d+\.\d+)&mlon=(-?\d+\.\d+)/, (m) => pair(m[1], m[2])],
    [/#map=\d+\/(-?\d+\.\d+)\/(-?\d+\.\d+)/, (m) => pair(m[1], m[2])],
    [/[?&]lat=(-?\d+\.\d+)&(?:lng|lon)=(-?\d+\.\d+)/, (m) => pair(m[1], m[2])],
    [/map\.kakao\.com\/link\/(?:map|to)\/[^,]+,(-?\d+\.\d+),(-?\d+\.\d+)/, (m) => pair(m[1], m[2])],
    // Naver's c= holds web-mercator metres (x,y) or degrees (lng,lat).
    [
      /[?&]c=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/,
      (m) =>
        Math.abs(Number(m[1])) > 180
          ? fromMercator(Number(m[1]), Number(m[2]))
          : pair(m[2], m[1]),
    ],
    [/^\s*(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/, (m) => pair(m[1], m[2])],
  ];
  for (const [pattern, read] of patterns) {
    const match = value.match(pattern);
    const result = match && read(match);
    if (result) return result;
  }
  return null;
}

export function toMicro(value: Coordinate): { lat: number; lng: number } {
  return { lat: Math.round(value.lat * MICRO), lng: Math.round(value.lng * MICRO) };
}

export function fromMicro(lat?: number, lng?: number): Coordinate | null {
  return lat === undefined || lng === undefined ? null : { lat: lat / MICRO, lng: lng / MICRO };
}

export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

/** The closest placed plan within 300 m, the radius the design uses for photos. */
export function nearestPlan(point: Coordinate, plans: TravelPlan[], radius = 300): TravelPlan | undefined {
  let best: { plan: TravelPlan; distance: number } | undefined;
  for (const plan of plans) {
    const at = fromMicro(plan.lat, plan.lng);
    if (!at) continue;
    const distance = distanceMeters(point, at);
    if (distance <= radius && (!best || distance < best.distance)) best = { plan, distance };
  }
  return best?.plan;
}

export type MapStop = { plan: TravelPlan; at: Coordinate; day: number };
export type MapRoute = { day: number; color: string; stops: MapStop[] };

/** Placed plans per trip day in schedule order; unplaced plans are listed separately. */
export function routes(days: string[], plans: TravelPlan[]): { routes: MapRoute[]; unplaced: TravelPlan[] } {
  const unplaced: TravelPlan[] = [];
  const result = days.map((date, index) => {
    const stops: MapStop[] = [];
    for (const plan of plansOn(plans, date)) {
      const at = fromMicro(plan.lat, plan.lng);
      if (at) stops.push({ plan, at, day: index });
      else unplaced.push(plan);
    }
    return { day: index, color: DAY_COLORS[index % DAY_COLORS.length], stops };
  });
  return { routes: result.filter((route) => route.stops.length), unplaced };
}

export type Frame = { width: number; height: number; padding: number };
export type Bounds = { west: number; east: number; south: number; north: number };

export function bounds(points: Coordinate[]): Bounds | null {
  if (!points.length) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  // A single place or a tight cluster still gets a readable neighbourhood around it.
  const pad = 0.005;
  return {
    west: Math.min(...lngs) - pad,
    east: Math.max(...lngs) + pad,
    south: Math.min(...lats) - pad,
    north: Math.max(...lats) + pad,
  };
}

function mercatorY(lat: number): number {
  const rad = (lat * Math.PI) / 180;
  return Math.log(Math.tan(Math.PI / 4 + rad / 2));
}

/** Projects to the frame keeping real direction and distance ratios (web mercator). */
export function projector(box: Bounds, frame: Frame): (point: Coordinate) => { x: number; y: number } {
  const width = frame.width - frame.padding * 2;
  const height = frame.height - frame.padding * 2;
  const spanX = ((box.east - box.west) * Math.PI) / 180;
  const top = mercatorY(box.north);
  const spanY = top - mercatorY(box.south);
  const scale = Math.min(width / spanX, height / spanY);
  const offsetX = frame.padding + (width - spanX * scale) / 2;
  const offsetY = frame.padding + (height - spanY * scale) / 2;
  return (point) => ({
    x: offsetX + (((point.lng - box.west) * Math.PI) / 180) * scale,
    y: offsetY + (top - mercatorY(point.lat)) * scale,
  });
}

/** Inverse of `projector`, for placing a plan by clicking the drawn map. */
export function unprojector(box: Bounds, frame: Frame): (x: number, y: number) => Coordinate {
  const width = frame.width - frame.padding * 2;
  const height = frame.height - frame.padding * 2;
  const spanX = ((box.east - box.west) * Math.PI) / 180;
  const top = mercatorY(box.north);
  const spanY = top - mercatorY(box.south);
  const scale = Math.min(width / spanX, height / spanY);
  const offsetX = frame.padding + (width - spanX * scale) / 2;
  const offsetY = frame.padding + (height - spanY * scale) / 2;
  return (x, y) => {
    const lng = box.west + ((((x - offsetX) / scale) * 180) / Math.PI);
    const merc = top - (y - offsetY) / scale;
    const lat = ((2 * Math.atan(Math.exp(merc)) - Math.PI / 2) * 180) / Math.PI;
    return { lat, lng };
  };
}

/** Zoom level whose tiles cover the bounds in roughly the frame's pixels. */
export function tileZoom(box: Bounds, frame: Frame): number {
  const spanX = ((box.east - box.west) * Math.PI) / 180;
  const spanY = mercatorY(box.north) - mercatorY(box.south);
  const pixelsPerRadian = Math.min(
    (frame.width - frame.padding * 2) / spanX,
    (frame.height - frame.padding * 2) / spanY,
  );
  // At zoom z the world (2π radians) spans 256·2^z pixels.
  return Math.max(1, Math.min(17, Math.floor(Math.log2((pixelsPerRadian * 2 * Math.PI) / 256))));
}

export type Tile = { z: number; x: number; y: number; left: number; top: number; size: number };

/** Tiles of zoom `z` that cover the frame, positioned in frame pixels. */
export function tilesFor(box: Bounds, frame: Frame, z: number): Tile[] {
  const project = projector(box, frame);
  const unproject = unprojector(box, frame);
  const corner = unproject(0, 0);
  const far = unproject(frame.width, frame.height);
  const n = 2 ** z;
  const tileX = (lng: number) => Math.floor(((lng + 180) / 360) * n);
  const tileY = (lat: number) => Math.floor(((1 - mercatorY(lat) / Math.PI) / 2) * n);
  const tileLng = (x: number) => (x / n) * 360 - 180;
  const tileLat = (y: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const result: Tile[] = [];
  const x0 = Math.max(0, tileX(corner.lng));
  const x1 = Math.min(n - 1, tileX(far.lng));
  const y0 = Math.max(0, tileY(corner.lat));
  const y1 = Math.min(n - 1, tileY(far.lat));
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > 64) return [];
  for (let x = x0; x <= x1; x += 1) {
    for (let y = y0; y <= y1; y += 1) {
      const a = project({ lat: tileLat(y), lng: tileLng(x) });
      const b = project({ lat: tileLat(y + 1), lng: tileLng(x + 1) });
      result.push({ z, x, y, left: a.x, top: a.y, size: b.x - a.x });
    }
  }
  return result;
}

/** Photo position: its own GPS, or the plan it is attached to. */
export function photoPoint(photo: Photo, plans: TravelPlan[]): Coordinate | null {
  const own = fromMicro(photo.lat, photo.lng);
  if (own) return own;
  const plan = plans.find((value) => value.id === photo.planId);
  return plan ? fromMicro(plan.lat, plan.lng) : null;
}
