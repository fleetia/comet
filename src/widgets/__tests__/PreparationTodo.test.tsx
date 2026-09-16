import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TodoTool } from "../TodoTool";
import { PreparationTool } from "../PreparationTool";
import { command } from "../../hooks/useSnapshot";
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
beforeEach(() => {
  act.mockReset();
  act.mockResolvedValue(true);
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(undefined);
});
afterEach(cleanup);
it("filters recurring tasks within the selected named list without changing stored items", () => {
  render(
    <TodoTool
      widget={widget("todo", {
        lists: [
          { id: "default", name: "할 일" },
          { id: "work", name: "업무" },
        ],
        items: [
          { id: "a", title: "물 마시기", listId: "default", repeat: "daily", completedAt: null },
          { id: "b", title: "주간 보고", listId: "work", repeat: "weekly", completedAt: null },
          { id: "c", title: "장비 교체", listId: "work", repeat: "none", completedAt: null },
        ],
      })}
      act={act}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "루틴" }));
  expect(screen.queryByText("장비 교체")).toBeNull();
  expect(screen.getByText("물 마시기")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("조회할 목록"), { target: { value: "work" } });
  expect(screen.queryByText("물 마시기")).toBeNull();
  expect(screen.getByText("주간 보고")).toBeTruthy();
  expect(act).not.toHaveBeenCalled();
});
const preparation = widget("preparation", {
  envelopes: [
    {
      id: "envelope",
      eventId: "event",
      eventLabel: "팀 회의",
      checks: [{ id: "check", text: "자료 준비", done: false }],
      links: [{ id: "link", title: "발표 자료", url: "https://example.com/slides" }],
      todoIds: [],
    },
  ],
});
it("opens preparation links through the native allowlist and keeps disconnected checklists editable", async () => {
  render(<PreparationTool widget={preparation} widgets={[]} act={act} />);
  expect(screen.getByText(/연결 끊김.*캘린더가 꺼져/)).toBeTruthy();
  expect(screen.queryByRole("link", { name: "발표 자료" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "발표 자료" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_widget_link", {
      id: "preparation",
      url: "https://example.com/slides",
    }),
  );
  fireEvent.click(screen.getByLabelText("자료 준비"));
  expect(act).toHaveBeenCalledWith("check-toggle", { id: "envelope", checkId: "check" });
});
it("distinguishes stale source data from a cancelled or removed event", () => {
  const calendar = (status: string, cancelled = false): WidgetView =>
    widget("calendar", {
      connections: [{ id: "source", status }],
      events: [{ id: "event", connectionId: "source", cancelled, title: "팀 회의" }],
    });
  const view = render(
    <PreparationTool widget={preparation} widgets={[calendar("auth-error")]} act={act} />,
  );
  expect(screen.getByText(/이전 일정 정보/)).toBeTruthy();
  view.rerender(
    <PreparationTool widget={preparation} widgets={[calendar("ready", true)]} act={act} />,
  );
  expect(screen.getByText(/연결 끊김.*원본 일정/)).toBeTruthy();
  expect(screen.getByLabelText("자료 준비")).toBeTruthy();
  view.rerender(<PreparationTool widget={preparation} widgets={[calendar("ready")]} act={act} />);
  expect(screen.queryByText(/연결 끊김/)).toBeNull();
  expect(screen.queryByText(/이전 일정 정보/)).toBeNull();
});

it("rolls a 01:00 KST task to the chosen local day with an explicit timestamp", async () => {
  vi.stubEnv("TZ", "Asia/Seoul");
  try {
    const original = new Date("2026-09-15T01:00:00+09:00").getTime();
    render(
      <TodoTool
        widget={widget("todo", {
          lists: [{ id: "default", name: "할 일" }],
          items: [
            {
              id: "early",
              title: "새벽 일정",
              listId: "default",
              repeat: "none",
              completedAt: null,
              dueAt: original,
              dueDate: null,
            },
          ],
        })}
        act={act}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "하루 마무리" }));
    fireEvent.click(screen.getByLabelText("이월할 항목 선택"));
    fireEvent.change(screen.getByLabelText(/^이월 날짜\s*\*?$/), {
      target: { value: "2026-09-16" },
    });
    fireEvent.click(screen.getByRole("button", { name: "선택한 항목만 이월" }));
    await waitFor(() =>
      expect(act).toHaveBeenCalledWith("rollover", {
        ids: ["early"],
        date: "2026-09-16",
        dueAtById: { early: new Date("2026-09-16T01:00:00+09:00").getTime() },
      }),
    );
  } finally {
    vi.unstubAllEnvs();
  }
});

it("keeps the rollover draft when daylight saving makes the target wall time nonexistent", async () => {
  vi.stubEnv("TZ", "America/New_York");
  try {
    render(
      <TodoTool
        widget={widget("todo", {
          lists: [{ id: "default", name: "할 일" }],
          items: [
            {
              id: "dst",
              title: "새벽 일정",
              listId: "default",
              repeat: "none",
              completedAt: null,
              dueAt: new Date("2026-03-07T02:30:00-05:00").getTime(),
              dueDate: null,
            },
          ],
        })}
        act={act}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "하루 마무리" }));
    fireEvent.click(screen.getByLabelText("이월할 항목 선택"));
    fireEvent.change(screen.getByLabelText(/^이월 날짜\s*\*?$/), {
      target: { value: "2026-03-08" },
    });
    fireEvent.click(screen.getByRole("button", { name: "선택한 항목만 이월" }));
    expect(await screen.findByRole("alert")).toHaveProperty(
      "textContent",
      expect.stringContaining("같은 지역 시각이 존재하지 않습니다"),
    );
    expect(act).not.toHaveBeenCalled();
    expect(screen.getByLabelText("이월할 항목 선택")).toHaveProperty("checked", true);
  } finally {
    vi.unstubAllEnvs();
  }
});

it("focuses an existing task in the top composer and clears its scheduling choices on cancel", async () => {
  act.mockResolvedValue(false);
  render(
    <TodoTool
      widget={widget("todo", {
        lists: [
          { id: "default", name: "할 일" },
          { id: "work", name: "업무" },
        ],
        items: [
          {
            id: "task",
            title: "기존 할 일",
            memo: "  본문\n그대로  ",
            listId: "work",
            repeat: "weekly",
            dueDate: "2026-09-20",
            completedAt: null,
          },
        ],
      })}
      act={act}
    />,
  );
  const input = screen.getByLabelText(/^할 일 제목\s*\*?$/);
  expect(
    input.compareDocumentPosition(screen.getByLabelText("기존 할 일")) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "수정" }));
  expect(document.activeElement).toBe(input);
  expect(screen.getByText("메모 · 목록 · 기한 · 반복").closest("details")).toHaveProperty(
    "open",
    true,
  );
  expect(screen.getByLabelText("메모")).toHaveProperty("value", "  본문\n그대로  ");
  fireEvent.click(screen.getByRole("button", { name: "변경 저장" }));
  await waitFor(() =>
    expect(act).toHaveBeenCalledWith("update", {
      id: "task",
      title: "기존 할 일",
      memo: "  본문\n그대로  ",
      listId: "work",
      repeat: "weekly",
      dueDate: "2026-09-20",
      dueAt: null,
    }),
  );
  expect(input).toHaveProperty("value", "기존 할 일");
  expect(screen.getByLabelText("메모")).toHaveProperty("value", "  본문\n그대로  ");
  act.mockClear();
  fireEvent.click(screen.getByRole("button", { name: "수정 취소" }));
  expect(act).not.toHaveBeenCalled();
  expect(input).toHaveProperty("value", "");
  expect(screen.getByLabelText("반복")).toHaveProperty("value", "none");
  expect(screen.getByLabelText("기한 종류")).toHaveProperty("value", "none");
  fireEvent.change(input, { target: { value: "새 할 일" } });
  fireEvent.click(screen.getByRole("button", { name: "할 일 추가" }));
  await waitFor(() =>
    expect(act).toHaveBeenCalledWith("add", {
      title: "새 할 일",
      memo: "",
      listId: "default",
      repeat: "none",
      dueDate: null,
      dueAt: null,
    }),
  );
});
