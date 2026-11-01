// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { command } from "../../hooks/useSnapshot";
import type { DataRecord, ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import { CalendarTool } from "./CalendarTool";

vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));

function widget(connections: DataRecord[] = []): WidgetView {
  return {
    id: "calendar",
    kind: "calendar",
    reaction: true,
    revision: 1,
    version: 1,
    error: null,
    status: "enabled",
    missing: [],
    packageBytes: 0,
    data: { connections, events: [], settings: {} },
  };
}
const act = vi.fn<ToolAction>();
beforeEach(() => {
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(null);
  act.mockReset();
  act.mockResolvedValue(true);
});
afterEach(cleanup);

it("opens the alert section when the diary requests it", () => {
  const view = render(<CalendarTool mode="settings" widget={widget()} act={act} />);
  const details = screen.getByTitle("일정과 생활 알림").closest("details");
  expect(details?.open).toBe(false);
  view.rerender(<CalendarTool mode="settings" widget={widget()} act={act} alertsTarget={1} />);
  expect(details?.open).toBe(true);
});

it("opens reauthentication from an auth error and submits blank saved credentials", async () => {
  render(
    <CalendarTool
      mode="settings"
      widget={widget([
        {
          id: "google",
          name: "내 캘린더",
          provider: "google",
          status: "auth-error",
          selectedCalendarIds: ["primary"],
        },
      ])}
      act={act}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "다시 연결" }));
  expect(screen.getByLabelText("Google OAuth 클라이언트 ID")).toHaveProperty("required", false);
  fireEvent.click(screen.getByRole("button", { name: "브라우저에서 Google 읽기 연결" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("connect_calendar_google", {
      id: "calendar",
      connectionId: "google",
      input: { name: "내 캘린더", clientId: "", clientSecret: null, calendarIds: ["primary"] },
    }),
  );
});

it("places a failed connection error beside the form and preserves inputs", async () => {
  vi.mocked(command).mockRejectedValue(new Error("연결을 확인해 주세요."));
  render(<CalendarTool mode="settings" widget={widget()} act={act} />);
  fireEvent.click(screen.getByRole("button", { name: "+ 캘린더 연결…" }));
  fireEvent.change(screen.getByLabelText("연결 이름"), { target: { value: "구독" } });
  fireEvent.change(screen.getByLabelText("ICS / webcal 구독 주소"), {
    target: { value: "https://example.com/calendar.ics" },
  });
  fireEvent.click(screen.getByRole("button", { name: "구독 주소 연결" }));
  const error = await screen.findByRole("alert");
  expect(error.textContent).toContain("연결을 확인해 주세요.");
  expect(error.closest("form")).toBe(
    screen.getByRole("button", { name: "구독 주소 연결" }).closest("form"),
  );
  expect(screen.getByLabelText("연결 이름")).toHaveProperty("value", "구독");
  expect(screen.getByLabelText("ICS / webcal 구독 주소")).toHaveProperty(
    "value",
    "https://example.com/calendar.ics",
  );
});

it("continues refreshing all connections after a failure and summarizes it near the action", async () => {
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "refresh_calendar" && args?.connectionId === "first") {
      throw new Error("첫 연결 실패");
    }
    return null;
  });
  render(
    <CalendarTool
      mode="settings"
      widget={widget([
        {
          id: "first",
          name: "첫 연결",
          provider: "ics",
          status: "offline",
        },
        { id: "second", name: "두 번째", provider: "ics", status: "ready" },
      ])}
      act={act}
    />,
  );
  const section = screen.getByRole("region", { name: "캘린더 가져오기" });
  fireEvent.click(within(section).getByRole("button", { name: "다시 확인" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("refresh_calendar", {
      id: "calendar",
      connectionId: "second",
    }),
  );
  expect((await within(section).findByRole("alert")).textContent).toContain("1개 연결");
  expect(screen.getByText("첫 연결 실패").closest("section")?.textContent).toContain("첫 연결");
});

it("shows only one error when an individual refresh returns the stored connection error", async () => {
  vi.mocked(command).mockRejectedValue(new Error("조회하지 못했어요."));
  render(
    <CalendarTool
      mode="settings"
      widget={widget([
        {
          id: "first",
          name: "첫 연결",
          provider: "ics",
          status: "offline",
          error: "조회하지 못했어요.",
        },
      ])}
      act={act}
    />,
  );
  const card = screen.getByRole("heading", { name: "첫 연결" }).closest("section")!;
  fireEvent.click(within(card).getByRole("button", { name: "다시 확인" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("refresh_calendar", {
      id: "calendar",
      connectionId: "first",
    }),
  );
  await waitFor(() =>
    expect(within(card).getByRole("button", { name: "다시 확인" }).matches(":disabled")).toBe(
      false,
    ),
  );
  expect(within(card).getAllByText("조회하지 못했어요.")).toHaveLength(1);
});

it("updates the failure summary after an individual retry succeeds", async () => {
  let attempts = 0;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "refresh_calendar" && attempts++ === 0) throw new Error("첫 연결 실패");
    return null;
  });
  render(
    <CalendarTool
      mode="settings"
      widget={widget([{ id: "first", name: "첫 연결", provider: "ics", status: "offline" }])}
      act={act}
    />,
  );
  const section = screen.getByRole("region", { name: "캘린더 가져오기" });
  fireEvent.click(within(section).getByRole("button", { name: "다시 확인" }));
  expect((await within(section).findByRole("alert")).textContent).toContain("1개 연결");
  const card = screen.getByRole("heading", { name: "첫 연결" }).closest("section")!;
  fireEvent.click(within(card).getByRole("button", { name: "다시 확인" }));
  await waitFor(() => expect(within(section).queryByRole("alert")).toBeNull());
  expect(within(card).queryByText("첫 연결 실패")).toBeNull();
});

it("clears the previous failure and summary when a background refresh recovers", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "refresh_calendar") throw new Error("첫 연결 실패");
    return null;
  });
  const connection = {
    id: "first",
    name: "첫 연결",
    provider: "ics",
    status: "offline",
    error: "오프라인",
  };
  const { rerender } = render(
    <CalendarTool mode="settings" widget={widget([connection])} act={act} />,
  );
  const section = screen.getByRole("region", { name: "캘린더 가져오기" });
  const card = screen.getByRole("heading", { name: "첫 연결" }).closest("section")!;
  fireEvent.click(within(section).getByRole("button", { name: "다시 확인" }));
  expect((await within(section).findByRole("alert")).textContent).toContain("1개 연결");
  expect(within(card).getByText("첫 연결 실패")).toBeTruthy();
  rerender(
    <CalendarTool
      mode="settings"
      widget={widget([{ ...connection, status: "ready", error: null, lastSuccessAt: Date.now() }])}
      act={act}
    />,
  );
  expect(within(section).queryByRole("alert")).toBeNull();
  expect(within(card).queryByText("첫 연결 실패")).toBeNull();
  expect(screen.getByText("연결됨")).toBeTruthy();
});

it("replaces an earlier failure when the connection error changes", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "refresh_calendar") throw new Error("첫 연결 실패");
    return null;
  });
  const connection = {
    id: "first",
    name: "첫 연결",
    provider: "ics",
    status: "offline",
    error: "오프라인",
  };
  const { rerender } = render(
    <CalendarTool mode="settings" widget={widget([connection])} act={act} />,
  );
  const card = screen.getByRole("heading", { name: "첫 연결" }).closest("section")!;
  fireEvent.click(
    within(screen.getByRole("region", { name: "캘린더 가져오기" })).getByRole("button", {
      name: "다시 확인",
    }),
  );
  expect(await within(card).findByText("첫 연결 실패")).toBeTruthy();
  rerender(
    <CalendarTool
      mode="settings"
      widget={widget([{ ...connection, error: "새 오류" }])}
      act={act}
    />,
  );
  expect(within(card).queryByText("첫 연결 실패")).toBeNull();
  expect(within(card).getByText("새 오류")).toBeTruthy();
});

it("retains a failure summary when its matching connection error arrives later", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "refresh_calendar") throw new Error("첫 연결 실패");
    return null;
  });
  const connection = {
    id: "first",
    name: "첫 연결",
    provider: "ics",
    status: "offline",
    error: "오프라인",
  };
  const { rerender } = render(
    <CalendarTool mode="settings" widget={widget([connection])} act={act} />,
  );
  const section = screen.getByRole("region", { name: "캘린더 가져오기" });
  fireEvent.click(within(section).getByRole("button", { name: "다시 확인" }));
  expect(await within(section).findByRole("alert")).toBeTruthy();
  rerender(
    <CalendarTool
      mode="settings"
      widget={widget([{ ...connection, error: "첫 연결 실패" }])}
      act={act}
    />,
  );
  expect(within(section).getByRole("alert")).toBeTruthy();
});

it("does not show a late failure after the connection has already recovered", async () => {
  let fail: (error: Error) => void = () => {};
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "refresh_calendar")
      return new Promise((_, reject) => {
        fail = reject;
      });
    return null;
  });
  const connection = {
    id: "first",
    name: "첫 연결",
    provider: "ics",
    status: "offline",
    error: "오프라인",
  };
  const { rerender } = render(
    <CalendarTool mode="settings" widget={widget([connection])} act={act} />,
  );
  const section = screen.getByRole("region", { name: "캘린더 가져오기" });
  const card = screen.getByRole("heading", { name: "첫 연결" }).closest("section")!;
  fireEvent.click(within(section).getByRole("button", { name: "다시 확인" }));
  rerender(
    <CalendarTool
      mode="settings"
      widget={widget([{ ...connection, status: "ready", error: null, lastSuccessAt: Date.now() }])}
      act={act}
    />,
  );
  fail(new Error("늦은 실패"));
  await waitFor(() =>
    expect(within(section).getByRole("button", { name: "다시 확인" }).matches(":disabled")).toBe(
      false,
    ),
  );
  expect(within(section).queryByRole("alert")).toBeNull();
  expect(within(card).queryByText("늦은 실패")).toBeNull();
});

it("does not replace a newer connection error with a late failure", async () => {
  let fail: (error: Error) => void = () => {};
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "refresh_calendar")
      return new Promise((_, reject) => {
        fail = reject;
      });
    return null;
  });
  const connection = {
    id: "first",
    name: "첫 연결",
    provider: "ics",
    status: "offline",
    error: "오프라인",
  };
  const { rerender } = render(
    <CalendarTool mode="settings" widget={widget([connection])} act={act} />,
  );
  const section = screen.getByRole("region", { name: "캘린더 가져오기" });
  const card = screen.getByRole("heading", { name: "첫 연결" }).closest("section")!;
  fireEvent.click(within(section).getByRole("button", { name: "다시 확인" }));
  rerender(
    <CalendarTool
      mode="settings"
      widget={widget([{ ...connection, error: "새 오류" }])}
      act={act}
    />,
  );
  fail(new Error("늦은 실패"));
  await waitFor(() =>
    expect(within(section).getByRole("button", { name: "다시 확인" }).matches(":disabled")).toBe(
      false,
    ),
  );
  expect(within(card).getByText("새 오류")).toBeTruthy();
  expect(within(card).queryByText("늦은 실패")).toBeNull();
});

it("keeps Google cancellation and reopening available while approval is pending", async () => {
  let finish: (value: null) => void = () => {};
  vi.mocked(command).mockImplementation(async (name) =>
    name === "connect_calendar_google"
      ? new Promise<null>((resolve) => {
          finish = resolve;
        })
      : null,
  );
  const onBusyChange = vi.fn();
  render(
    <CalendarTool
      mode="settings"
      onBusyChange={onBusyChange}
      widget={widget([
        {
          id: "google",
          name: "내 캘린더",
          provider: "google",
          status: "auth-error",
          selectedCalendarIds: ["primary"],
        },
      ])}
      act={act}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "다시 연결" }));
  fireEvent.click(screen.getByRole("button", { name: "브라우저에서 Google 읽기 연결" }));
  const cancel = await screen.findByRole("button", { name: "Google 연결 취소" });
  expect(cancel.matches(":disabled")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "브라우저 다시 열기" }));
  fireEvent.click(cancel);
  expect(command).toHaveBeenCalledWith("reopen_calendar_google", { id: "calendar" });
  expect(command).toHaveBeenCalledWith("cancel_calendar_google", { id: "calendar" });
  finish(null);
  await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
});
