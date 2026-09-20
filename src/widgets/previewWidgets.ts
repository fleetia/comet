import catalog from "../../widgets/catalog.json";
import { localDay } from "./toolData";
import type { WidgetSnapshot, WidgetValue } from "./types";

export function getWidgetPreview(): WidgetSnapshot {
  const now = Date.now();
  const day = localDay();
  const data: Record<string, WidgetValue> = {
    todo: {
      lists: [
        { id: "default", name: "할 일" },
        { id: "shopping", name: "장보기" },
      ],
      items: [
        {
          id: "read",
          title: "책 한 장 읽기",
          memo: "잠깐 쉬어 가며 읽어요.",
          listId: "default",
          dueDate: day,
          dueAt: null,
          repeat: "daily",
          completedAt: null,
        },
        {
          id: "walk",
          title: "동네 한 바퀴 걷기",
          memo: "",
          listId: "default",
          dueDate: day,
          dueAt: null,
          repeat: "none",
          completedAt: now,
        },
      ],
    },
    "focus-timer": {
      status: "idle",
      mode: "focus",
      remainingMs: 1500000,
      durationMs: 1500000,
      deadline: null,
      todoId: null,
    },
    memo: {
      notes: [
        {
          id: "note",
          title: "작은 생각",
          body: "오늘 떠오른 문장을 적어 두기.\n\n다음에 이어서 생각해요.",
          updatedAt: now,
          isOpen: true,
          fontSize: 16,
        },
      ],
    },
    clock: {
      format: "24h",
      anniversaries: [{ id: "day", title: "함께 지내기 시작한 날", date: day }],
    },
    "completion-jar": { completed: [{ id: "walk", title: "동네 한 바퀴 걷기" }] },
    calendar: {
      connections: [
        { id: "example", name: "예시 일정", provider: "ics", status: "ready", lastSuccessAt: now },
      ],
      events: [
        {
          id: "appointment",
          connectionId: "example",
          title: "친구와 차 한 잔",
          startAt: now + 3600000,
          endAt: now + 7200000,
          allDay: false,
          cancelled: false,
        },
      ],
      reminders: {
        enabled: false,
        leadMinutes: 10,
        includeAllDay: false,
        quietStart: "22:00",
        quietEnd: "08:00",
      },
    },
    preparation: {
      envelopes: [
        {
          id: "envelope",
          eventId: "appointment",
          eventLabel: "친구와 차 한 잔",
          checks: [{ id: "gift", text: "빌린 책 챙기기", done: false }],
          links: [],
          todoIds: [],
        },
      ],
    },
    weather: {
      configured: true,
      status: "ready",
      lastSuccessAt: now,
      observation: {
        name: "예시 지역",
        temperature: 23,
        temperatureUnit: "°C",
        weatherCode: 2,
        observedAt: now,
        attribution: "화면 확인용 예시 · 실제 날씨가 아니에요.",
      },
    },
    music: { configured: false, status: "setup", config: { provider: "music" } },
    device: { configured: false, status: "setup" },
    interaction: { snacks: 6, touches: 3 },
    ball: { x: 50, y: 50, moving: false, bounces: 0 },
    "paper-plane": { x: 50, y: 50, flying: false, distance: 0, best: 0 },
    bubbles: {
      bubbles: [
        { id: 1, x: 35, y: 40 },
        { id: 2, x: 65, y: 60 },
      ],
      streak: 0,
      best: 0,
    },
    "small-match": { a: "3", b: "5", result: "예시 · B가 이겼어요." },
    guessing: { mode: "cups", playing: false, attempts: 0, hint: "놀이를 시작해 주세요." },
    fishing: { phase: "idle", lastCatch: null, catches: 0 },
    fortune: { text: "예시 운세 · 잠깐의 산책에서 작은 즐거움을 만날지도 몰라요." },
    plant: { stage: 1, water: 1 },
    pet: { x: 35, y: 50, food: null, arrivals: 0 },
    collection: { items: [{ itemId: "shell", name: "조개껍데기", quantity: 1 }], decorations: [] },
    journal: {},
  };
  return {
    catalog,
    onboardingDone: true,
    widgets: catalog.map((entry) => ({
      id: entry.id,
      kind: entry.id,
      version: entry.version,
      installed: true,
      enabled: true,
      revision: 1,
      data: data[entry.id] ?? {},
      error: null,
      missing: [],
      status: entry.id === "music" || entry.id === "device" ? "setup" : "enabled",
      packageBytes: 0,
    })),
  };
}
