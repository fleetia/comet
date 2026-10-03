import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { DiaryCalendarContext } from "../Planner/DiaryCalendarContext";
import type { DataRecord } from "../toolData";

const DAY = "2026-10-03";
const NOW = new Date(`${DAY}T12:00:00`).getTime();
type Props = ComponentProps<typeof DiaryCalendarContext>;

function props(overrides: Partial<Props> = {}): Props {
  return {
    day: DAY,
    events: [],
    connections: [],
    colors: {},
    busy: false,
    onColorChange: vi.fn(),
    onOpenSettings: vi.fn(),
    ...overrides,
  };
}

function event(connectionId: string, from: string, to: string): DataRecord {
  return {
    id: `${connectionId}:${from}`,
    connectionId,
    startAt: new Date(`${DAY}T${from}:00`).getTime(),
    endAt: new Date(`${DAY}T${to}:00`).getTime(),
  };
}

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("keeps local-only information collapsed and opens settings without claiming free time", () => {
  const input = props({ events: [event("local", "12:00", "13:00")] });
  render(<DiaryCalendarContext {...input} />);
  expect(screen.getByText("캘린더 정보").closest("details")).toHaveProperty("open", false);
  fireEvent.click(screen.getByText("캘린더 정보"));
  expect(screen.getByText("캘린더 정보").closest("details")).toHaveProperty("open", true);
  expect(screen.getByText(/외부 캘린더 연결 없이 사용할 수 있어요/)).toBeTruthy();
  expect(screen.queryByRole("region", { name: "선택한 날짜 빈 시간" })).toBeNull();
  expect(screen.queryByText(/오래됐거나|이전 정보|읽기 전용/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "연결·알림 설정" }));
  expect(input.onOpenSettings).toHaveBeenCalledTimes(1);
});

it("reuses per-calendar colors and includes local events in fresh connected free time", () => {
  const input = props({
    connections: [
      { id: "family", provider: "ics", name: "가족", status: "ready", lastSuccessAt: NOW },
    ],
    colors: { family: { "": "#3478d4" } },
    events: [
      event("family", "09:00", "10:00"),
      event("local", "12:00", "13:00"),
      event("removed", "00:00", "23:59"),
      { ...event("family", "14:00", "15:00"), cancelled: true },
    ],
  });
  const view = render(<DiaryCalendarContext {...input} />);
  fireEvent.click(screen.getByText("캘린더 정보"));
  expect(screen.getByText("ICS 구독 · 조회 완료")).toBeTruthy();
  expect(screen.getByText(`마지막 조회: ${new Date(NOW).toLocaleString("ko-KR")}`)).toBeTruthy();
  const free = within(screen.getByRole("region", { name: "선택한 날짜 빈 시간" }));
  expect(free.getByText("00:00 – 09:00")).toBeTruthy();
  expect(free.getByText("10:00 – 12:00")).toBeTruthy();
  expect(free.getByText("13:00 – 24:00")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "가족 색상 변경" }));
  expect(screen.getByRole("button", { name: "파랑" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "보라" }));
  expect(input.onColorChange).toHaveBeenCalledExactlyOnceWith({
    connectionId: "family",
    calendarId: "",
    color: "#8854b8",
  });
  view.rerender(<DiaryCalendarContext {...input} busy />);
  expect(screen.getByRole("button", { name: "가족 색상 변경" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "연결·알림 설정" })).toHaveProperty("disabled", true);
});

it("keeps the last successful read and failure visible without declaring free time", () => {
  const connection = {
    id: "work",
    provider: "google",
    name: "업무",
    status: "ready",
    lastSuccessAt: NOW - 3600000,
  };
  const input = props({ connections: [connection], events: [event("work", "09:00", "10:00")] });
  const view = render(<DiaryCalendarContext {...input} />);
  fireEvent.click(screen.getByText("캘린더 정보"));
  expect(screen.getByText("Google Calendar · 오래된 정보")).toBeTruthy();
  expect(screen.getByText(/새로 조회하기 전에는 빈 시간을 판단하지 않아요/)).toBeTruthy();
  expect(screen.queryByText("10:00 – 24:00")).toBeNull();
  view.rerender(
    <DiaryCalendarContext
      {...input}
      connections={[{ ...connection, status: "auth-error", error: "다시 연결해 주세요." }]}
    />,
  );
  expect(screen.getByText("Google Calendar · 다시 인증 필요")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("다시 연결해 주세요.");
  expect(
    screen.getByText(`마지막 조회: ${new Date(connection.lastSuccessAt).toLocaleString("ko-KR")}`),
  ).toBeTruthy();
  expect(screen.queryByText("10:00 – 24:00")).toBeNull();
});

it("does not calculate free time beyond the external calendar coverage range", () => {
  render(
    <DiaryCalendarContext
      {...props({
        day: "2028-10-03",
        connections: [
          { id: "apple", provider: "apple", name: "이 Mac", status: "ready", lastSuccessAt: NOW },
        ],
      })}
    />,
  );
  fireEvent.click(screen.getByText("캘린더 정보"));
  expect(screen.getByText(/선택한 날짜는 조회 범위 밖이에요/)).toBeTruthy();
  expect(screen.queryByText("00:00 – 24:00")).toBeNull();
});
