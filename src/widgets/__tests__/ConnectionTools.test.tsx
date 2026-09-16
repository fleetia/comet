import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { command } from "../../hooks/useSnapshot";
import { ConnectionTool } from "../ConnectionTools";
import { CalendarTool } from "../CalendarTool";
import type { WidgetValue, WidgetView } from "../types";
vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
function widget(kind: string, data: WidgetValue): WidgetView {
  return {
    id: kind,
    kind,
    installed: true,
    enabled: true,
    revision: 1,
    version: 1,
    data,
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
  };
}
const act = vi.fn<() => Promise<boolean>>();
const EMPTY = {
  configured: false,
  config: {},
  status: "permission-needed",
  observation: null,
  lastSuccessAt: null,
  error: null,
};
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(new Date("2026-09-15T12:00").getTime());
  act.mockReset();
  act.mockResolvedValue(true);
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(undefined);
  HTMLDialogElement.prototype.showModal = function (): void {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (): void {
    this.removeAttribute("open");
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("does not query private sources before opting in to the selected music provider", async () => {
  render(<ConnectionTool widget={widget("music", EMPTY)} />);
  expect(command).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("음악 앱"), { target: { value: "spotify" } });
  fireEvent.click(screen.getByRole("button", { name: "곡 정보 조회 허용하고 연결" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("configure_connection_widget", {
      id: "music",
      input: { provider: "spotify" },
    }),
  );
});
it("configures weather only from an explicit selected search result", async () => {
  vi.mocked(command).mockResolvedValueOnce([
    {
      id: 1,
      name: "서울",
      latitude: 37.56,
      longitude: 126.97,
      country: "대한민국",
      admin1: "서울특별시",
    },
  ]);
  render(<ConnectionTool widget={widget("weather", EMPTY)} />);
  expect(command).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/^지역 이름\s*\*?$/), { target: { value: "서울" } });
  fireEvent.click(screen.getByRole("button", { name: "지역 검색" }));
  fireEvent.click(await screen.findByRole("button", { name: /서울.*선택/ }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("configure_connection_widget", {
      id: "weather",
      input: { name: "서울", latitude: 37.56, longitude: 126.97 },
    }),
  );
});
it("preserves the last observation as stale on failure and distinguishes no battery", () => {
  const view = render(
    <ConnectionTool
      widget={widget("weather", {
        ...EMPTY,
        configured: true,
        status: "offline",
        error: "연결 실패",
        observation: {
          name: "서울",
          temperature: 21.5,
          temperatureUnit: "°C",
          weatherCode: 3,
          observedAt: 1000,
        },
        lastSuccessAt: 2000,
      })}
    />,
  );
  expect(screen.getByText("21.5°C")).toBeTruthy();
  expect(screen.getByText(/이전 정보 · 현재 상태/)).toBeTruthy();
  view.rerender(
    <ConnectionTool
      widget={widget("device", {
        ...EMPTY,
        configured: true,
        status: "ready",
        lastSuccessAt: Date.now(),
        observation: { hasBattery: false, batteries: [], powerSource: "ac" },
      })}
    />,
  );
  expect(screen.getByText("이 기기에는 조회 가능한 배터리가 없어요.")).toBeTruthy();
  expect(screen.queryByText(/0%/)).toBeNull();
});
it("clears the private ICS URL only after successful connection", async () => {
  render(<CalendarTool act={act} widget={widget("calendar", { connections: [], events: [] })} />);
  expect(command).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText(/^연결 이름\s*\*?$/), { target: { value: "개인" } });
  fireEvent.change(screen.getByLabelText(/^ICS \/ webcal 구독 주소\s*\*?$/), {
    target: { value: "https://example.com/private-token.ics" },
  });
  fireEvent.click(screen.getByRole("button", { name: "구독 주소 연결" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("connect_calendar_ics", {
      id: "calendar",
      input: { name: "개인", url: "https://example.com/private-token.ics" },
    }),
  );
  await waitFor(() =>
    expect(screen.getByLabelText(/^ICS \/ webcal 구독 주소\s*\*?$/)).toHaveProperty("value", ""),
  );
});
it("shows an upcoming event once in the agenda and keeps it available in the free-time view", () => {
  render(
    <CalendarTool
      act={act}
      widget={widget("calendar", {
        connections: [
          { id: "conn", name: "개인", provider: "ics", status: "ready", lastSuccessAt: Date.now() },
        ],
        events: [
          {
            id: "event",
            connectionId: "conn",
            title: "다가오는 약속",
            startAt: Date.now() + 3600000,
            endAt: Date.now() + 7200000,
            cancelled: false,
          },
        ],
      })}
    />,
  );
  fireEvent.change(screen.getByLabelText(/^조회 날짜\s*\*?$/), { target: { value: "2026-09-15" } });
  expect(screen.getAllByRole("heading", { name: "다가오는 약속" })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "연결한 캘린더의 빈 시간 보기" }));
  expect(screen.getByRole("heading", { name: "다음 일정" })).toBeTruthy();
  expect(screen.getAllByRole("heading", { name: "다가오는 약속" })).toHaveLength(1);
});
it("opens only stored meeting links and confirms disconnect while preserving preparation", async () => {
  const start = new Date("2026-09-15T10:00").getTime(),
    end = new Date("2026-09-15T11:00").getTime();
  render(
    <CalendarTool
      act={act}
      widget={widget("calendar", {
        connections: [
          { id: "conn", name: "개인", provider: "ics", status: "ready", lastSuccessAt: Date.now() },
        ],
        events: [
          {
            id: "event",
            connectionId: "conn",
            title: "회의",
            startAt: start,
            endAt: end,
            cancelled: false,
            meetingUrl: "https://meet.example.com/one",
          },
        ],
      })}
    />,
  );
  fireEvent.change(screen.getByLabelText(/^조회 날짜\s*\*?$/), { target: { value: "2026-09-15" } });
  fireEvent.click(screen.getAllByRole("button", { name: "회의 열기" })[0]);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_widget_link", {
      id: "calendar",
      url: "https://meet.example.com/one",
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "연결 해제" })).toHaveProperty("disabled", false),
  );
  fireEvent.click(screen.getByRole("button", { name: "연결 해제" }));
  expect(screen.getByText(/기존 준비 봉투의 체크리스트와 자료는 보존/)).toBeTruthy();
  expect(command).not.toHaveBeenCalledWith("disconnect_calendar", expect.anything());
  fireEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "연결 해제 확인" }),
  );
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("disconnect_calendar", {
      id: "calendar",
      connectionId: "conn",
    }),
  );
});
it("merges overlapping connected calendar intervals and excludes cancelled events", () => {
  const at = (time: string): number => new Date(`2026-09-15T${time}`).getTime();
  render(
    <CalendarTool
      act={act}
      widget={widget("calendar", {
        connections: [{ id: "c", name: "일정", status: "ready", lastSuccessAt: Date.now() }],
        events: [
          { id: "1", connectionId: "c", title: "A", startAt: at("09:00"), endAt: at("11:00") },
          { id: "2", connectionId: "c", title: "B", startAt: at("10:00"), endAt: at("12:00") },
          {
            id: "3",
            connectionId: "c",
            title: "취소",
            startAt: at("13:00"),
            endAt: at("14:00"),
            cancelled: true,
          },
        ],
      })}
    />,
  );
  fireEvent.change(screen.getByLabelText(/^조회 날짜\s*\*?$/), { target: { value: "2026-09-15" } });
  fireEvent.click(screen.getByRole("button", { name: "연결한 캘린더의 빈 시간 보기" }));
  expect(
    screen.getByText(
      new Date(at("12:00")).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) +
        " – 24:00",
    ),
  ).toBeTruthy();
});

it("saves reminder opt-in only on explicit form submission", async () => {
  render(<CalendarTool act={act} widget={widget("calendar", { connections: [], events: [] })} />);
  expect(screen.getByLabelText("일정 알림 켜기")).toHaveProperty("checked", false);
  fireEvent.click(screen.getByLabelText("일정 알림 켜기"));
  expect(act).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "알림 설정 저장" }));
  await waitFor(() =>
    expect(act).toHaveBeenCalledWith("configure-alerts", {
      enabled: true,
      leadMinutes: 10,
      includeAllDay: false,
      quietStart: "22:00",
      quietEnd: "08:00",
    }),
  );
});

it("does not infer free time outside the fetched range or from stale connections", () => {
  const view = render(
    <CalendarTool
      act={act}
      widget={widget("calendar", {
        connections: [{ id: "c", name: "일정", status: "ready", lastSuccessAt: Date.now() }],
        events: [],
      })}
    />,
  );
  fireEvent.change(screen.getByLabelText(/^조회 날짜\s*\*?$/), { target: { value: "2029-01-01" } });
  fireEvent.click(screen.getByRole("button", { name: "연결한 캘린더의 빈 시간 보기" }));
  expect(screen.getByText(/선택한 날짜는 조회 범위 밖/)).toBeTruthy();
  expect(screen.queryByText(/– 24:00/)).toBeNull();
  fireEvent.change(screen.getByLabelText(/^조회 날짜\s*\*?$/), { target: { value: "2026-09-15" } });
  view.rerender(
    <CalendarTool
      act={act}
      widget={widget("calendar", {
        connections: [
          { id: "c", name: "일정", status: "offline", lastSuccessAt: Date.now() - 3600000 },
        ],
        events: [],
      })}
    />,
  );
  expect(screen.getByText(/조회 정보가 오래됐거나/)).toBeTruthy();
  expect(screen.queryByText(/– 24:00/)).toBeNull();
});
