import { record, text, type DataRecord } from "../toolData";

export const CALENDAR_PALETTE = [
  { color: "#d83a46", name: "빨강" },
  { color: "#e87820", name: "주황" },
  { color: "#b99000", name: "노랑" },
  { color: "#2f8b57", name: "초록" },
  { color: "#008b91", name: "청록" },
  { color: "#3478d4", name: "파랑" },
  { color: "#8854b8", name: "보라" },
  { color: "#cc4f8f", name: "분홍" },
];

export type CalendarSource = {
  connectionId: string;
  calendarId: string;
  name: string;
  connectionName: string;
};

export function calendarSources(connections: DataRecord[], events: DataRecord[]): CalendarSource[] {
  return connections.flatMap((connection) => {
    const connectionId = text(connection.id);
    if (!connectionId) {
      return [];
    }
    const connectionName = text(connection.name) || "캘린더";
    if (connection.provider === "ics") {
      return [{ connectionId, calendarId: "", name: connectionName, connectionName }];
    }
    const selected = Array.isArray(connection.selectedCalendarIds)
      ? connection.selectedCalendarIds.map(text).filter(Boolean)
      : [];
    const calendarIds = new Set(
      selected.length > 0
        ? selected
        : events
            .filter((event) => event.connectionId === connectionId)
            .map((event) => text(event.sourceId))
            .filter(Boolean),
    );
    const names = record(connection.calendarNames);
    return [...calendarIds].map((calendarId, index) => ({
      connectionId,
      calendarId,
      name:
        text(names[calendarId]) ||
        (calendarIds.size === 1 ? connectionName : `${connectionName} ${index + 1}`),
      connectionName,
    }));
  });
}

export function sourceColor(
  source: Pick<CalendarSource, "connectionId" | "calendarId">,
  colors: DataRecord,
): string {
  const saved = text(record(colors[source.connectionId])[source.calendarId]);
  if (/^#[0-9a-f]{6}$/i.test(saved)) {
    return saved.toLowerCase();
  }
  const identity = JSON.stringify([source.connectionId, source.calendarId]);
  let hash = 0;
  for (const character of identity) {
    hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  }
  return CALENDAR_PALETTE[hash % CALENDAR_PALETTE.length].color;
}

export function colorForEvent(
  event: DataRecord,
  connections: DataRecord[],
  colors: DataRecord,
): string {
  const connectionId = text(event.connectionId);
  const connection = connections.find((item) => item.id === connectionId);
  return sourceColor(
    {
      connectionId,
      calendarId: connection?.provider === "ics" ? "" : text(event.sourceId),
    },
    colors,
  );
}
