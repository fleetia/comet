import { describe, expect, it } from "vitest";
import {
  appUsageTime,
  elapsedWithin,
  focusBuckets,
  focusSessions,
  readAppUsage,
  type FocusSession,
} from "./FocusTimerData";

function at(value: string): number {
  return new Date(value).getTime();
}
function session(segments: FocusSession["segments"]): FocusSession {
  return {
    id: "session",
    title: "글 쓰기",
    startedAt: segments[0].startAt,
    endedAt: segments.at(-1)?.endAt || 0,
    elapsedMs: 999999999,
    outcome: "ended",
    memo: "",
    eventRef: {},
    noteRef: {},
    segments,
  };
}

describe("actual focus time", () => {
  it("splits a session across local midnight and excludes the pause between its segments", () => {
    const record = session([
      { startAt: at("2026-10-07T23:50:00"), endAt: at("2026-10-08T00:10:00") },
      { startAt: at("2026-10-08T00:30:00"), endAt: at("2026-10-08T00:40:00") },
    ]);
    const buckets = focusBuckets([record], "week", "2026-10-07");
    expect(buckets.find((bucket) => bucket.key === "2026-10-07")?.elapsedMs).toBe(10 * 60000);
    expect(buckets.find((bucket) => bucket.key === "2026-10-08")?.elapsedMs).toBe(20 * 60000);
    expect(buckets.reduce((sum, bucket) => sum + bucket.elapsedMs, 0)).toBe(30 * 60000);
    expect(elapsedWithin(record, at("2026-10-08T00:10:00"), at("2026-10-08T00:30:00"))).toBe(0);
  });

  it("splits day/hour, month and year boundaries without counting a full session in both periods", () => {
    const record = session([
      { startAt: at("2026-12-31T23:50:00"), endAt: at("2027-01-01T00:10:00") },
    ]);
    expect(focusBuckets([record], "year", "2026-12-31").at(-1)?.elapsedMs).toBe(10 * 60000);
    expect(focusBuckets([record], "year", "2027-01-01")[0].elapsedMs).toBe(10 * 60000);
    expect(focusBuckets([record], "month", "2027-01-01")[0].elapsedMs).toBe(10 * 60000);
    expect(focusBuckets([record], "day", "2027-01-01")[0].elapsedMs).toBe(10 * 60000);
  });

  it("caps the current running segment at its deadline and freezes paused time", () => {
    const startedAt = at("2026-10-07T10:00:00");
    const activeSession = {
      id: "active",
      title: "읽기",
      startedAt,
      elapsedMs: 60000,
      segments: [{ startAt: startedAt, endAt: startedAt + 60000 }],
      runningSince: startedAt + 120000,
    };
    const data = { status: "running", mode: "focus", deadline: startedAt + 180000, activeSession };
    expect(focusSessions(data, startedAt + 300000)[0].elapsedMs).toBe(120000);
    expect(
      focusSessions({ ...data, status: "paused", deadline: null }, startedAt + 300000)[0].elapsedMs,
    ).toBe(60000);
    expect(focusSessions({ sessions: [], activeSession: null, mode: "rest" }, startedAt)).toEqual(
      [],
    );
  });

  it("preserves only backend-sampled application time for saved and active sessions", () => {
    const appUsage = {
      target: { id: "app:editor", name: "글쓰기" },
      elapsedMs: 12999,
      status: "tracking",
    };
    const startAt = at("2026-10-07T10:00:00");
    const data = {
      status: "running",
      mode: "focus",
      deadline: startAt + 60000,
      sessions: [{ id: "saved", appUsage }],
      activeSession: { id: "active", appUsage, runningSince: startAt },
    };
    const early = focusSessions(data, startAt + 1000);
    const late = focusSessions(data, startAt + 50000);
    expect(early.map((item) => item.appUsage)).toEqual([appUsage, appUsage]);
    expect(late.map((item) => item.appUsage)).toEqual([appUsage, appUsage]);
    expect(late[1].elapsedMs).toBe(50000);
    expect(appUsageTime(late[1].appUsage?.elapsedMs || 0)).toBe("00:12");
    expect(focusSessions({ sessions: [{ id: "legacy" }] }, startAt)[0].appUsage).toBeUndefined();
  });

  it("ignores incomplete application identity and clamps malformed durations", () => {
    expect(readAppUsage({ target: { name: "Missing id" }, elapsedMs: 1000 })).toBeUndefined();
    for (const elapsedMs of [-100, NaN, Infinity]) {
      expect(readAppUsage({ target: { id: "app", name: "App" }, elapsedMs })?.elapsedMs).toBe(0);
    }
  });
});
