import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WidgetManager } from "../WidgetManager/WidgetManager";
import { useWidgets, PREVIEW_WIDGETS } from "../useWidgets";
import { command, isDesktop } from "../../hooks/useSnapshot";
import type { WidgetView } from "../types";

vi.mock("../useWidgets", async (load) => ({
  ...(await load<typeof import("../useWidgets")>()),
  useWidgets: vi.fn(),
}));
vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(),
}));

const reload = vi.fn();
function installed(kind: string, enabled = true): WidgetView {
  return {
    id: kind,
    kind,
    enabled,
    installed: true,
    revision: 1,
    version: 1,
    data: {},
    error: null,
    status: enabled ? "enabled" : "disabled",
    missing: [],
    packageBytes: 1,
  };
}

beforeEach(() => {
  reload.mockReset();
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(undefined);
  vi.mocked(isDesktop).mockReturnValue(true);
  vi.mocked(useWidgets).mockReturnValue({ snapshot: PREVIEW_WIDGETS, error: null, reload });
  HTMLDialogElement.prototype.showModal = function (): void {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function (): void {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

it("keeps installation choices through search, category and installation filters", () => {
  render(<WidgetManager embedded />);
  fireEvent.click(screen.getByLabelText("할 일 설치 선택"));
  fireEvent.change(screen.getByRole("searchbox", { name: "위젯 검색" }), {
    target: { value: "날씨" },
  });
  expect(screen.queryByLabelText("할 일 설치 선택")).toBeNull();
  expect(screen.getByLabelText("날씨 설치 선택")).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "위젯 분류" }), {
    target: { value: "play" },
  });
  expect(screen.getByText("찾는 위젯이 없어요. 검색어나 필터를 바꿔 보세요.")).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "설치 상태" }), {
    target: { value: "installed" },
  });
  expect(screen.getByRole("button", { name: "선택한 위젯 설치 (1)" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "위젯 없이 시작하기" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.change(screen.getByRole("combobox", { name: "설치 상태" }), {
    target: { value: "all" },
  });
  fireEvent.change(screen.getByRole("searchbox", { name: "위젯 검색" }), { target: { value: "" } });
  fireEvent.change(screen.getByRole("combobox", { name: "위젯 분류" }), {
    target: { value: "all" },
  });
  expect(screen.getByLabelText("할 일 설치 선택")).toHaveProperty("checked", true);
  fireEvent.click(screen.getByRole("button", { name: "선택 해제" }));
  expect(screen.getByRole("button", { name: "위젯 없이 시작하기" })).toHaveProperty(
    "disabled",
    false,
  );
  expect(command).not.toHaveBeenCalled();
});

it("requires confirmation before installing a selection and enabling its required dependency", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { ...PREVIEW_WIDGETS, widgets: [installed("calendar", false)] },
    error: null,
    reload,
  });
  render(<WidgetManager embedded />);
  expect(screen.getByRole("region", { name: "캘린더 설정" })).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "설치 상태" }), {
    target: { value: "all" },
  });
  expect(screen.queryByLabelText("캘린더 설치 선택")).toBeNull();
  fireEvent.click(screen.getByLabelText("준비 봉투 설치 선택"));
  fireEvent.click(screen.getByRole("button", { name: "선택한 위젯 설치 (1)" }));
  expect(screen.getByText("필수 위젯도 함께 설치하거나 켭니다: 캘린더")).toBeTruthy();
  expect(
    vi
      .mocked(command)
      .mock.calls.filter(([name]) => name !== "get_planner_notification_permission"),
  ).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "설치 확인" }));
  await waitFor(() =>
    expect(
      vi
        .mocked(command)
        .mock.calls.filter(([name]) => name !== "get_planner_notification_permission"),
    ).toEqual([["install_widgets", { kinds: ["preparation", "calendar"] }]]),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("button", { name: "선택한 위젯 설치 (1)" })).toBeNull();
});

it("closes the native confirmation on an external tab switch while preserving the selection", () => {
  HTMLDialogElement.prototype.close = function (): void {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  const view = render(
    <div>
      <WidgetManager embedded />
    </div>,
  );
  fireEvent.click(screen.getByLabelText("할 일 설치 선택"));
  fireEvent.click(screen.getByRole("button", { name: "선택한 위젯 설치 (1)" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveProperty("open", true);

  view.rerender(
    <div hidden>
      <WidgetManager embedded active={false} />
    </div>,
  );
  expect(dialog).toHaveProperty("open", false);
  expect(command).not.toHaveBeenCalled();

  view.rerender(
    <div>
      <WidgetManager embedded active />
    </div>,
  );
  expect(dialog).toHaveProperty("open", true);
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(dialog).toHaveProperty("open", false);
  expect(screen.getByLabelText("할 일 설치 선택")).toHaveProperty("checked", true);
});

it("opens preserved local data with a missing dependency and pauses a running widget separately", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: {
      ...PREVIEW_WIDGETS,
      onboardingDone: true,
      widgets: [
        installed("todo"),
        { ...installed("preparation"), status: "setup", missing: ["calendar"] },
      ],
    },
    error: null,
    reload,
  });
  render(<WidgetManager embedded />);
  fireEvent.change(screen.getByRole("combobox", { name: "설치 상태" }), {
    target: { value: "attention" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^준비 봉투/ }));
  expect(screen.queryByRole("button", { name: /^할 일 켜짐$/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "위젯 실행 ↗" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("open_widget", { id: "preparation" }));
  await waitFor(() => expect(screen.getByLabelText("위젯 사용")).toHaveProperty("disabled", false));
  fireEvent.change(screen.getByRole("combobox", { name: "설치 상태" }), {
    target: { value: "all" },
  });
  fireEvent.click(screen.getByRole("button", { name: /^할 일 켜짐$/ }));
  fireEvent.click(screen.getByLabelText("위젯 사용"));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("set_widget_enabled", { id: "todo", enabled: false }),
  );
});

it("shows dependent tools before removal and preserves written data by default", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { ...PREVIEW_WIDGETS, widgets: [installed("todo"), installed("completion-jar")] },
    error: null,
    reload,
  });
  render(<WidgetManager embedded />);
  fireEvent.click(screen.getByRole("button", { name: "위젯 제거" }));
  expect(screen.getByText(/필수 연결을 사용할 수 없게 되는 도구: 완료 구슬병/)).toBeTruthy();
  expect(screen.getByLabelText("이 위젯의 작성 데이터도 삭제")).toHaveProperty("checked", false);
  expect(command).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "제거 확인" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledExactlyOnceWith("remove_widget", {
      id: "todo",
      deleteData: false,
    }),
  );
});

it("preserves the explicit deletion choice and the error when removal fails", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { ...PREVIEW_WIDGETS, widgets: [installed("memo")] },
    error: null,
    reload,
  });
  vi.mocked(command).mockRejectedValue(new Error("저장 실패"));
  render(<WidgetManager embedded />);
  fireEvent.click(screen.getByRole("button", { name: "위젯 제거" }));
  fireEvent.click(screen.getByLabelText("이 위젯의 작성 데이터도 삭제"));
  fireEvent.click(screen.getByRole("button", { name: "제거 확인" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "저장 실패");
  expect(command).toHaveBeenCalledWith("remove_widget", { id: "memo", deleteData: true });
  expect(screen.getByLabelText("이 위젯의 작성 데이터도 삭제")).toHaveProperty("checked", true);
  expect(reload).not.toHaveBeenCalled();
});

it.each([false, true])(
  "finishes optional onboarding without closing the shared settings when embedded=%s",
  async (embedded) => {
    render(<WidgetManager embedded={embedded} />);
    expect(screen.queryByRole("button", { name: "위젯 관리 닫기" }) !== null).toBe(!embedded);
    fireEvent.click(screen.getByRole("button", { name: "위젯 없이 시작하기" }));
    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(command).toHaveBeenCalledWith("finish_widget_onboarding", undefined);
    if (embedded) {
      expect(command).toHaveBeenCalledTimes(1);
    } else {
      expect(command).toHaveBeenCalledWith("close_widgets");
    }
  },
);

it("allows browsing the catalog but never installs preview data", () => {
  vi.mocked(isDesktop).mockReturnValue(false);
  render(<WidgetManager embedded />);
  fireEvent.click(screen.getByLabelText("할 일 설치 선택"));
  expect(screen.getByRole("button", { name: "선택한 위젯 설치 (1)" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(command).not.toHaveBeenCalled();
});

it("retries a failed embedded snapshot without adding a second window header", () => {
  vi.mocked(useWidgets).mockReturnValue({ snapshot: null, error: "불러오기 실패", reload });
  render(<WidgetManager embedded />);
  expect(screen.queryByRole("button", { name: "위젯 관리 닫기" })).toBeNull();
  expect(screen.getByRole("alert")).toHaveProperty("textContent", "불러오기 실패");
  fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
  expect(reload).toHaveBeenCalledTimes(1);
});

it("keeps task execution outside settings and opens the native tool without changing enabled state", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { ...PREVIEW_WIDGETS, onboardingDone: true, widgets: [installed("todo")] },
    error: null,
    reload,
  });
  render(<WidgetManager embedded />);
  expect(screen.queryByLabelText("할 일 제목")).toBeNull();
  expect(screen.getAllByRole("button", { pressed: true })).toHaveLength(1);
  expect(screen.getByRole("region", { name: "공식 위젯 목록" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "위젯 실행 ↗" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledExactlyOnceWith("open_widget", { id: "todo" }),
  );
});

it("shows connection settings in place without running the widget", () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: {
      ...PREVIEW_WIDGETS,
      onboardingDone: true,
      widgets: [
        { ...installed("music"), status: "setup", data: { configured: false, config: {} } },
      ],
    },
    error: null,
    reload,
  });
  render(<WidgetManager embedded />);
  expect(screen.getByLabelText("음악 앱")).toBeTruthy();
  expect(screen.getByRole("button", { name: "곡 정보 조회·재생 제어 허용하고 연결" })).toBeTruthy();
  expect(command).not.toHaveBeenCalled();
});

it("preserves installation selection and its dialog when installation fails", async () => {
  vi.mocked(command).mockRejectedValue(new Error("설치 실패"));
  render(<WidgetManager embedded />);
  fireEvent.click(screen.getByLabelText("할 일 설치 선택"));
  fireEvent.click(screen.getByRole("button", { name: "선택한 위젯 설치 (1)" }));
  fireEvent.click(screen.getByRole("button", { name: "설치 확인" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "설치 실패");
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByLabelText("할 일 설치 선택")).toHaveProperty("checked", true);
  expect(command).toHaveBeenCalledExactlyOnceWith("install_widgets", { kinds: ["todo"] });
});

it("tracks and retains separate widget setting drafts across selection and snapshot refresh", async () => {
  const music = {
    ...installed("music"),
    data: { configured: true, config: { provider: "music" } },
  };
  const calendar = {
    ...installed("calendar"),
    data: { connections: [], events: [], reminders: { enabled: false, leadMinutes: 10 } },
  };
  const snapshot = { ...PREVIEW_WIDGETS, onboardingDone: true, widgets: [music, calendar] };
  vi.mocked(useWidgets).mockReturnValue({ snapshot, error: null, reload });
  const dirty = vi.fn();
  const view = render(<WidgetManager embedded onDirtyChange={dirty} />);
  fireEvent.click(screen.getByRole("button", { name: /^음악 정보/ }));
  fireEvent.change(screen.getByLabelText("음악 앱"), { target: { value: "spotify" } });
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true));
  fireEvent.click(screen.getByRole("button", { name: /^캘린더/ }));
  fireEvent.change(screen.getByLabelText(/^연결 이름/), { target: { value: "개인 일정" } });
  fireEvent.change(screen.getByLabelText(/^ICS \/ webcal/), {
    target: { value: "https://example.com/private.ics" },
  });
  fireEvent.click(screen.getByLabelText("일정·할 일 기한 알림 켜기"));
  fireEvent.click(screen.getByRole("button", { name: /^음악 정보/ }));
  expect(screen.getByLabelText("음악 앱")).toHaveProperty("value", "spotify");
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: {
      ...snapshot,
      widgets: snapshot.widgets.map((item) => ({
        ...item,
        revision: item.revision + 1,
        data: { ...item.data },
      })),
    },
    error: null,
    reload,
  });
  view.rerender(<WidgetManager embedded onDirtyChange={dirty} />);
  expect(screen.getByLabelText("음악 앱")).toHaveProperty("value", "spotify");
  fireEvent.click(screen.getByRole("button", { name: "연결 변경 취소" }));
  expect(dirty).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: /^캘린더/ }));
  expect(screen.getByLabelText(/^연결 이름/)).toHaveProperty("value", "개인 일정");
  expect(screen.getByLabelText("일정·할 일 기한 알림 켜기")).toHaveProperty("checked", true);
  fireEvent.click(screen.getByRole("button", { name: "연결 입력 지우기" }));
  fireEvent.click(screen.getByRole("button", { name: "알림 변경 취소" }));
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
  expect(
    vi
      .mocked(command)
      .mock.calls.filter(([name]) => name !== "get_planner_notification_permission"),
  ).toEqual([]);
});
