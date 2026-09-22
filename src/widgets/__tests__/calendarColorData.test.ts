import { expect, it } from "vitest";
import { calendarSources, colorForEvent, sourceColor } from "../Planner/calendarColorData";
import type { DataRecord } from "../toolData";

it("uses one source and color for every UID in an ICS subscription", () => {
  const connections: DataRecord[] = [{ id: "ics", provider: "ics", name: "가족 일정" }];
  const events = [
    { connectionId: "ics", sourceId: "birthday-uid" },
    { connectionId: "ics", sourceId: "holiday-uid" },
  ];
  expect(calendarSources(connections, events)).toEqual([
    { connectionId: "ics", calendarId: "", name: "가족 일정", connectionName: "가족 일정" },
  ]);
  expect(colorForEvent(events[0], connections, {})).toBe(colorForEvent(events[1], connections, {}));
  for (const event of events) {
    expect(colorForEvent(event, connections, { ics: { "": "#3478d4" } })).toBe("#3478d4");
  }
});

it("lists selected calendars without events and keeps their saved colors independent", () => {
  const connections: DataRecord[] = [
    {
      id: "apple",
      provider: "apple",
      name: "이 Mac",
      selectedCalendarIds: ["personal", "work"],
      calendarNames: { personal: "개인", work: "업무" },
    },
  ];
  expect(calendarSources(connections, [])).toEqual([
    { connectionId: "apple", calendarId: "personal", name: "개인", connectionName: "이 Mac" },
    { connectionId: "apple", calendarId: "work", name: "업무", connectionName: "이 Mac" },
  ]);
  const colors = { apple: { personal: "#d83a46", work: "#3478d4" } };
  expect(colorForEvent({ connectionId: "apple", sourceId: "personal" }, connections, colors)).toBe(
    "#d83a46",
  );
  expect(colorForEvent({ connectionId: "apple", sourceId: "work" }, connections, colors)).toBe(
    "#3478d4",
  );
});

it("recovers source IDs from older cached events without names or selected IDs", () => {
  expect(
    calendarSources(
      [{ id: "google", provider: "google", name: "Google 일정" }],
      [
        { connectionId: "google", sourceId: "primary" },
        { connectionId: "google", sourceId: "primary" },
        { connectionId: "removed", sourceId: "other" },
      ],
    ),
  ).toEqual([
    {
      connectionId: "google",
      calendarId: "primary",
      name: "Google 일정",
      connectionName: "Google 일정",
    },
  ]);
  expect(calendarSources([{ id: "google", provider: "google" }], [])).toEqual([]);
  expect(
    calendarSources(
      [
        {
          id: "apple",
          provider: "apple",
          name: "이 Mac",
          selectedCalendarIds: ["uuid-a", "uuid-b"],
        },
      ],
      [],
    ).map(({ calendarId, name }) => ({ calendarId, name })),
  ).toEqual([
    { calendarId: "uuid-a", name: "이 Mac 1" },
    { calendarId: "uuid-b", name: "이 Mac 2" },
  ]);
});

it("uses the saved selection instead of listing cached calendars that are no longer selected", () => {
  const connections: DataRecord[] = [
    {
      id: "apple",
      provider: "apple",
      name: "이 Mac",
      selectedCalendarIds: ["work"],
      calendarNames: { work: "업무", personal: "개인" },
    },
  ];
  const cached = { connectionId: "apple", sourceId: "personal" };
  expect(calendarSources(connections, [cached])).toEqual([
    { connectionId: "apple", calendarId: "work", name: "업무", connectionName: "이 Mac" },
  ]);
  expect(colorForEvent(cached, connections, { apple: { personal: "#d83a46" } })).toBe("#d83a46");
});

it("keeps default colors stable when sources reorder or gain names and events", () => {
  const event = { connectionId: "apple", sourceId: "personal" };
  const before: DataRecord[] = [
    { id: "apple", provider: "apple", selectedCalendarIds: ["personal", "work"] },
  ];
  const after: DataRecord[] = [
    { id: "new", provider: "ics" },
    {
      id: "apple",
      provider: "apple",
      name: "새 연결 이름",
      selectedCalendarIds: ["work", "personal"],
      calendarNames: { personal: "새 캘린더 이름" },
    },
  ];
  const color = colorForEvent(event, before, {});
  expect(colorForEvent(event, after, {})).toBe(color);
  const source = calendarSources(after, [event]).find((item) => item.calendarId === "personal");
  expect(source).toBeDefined();
  if (source) {
    expect(sourceColor(source, {})).toBe(color);
  }
});

it("falls back from malformed legacy color data and normalizes a valid hex color", () => {
  const source = { connectionId: "apple", calendarId: "personal" };
  const fallback = sourceColor(source, {});
  expect(sourceColor(source, { apple: "old-value" })).toBe(fallback);
  expect(sourceColor(source, { apple: { personal: "url(https://example.com)" } })).toBe(fallback);
  expect(sourceColor(source, { apple: { personal: "#AABBCC" } })).toBe("#aabbcc");
});
