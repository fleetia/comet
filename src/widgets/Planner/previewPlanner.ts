import { getWidgetPreview } from "../previewWidgets";
import { localDay, type DataRecord } from "../toolData";
import type { WidgetSnapshot, WidgetView } from "../types";
import { periodAnchor } from "./plannerData";

export function getPlannerPreview(): WidgetSnapshot {
  const snapshot = getWidgetPreview(),
    day = localDay(),
    now = Date.now();
  const at = (hour: number, minute = 0): number =>
    new Date(
      `${day}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`,
    ).getTime();
  return {
    ...snapshot,
    widgets: snapshot.widgets.map((widget): WidgetView => {
      if (widget.kind === "todo")
        return {
          ...widget,
          data: {
            lists: [
              { id: "default", name: "생활" },
              { id: "health", name: "건강" },
              { id: "hobby", name: "취미" },
            ],
            items: [
              "책 모임 질문 두 개 적기",
              "반납할 책 가방에 넣기",
              "식료품 주문하기",
              "20분 산책하기",
              "영수증 정리하기",
              "건강검진 날짜 알아보기",
              "여행 후보 지역 세 곳 적기",
              "공기청정기 필터 확인하기",
              "읽던 책 한 장 읽기",
              "세탁기 돌리기",
            ].map((title, i): DataRecord => ({
              id: `task-${i}`,
              title,
              memo: "",
              listId: i === 3 || i === 5 ? "health" : i === 0 || i === 6 ? "hobby" : "default",
              dueDate: i === 0 ? null : day,
              dueAt: i === 0 ? at(13, 30) : null,
              plannedDate: day,
              planPeriod: i === 4 || i === 5 ? "month" : i === 6 ? "year" : "week",
              planAnchor: periodAnchor(
                i === 4 || i === 5 ? "month" : i === 6 ? "year" : "week",
                day,
              ),
              repeat: "none",
              repeatRule:
                i === 3
                  ? {
                      mode: "calendar",
                      unit: "week",
                      interval: 1,
                      weekdays: [0, 2, 4],
                      timeZone: "local",
                    }
                  : i === 7
                    ? { mode: "completion", unit: "day", interval: 30, timeZone: "local" }
                    : null,
              completedAt: i === 9 ? now : null,
              revision: 0,
              frequencyRecords: [],
            })),
          },
        };
      if (widget.kind === "calendar")
        return {
          ...widget,
          data: {
            connections: [
              {
                id: "google",
                name: "Google · 개인",
                provider: "google",
                status: "ready",
                lastSuccessAt: now,
              },
              {
                id: "apple",
                name: "Apple · 개인·모임",
                provider: "apple",
                status: "ready",
                lastSuccessAt: now,
              },
            ],
            events: [
              {
                id: "class",
                title: "온라인 강의",
                connectionId: "google",
                startAt: at(10),
                endAt: at(10, 30),
                allDay: false,
              },
              {
                id: "books",
                title: "책 모임",
                connectionId: "apple",
                startAt: at(14),
                endAt: at(15),
                allDay: false,
              },
              {
                id: "dinner",
                title: "저녁 약속",
                connectionId: "apple",
                startAt: at(18, 30),
                endAt: at(19, 30),
                allDay: false,
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
        };
      if (widget.kind === "preparation")
        return {
          ...widget,
          data: {
            envelopes: [
              {
                id: "book-prep",
                eventId: "books",
                eventLabel: "책 모임",
                checks: [{ id: "questions", text: "질문 두 개 적기", done: false }],
                links: [],
                todoIds: ["task-1"],
              },
            ],
          },
        };
      return widget;
    }),
  };
}
