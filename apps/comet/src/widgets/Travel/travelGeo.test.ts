import { describe, expect, it } from "vitest";
import {
  bounds,
  distanceMeters,
  nearestPlan,
  parseMapLink,
  projector,
  routes,
  tileZoom,
  tilesFor,
  unprojector,
} from "./travelGeo";
import type { TravelPlan } from "./travelTypes";

function plan(id: string, date: string, time: string, lat?: number, lng?: number): TravelPlan {
  return { id, travelId: "t", kind: "plan", date, time, title: id, place: "", memo: "", lat, lng };
}

describe("map links", () => {
  it.each([
    ["https://www.google.com/maps/place/x/@33.5066,126.4929,15z", 33.5066, 126.4929],
    ["https://www.google.com/maps/place/x/data=!3d33.4996!4d126.5312", 33.4996, 126.5312],
    ["https://maps.google.com/?q=37.5665,126.9780", 37.5665, 126.978],
    ["https://www.openstreetmap.org/#map=16/33.51/126.52", 33.51, 126.52],
    ["https://map.kakao.com/link/map/제주공항,33.5104,126.4914", 33.5104, 126.4914],
    ["https://map.naver.com/p?c=126.5312,33.4996,15,0,0,0,dh", 33.4996, 126.5312],
    ["33.4996, 126.5312", 33.4996, 126.5312],
  ])("reads %s", (link, lat, lng) => {
    const at = parseMapLink(link);
    expect(at?.lat).toBeCloseTo(lat, 4);
    expect(at?.lng).toBeCloseTo(lng, 4);
  });

  it("converts Naver web-mercator metres and rejects text without a place", () => {
    const at = parseMapLink("https://map.naver.com/p?c=14085345.5,3959233.4,15,0,0,0,dh");
    expect(at?.lat).toBeCloseTo(33.5, 1);
    expect(at?.lng).toBeCloseTo(126.53, 1);
    expect(parseMapLink("https://naver.me/abc")).toBeNull();
    expect(parseMapLink("95.0, 10.0")).toBeNull();
  });
});

describe("drawn map", () => {
  it("keeps schedule order per day, lists unplaced plans and finds photos within 300 m", () => {
    const plans = [
      plan("airport", "2026-10-24", "10:20", 33_506_600, 126_492_900),
      plan("market", "2026-10-24", "18:00", 33_512_000, 126_528_000),
      plan("stay", "2026-10-24", "15:00", 33_462_000, 126_330_000),
      plan("unknown", "2026-10-25", "09:00"),
    ];
    const result = routes(["2026-10-24", "2026-10-25"], plans);
    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].stops.map((stop) => stop.plan.id)).toEqual(["airport", "stay", "market"]);
    expect(result.unplaced.map((value) => value.id)).toEqual(["unknown"]);
    expect(distanceMeters({ lat: 33.5066, lng: 126.4929 }, { lat: 33.5066, lng: 126.4949 })).toBeCloseTo(185, -1);
    expect(nearestPlan({ lat: 33.5067, lng: 126.493 }, plans)?.id).toBe("airport");
    expect(nearestPlan({ lat: 33.53, lng: 126.6 }, plans)).toBeUndefined();
  });

  it("projects into the frame and back so a click places the plan where it was pressed", () => {
    const box = bounds([
      { lat: 33.4, lng: 126.2 },
      { lat: 33.6, lng: 126.9 },
    ])!;
    const frame = { width: 840, height: 360, padding: 48 };
    const project = projector(box, frame);
    const back = unprojector(box, frame);
    const point = project({ lat: 33.5, lng: 126.5 });
    expect(point.x).toBeGreaterThan(frame.padding);
    expect(point.x).toBeLessThan(frame.width - frame.padding);
    const again = back(point.x, point.y);
    expect(again.lat).toBeCloseTo(33.5, 6);
    expect(again.lng).toBeCloseTo(126.5, 6);
    const zoom = tileZoom(box, frame);
    expect(zoom).toBeGreaterThanOrEqual(9);
    const tiles = tilesFor(box, frame, zoom);
    expect(tiles.length).toBeGreaterThan(0);
    expect(tiles.length).toBeLessThanOrEqual(64);
  });
});
