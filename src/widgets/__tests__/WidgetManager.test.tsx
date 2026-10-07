import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { WidgetManager } from "../WidgetManager/WidgetManager";
import { useWidgetRuntime } from "../useWidgetRuntime";
import { useWidgets, PREVIEW_WIDGETS } from "../useWidgets";
import { command, isDesktop } from "../../hooks/useSnapshot";
import type { WidgetView } from "../types";
import { useGeneratedWidgets } from "../GeneratedWidgets/useGeneratedWidgets";
import type { GeneratedWidget, Workshop } from "../GeneratedWidgets/types";

vi.mock("../useWidgets", async (load) => ({
  ...(await load<typeof import("../useWidgets")>()),
  useWidgets: vi.fn(),
}));
vi.mock("../GeneratedWidgets/useGeneratedWidgets", () => ({ useGeneratedWidgets: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(),
}));

vi.mock("../useWidgetRuntime", () => ({ useWidgetRuntime: vi.fn() }));

const reload = vi.fn();
const reloadGenerated = vi.fn();
const eligibility: Workshop["generationEligibility"] = {
  allowed: true,
  model: "test-12b",
  reason: "12B 모델로 만들 수 있어요.",
  parameterBillions: 12,
  source: "catalog",
};
function generated(overrides: Partial<GeneratedWidget> = {}): GeneratedWidget {
  return {
    id: "generated-counter",
    definition: {
      name: "단수 세기",
      description: "뜨개질 단수를 기록해요",
      source: "",
      initialState: { count: 0 },
    },
    state: { count: 3 },
    revision: 2,
    installed: true,
    enabled: true,
    status: "ready",
    error: null,
    installation: { origin: "manual", model: "test-12b", installedAt: 1759104000000 },
    updatedAt: 1759104000000,
    ...overrides,
  };
}
function generatedSnapshot(widgets: GeneratedWidget[], error: string | null = null): void {
  vi.mocked(useGeneratedWidgets).mockReturnValue({
    workshop: {
      widgets,
      automatic: true,
      runtime: "javascript",
      generationEligibility: eligibility,
    },
    error,
    reload: reloadGenerated,
  });
}
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
  localStorage.setItem(
    "comet.widget-groups",
    JSON.stringify({ daily: true, play: true, information: true, generated: true }),
  );
  reload.mockReset();
  reloadGenerated.mockReset();
  generatedSnapshot([]);
  vi.mocked(useWidgetRuntime).mockReturnValue({
    snapshot: {
      sequence: 1,
      widgets: PREVIEW_WIDGETS.catalog.map((item) => ({
        id: item.id,
        toolWindow: { state: "closed", shared: null },
        displayWindow: "closed",
        noteWindows: null,
        toys: { starting: 0, visible: 0 },
        queryError: null,
        actionError: null,
      })),
    },
    error: null,
    reload: () => undefined,
  });
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(undefined);
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockRejectedValue(new Error("Native events are unavailable in this test."));
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

it("preserves the initially selected widget draft when a native deep link changes the selection", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: {
      ...PREVIEW_WIDGETS,
      onboardingDone: true,
      widgets: [installed("clock"), installed("weather")],
    },
    error: null,
    reload,
  });
  vi.mocked(listen).mockResolvedValue(() => undefined);
  vi.mocked(command).mockResolvedValue(null);
  const onDirtyChange = vi.fn();
  render(<WidgetManager embedded onDirtyChange={onDirtyChange} />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_planner_settings_target"));

  fireEvent.click(screen.getByRole("button", { name: "바탕화면 꾸미기" }));
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: "글자 위치" })).getByRole("radio", {
      name: "오른쪽 아래",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "바탕화면 꾸미기" }));
  const receiveTarget = vi
    .mocked(listen)
    .mock.calls.find(([event]) => event === "planner-settings-target")?.[1];
  if (!receiveTarget) throw new Error("The planner settings listener was not registered.");

  act(() => receiveTarget({ event: "planner-settings-target", id: 1, payload: "weather" }));
  expect(screen.getByRole("textbox", { name: "지역 이름" })).toBeTruthy();
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  act(() => receiveTarget({ event: "planner-settings-target", id: 2, payload: "clock" }));
  expect(
    screen.getByRole("button", { name: "바탕화면 꾸미기" }).getAttribute("aria-expanded"),
  ).toBe("false");
  fireEvent.click(screen.getByRole("button", { name: "바탕화면 꾸미기" }));
  expect(
    within(screen.getByRole("radiogroup", { name: "글자 위치" }))
      .getByRole("radio", { name: "오른쪽 아래" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  expect(screen.getByRole("button", { name: "표시 설정 저장" })).toHaveProperty("disabled", false);
});

function openInstallation(name: string): void {
  fireEvent.click(screen.getByRole("button", { name: `${name} 미설치` }));
  fireEvent.click(screen.getByRole("button", { name: "위젯 설치" }));
}

it("browses the catalog with a search only, without a status filter, checkboxes or a batch selection", () => {
  render(<WidgetManager embedded />);
  const catalog = within(screen.getByRole("region", { name: "위젯 목록" }));
  expect(catalog.queryAllByRole("checkbox")).toEqual([]);
  expect(catalog.queryByRole("combobox")).toBeNull();
  expect(screen.queryByText(/^공식 \d+개/)).toBeNull();
  expect(catalog.getByText("위젯 · 14개")).toBeTruthy();
  expect(catalog.getByText("설치 0개")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "여러 개 설치" })).toBeNull();
  expect(screen.queryByRole("button", { name: /선택한 위젯 설치/ })).toBeNull();
  fireEvent.click(catalog.getByRole("button", { name: "할 일 미설치" }));
  expect(screen.getByRole("region", { name: "할 일 설정" })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "위젯 검색" }), {
    target: { value: "날씨" },
  });
  expect(catalog.queryByRole("button", { name: "할 일 미설치" })).toBeNull();
  expect(catalog.getByRole("button", { name: "날씨 미설치" })).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "위젯 검색" }), {
    target: { value: "없는 위젯" },
  });
  expect(screen.getByText("찾는 위젯이 없어요. 검색어를 바꿔 보세요.")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "위젯 검색" }), { target: { value: "" } });
  expect(catalog.getByRole("button", { name: "할 일 미설치" })).toBeTruthy();
  expect(catalog.queryAllByRole("checkbox")).toEqual([]);
  expect(command).not.toHaveBeenCalled();
});

it.each([false, true])(
  "installs preparation alone and without a confirmation when a disabled calendar is installed=%s",
  async (hasCalendar) => {
    vi.mocked(useWidgets).mockReturnValue({
      snapshot: {
        ...PREVIEW_WIDGETS,
        widgets: hasCalendar ? [installed("calendar", false)] : [],
      },
      error: null,
      reload,
    });
    render(<WidgetManager embedded />);
    openInstallation("준비 봉투");
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() =>
      expect(
        vi
          .mocked(command)
          .mock.calls.filter(([name]) => name !== "get_planner_notification_permission"),
      ).toEqual([["install_widgets", { kinds: ["preparation"] }]]),
    );
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
  },
);

it("confirms only installations that add required widgets and cancels them without a dirty draft", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: {
      ...PREVIEW_WIDGETS,
      catalog: PREVIEW_WIDGETS.catalog.map((item) =>
        item.id === "focus-timer" ? { ...item, required: ["todo"] } : item,
      ),
      widgets: [installed("todo", false)],
    },
    error: null,
    reload,
  });
  const dirty = vi.fn();
  render(<WidgetManager embedded onDirtyChange={dirty} />);
  openInstallation("집중 타이머");
  const dialog = within(screen.getByRole("dialog"));
  expect(dialog.getByText("집중 타이머")).toBeTruthy();
  expect(dialog.getByText("필수 위젯도 함께 설치하거나 켭니다: 할 일")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(dirty).toHaveBeenLastCalledWith(false);
  expect(command).not.toHaveBeenCalled();

  openInstallation("집중 타이머");
  fireEvent.click(screen.getByRole("button", { name: "설치 확인" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledExactlyOnceWith("install_widgets", {
      kinds: ["focus-timer", "todo"],
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("hides the native removal confirmation during an external tab switch", () => {
  HTMLDialogElement.prototype.close = function (): void {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { ...PREVIEW_WIDGETS, widgets: [installed("todo")] },
    error: null,
    reload,
  });
  const view = render(
    <div>
      <WidgetManager embedded />
    </div>,
  );
  fireEvent.click(screen.getByRole("button", { name: "위젯 제거" }));
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
  expect(
    within(screen.getByRole("region", { name: "위젯 목록" })).queryAllByRole("checkbox"),
  ).toEqual([]);
});

it("opens a calendar awaiting a connection and pauses a running widget separately", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: {
      ...PREVIEW_WIDGETS,
      onboardingDone: true,
      widgets: [
        installed("todo"),
        { ...installed("calendar"), status: "setup", data: { connections: [] } },
      ],
    },
    error: null,
    reload,
  });
  render(<WidgetManager embedded />);
  fireEvent.click(screen.getByRole("button", { name: /^캘린더 설정 필요$/ }));
  fireEvent.click(screen.getByRole("button", { name: "위젯 열기 ↗" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("open_widget", { id: "calendar" }));
  await waitFor(() => expect(screen.getByLabelText("위젯 사용")).toHaveProperty("disabled", false));
  fireEvent.click(screen.getByRole("button", { name: /^할 일 켜짐$/ }));
  fireEvent.click(screen.getByLabelText("위젯 사용"));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("set_widget_enabled", { id: "todo", enabled: false }),
  );
});

it("removes only calendar, preserves data by default, and leaves preparation available", async () => {
  const preparation = installed("preparation");
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { ...PREVIEW_WIDGETS, widgets: [installed("calendar"), preparation] },
    error: null,
    reload,
  });
  const view = render(<WidgetManager embedded />);
  expect(screen.queryByLabelText("위젯 더보기")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "위젯 제거" }));
  expect(screen.queryByText(/필수 연결을 사용할 수 없게 되는 도구/)).toBeNull();
  expect(screen.getByLabelText("이 위젯의 작성 데이터도 삭제")).toHaveProperty("checked", false);
  expect(command).not.toHaveBeenCalledWith("remove_widget", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "제거 확인" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("remove_widget", {
      id: "calendar",
      deleteData: false,
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { ...PREVIEW_WIDGETS, widgets: [preparation] },
    error: null,
    reload,
  });
  view.rerender(<WidgetManager embedded />);
  fireEvent.click(screen.getByRole("button", { name: "준비 봉투 켜짐" }));
  fireEvent.click(screen.getByRole("button", { name: "위젯 열기 ↗" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("open_widget", { id: "preparation" }));
  expect(vi.mocked(command).mock.calls.filter(([name]) => name === "remove_widget")).toEqual([
    ["remove_widget", { id: "calendar", deleteData: false }],
  ]);
  expect(command).not.toHaveBeenCalledWith("set_widget_enabled", {
    id: "preparation",
    enabled: false,
  });
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

it.each([false, true])("has no required onboarding completion when embedded=%s", (embedded) => {
  render(<WidgetManager embedded={embedded} />);
  expect(screen.queryByRole("button", { name: "위젯 관리 닫기" }) !== null).toBe(!embedded);
  expect(screen.queryByRole("button", { name: "위젯 없이 시작하기" })).toBeNull();
  expect(screen.queryByRole("button", { name: "위젯 선택 마치기" })).toBeNull();
  expect(command).not.toHaveBeenCalledWith("finish_widget_onboarding", expect.anything());
});

it("allows browsing the catalog but never installs preview data", () => {
  vi.mocked(isDesktop).mockReturnValue(false);
  render(<WidgetManager embedded />);
  fireEvent.click(screen.getByRole("button", { name: "할 일 미설치" }));
  expect(screen.getByRole("button", { name: "위젯 설치" })).toHaveProperty("disabled", true);
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
  expect(screen.getByRole("region", { name: "위젯 목록" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "위젯 열기 ↗" }));
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

it("opens official state rules from the widget header without changing its data", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { ...PREVIEW_WIDGETS, onboardingDone: true, widgets: [installed("todo")] },
    error: null,
    reload,
  });
  render(<WidgetManager embedded />);
  fireEvent.click(screen.getByRole("button", { name: "상태별 캐릭터 대사 편집" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledExactlyOnceWith("open_widget_state_rules", { id: "todo" }),
  );
});

it("keeps a failed installation selected and retries the same widget", async () => {
  vi.mocked(command).mockRejectedValueOnce(new Error("설치 실패"));
  render(<WidgetManager embedded />);
  openInstallation("할 일");
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "설치 실패");
  expect(screen.getByRole("region", { name: "할 일 설정" })).toBeTruthy();
  expect(command).toHaveBeenCalledExactlyOnceWith("install_widgets", { kinds: ["todo"] });
  expect(reload).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "위젯 설치" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(command).toHaveBeenNthCalledWith(2, "install_widgets", { kinds: ["todo"] });
  expect(command).toHaveBeenCalledTimes(2);
  expect(reload).toHaveBeenCalledTimes(1);
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
  fireEvent.click(screen.getByText("일정과 생활 알림", { selector: "summary" }));
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

it("includes created and imported widgets in the same list, counts and filters", () => {
  generatedSnapshot([
    generated(),
    generated({
      id: "imported",
      definition: { name: "물 마시기", description: "가져온 도구", source: "", initialState: {} },
      status: "draft",
      installation: { origin: "import", model: null, installedAt: 1759104000000 },
    }),
    generated({ id: "removed", installed: false }),
  ]);
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { ...PREVIEW_WIDGETS, widgets: [installed("todo")] },
    error: null,
    reload,
  });
  render(<WidgetManager embedded />);
  const list = within(screen.getByRole("region", { name: "위젯 목록" }));
  expect(list.getByRole("button", { name: "할 일 켜짐" })).toBeTruthy();
  expect(list.getByRole("button", { name: "단수 세기 켜짐" })).toBeTruthy();
  expect(list.getByRole("button", { name: "물 마시기 실행 검사 대기" })).toBeTruthy();
  expect(list.getByText("위젯 · 16개")).toBeTruthy();
  expect(list.getByText("설치 3개")).toBeTruthy();
  fireEvent.change(screen.getByRole("searchbox", { name: "위젯 검색" }), {
    target: { value: "AI·가져온" },
  });
  expect(list.queryByRole("button", { name: "할 일 켜짐" })).toBeNull();
  expect(
    list.getAllByRole("button").filter((button) => button.hasAttribute("aria-pressed")),
  ).toHaveLength(2);
  fireEvent.change(screen.getByRole("searchbox", { name: "위젯 검색" }), {
    target: { value: "뜨개질" },
  });
  expect(list.getByRole("button", { name: "단수 세기 켜짐" })).toBeTruthy();
  expect(list.queryByRole("button", { name: /^물 마시기/ })).toBeNull();
});

it("shows persisted installation information and retains it through state revision refreshes", () => {
  const widget = generated();
  generatedSnapshot([widget]);
  const view = render(<WidgetManager embedded />);
  fireEvent.click(screen.getByRole("button", { name: "단수 세기 켜짐" }));
  const details = within(screen.getByRole("region", { name: "단수 세기 설정" }));
  expect(details.getByText("AI 요청 제작")).toBeTruthy();
  expect(details.getByText("test-12b")).toBeTruthy();
  expect(details.getByText("generated-counter")).toBeTruthy();
  expect(
    details.getAllByText(new Date(widget.installation!.installedAt).toLocaleString("ko-KR")),
  ).toHaveLength(2);
  expect(screen.queryByLabelText("단수 세기 설치 선택")).toBeNull();
  generatedSnapshot([{ ...widget, revision: 8, state: { count: 20 } }]);
  view.rerender(<WidgetManager embedded />);
  expect(
    details.getAllByText(new Date(widget.installation!.installedAt).toLocaleString("ko-KR")),
  ).toHaveLength(2);
  generatedSnapshot([{ ...widget, installation: null, updatedAt: null }]);
  view.rerender(<WidgetManager embedded />);
  expect(details.getByText("이전 설치 · 정보 없음")).toBeTruthy();
  expect(details.getAllByText("기록 없음")).toHaveLength(3);
});

it("runs generated lifecycle actions with fresh revisions and preserves data on confirmed removal", async () => {
  let widget = generated();
  generatedSnapshot([widget]);
  const view = render(<WidgetManager embedded />);
  fireEvent.click(screen.getByRole("button", { name: "단수 세기 켜짐" }));
  fireEvent.click(screen.getByRole("button", { name: "위젯 실행 ↗" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_generated_widget", { id: widget.id }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "상태별 캐릭터 대사 편집" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "상태별 캐릭터 대사 편집" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_widget_state_rules", { id: widget.id }),
  );
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: "위젯 사용" })).toHaveProperty("disabled", false),
  );
  widget = { ...widget, revision: 9 };
  generatedSnapshot([widget]);
  view.rerender(<WidgetManager embedded />);
  fireEvent.click(screen.getByRole("checkbox", { name: "위젯 사용" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("set_generated_widget_enabled", {
      id: widget.id,
      expectedRevision: 9,
      enabled: false,
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "위젯 제거" })).toHaveProperty("disabled", false),
  );
  widget = { ...widget, revision: 10, enabled: false };
  generatedSnapshot([widget]);
  view.rerender(<WidgetManager embedded />);
  expect(screen.getByRole("button", { name: "단수 세기 꺼짐" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "위젯 실행 ↗" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "위젯 제거" }));
  expect(screen.queryByLabelText("이 위젯의 작성 데이터도 삭제")).toBeNull();
  expect(
    within(screen.getByRole("dialog")).getByText(
      "위젯 정의·작성 데이터·설치 정보는 이 기기에 보존합니다.",
    ),
  ).toBeTruthy();
  expect(command).not.toHaveBeenCalledWith("remove_generated_widget", expect.anything());
  generatedSnapshot([{ ...widget, revision: 11 }]);
  view.rerender(<WidgetManager embedded />);
  fireEvent.click(screen.getByRole("button", { name: "제거 확인" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("remove_generated_widget", {
      id: widget.id,
      expectedRevision: 11,
    }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  generatedSnapshot([{ ...widget, installed: false }]);
  view.rerender(<WidgetManager embedded />);
  expect(screen.queryByRole("button", { name: /^단수 세기/ })).toBeNull();
});

it("keeps official setting drafts and generated edit requests while switching the common list", async () => {
  generatedSnapshot([generated()]);
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: {
      ...PREVIEW_WIDGETS,
      widgets: [
        { ...installed("music"), data: { configured: true, config: { provider: "music" } } },
      ],
    },
    error: null,
    reload,
  });
  const dirty = vi.fn();
  const view = render(<WidgetManager embedded onDirtyChange={dirty} />);
  fireEvent.change(screen.getByLabelText("음악 앱"), { target: { value: "spotify" } });
  fireEvent.click(screen.getByRole("button", { name: "단수 세기 켜짐" }));
  fireEvent.change(screen.getByRole("textbox", { name: "수정할 내용" }), {
    target: { value: "목표 단수를 추가해 줘" },
  });
  fireEvent.click(screen.getByRole("button", { name: "음악 정보 켜짐" }));
  expect(screen.getByLabelText("음악 앱")).toHaveProperty("value", "spotify");
  expect(screen.queryByRole("textbox", { name: "수정할 내용" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "연결 변경 취소" }));
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true));
  generatedSnapshot([generated({ revision: 12 })]);
  view.rerender(<WidgetManager embedded onDirtyChange={dirty} />);
  fireEvent.click(screen.getByRole("button", { name: "단수 세기 켜짐" }));
  expect(screen.getByRole("textbox", { name: "수정할 내용" })).toHaveProperty(
    "value",
    "목표 단수를 추가해 줘",
  );
  fireEvent.click(screen.getByRole("button", { name: "AI로 수정하기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("generate_widget", {
      request: "목표 단수를 추가해 줘",
      id: "generated-counter",
      expectedRevision: 12,
    }),
  );
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
});

it("shows generated fetch and operation errors without discarding edit requests", async () => {
  generatedSnapshot(
    [generated({ status: "error", error: "실행 시간 초과" })],
    "목록 새로고침 실패",
  );
  vi.mocked(command).mockRejectedValue(new Error("이미 변경된 위젯이에요"));
  const view = render(<WidgetManager embedded />);
  expect(screen.getByText("목록 새로고침 실패")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "AI 위젯 다시 불러오기" }));
  expect(reloadGenerated).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "단수 세기 오류" }));
  expect(screen.getByText("실행 시간 초과")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "수정할 내용" }), {
    target: { value: "오류를 고쳐 줘" },
  });
  fireEvent.click(screen.getByRole("button", { name: "AI로 수정하기" }));
  await waitFor(() =>
    expect(
      screen.getAllByRole("alert").some((item) => item.textContent === "이미 변경된 위젯이에요"),
    ).toBe(true),
  );
  expect(screen.getByRole("textbox", { name: "수정할 내용" })).toHaveProperty(
    "value",
    "오류를 고쳐 줘",
  );
  expect(reloadGenerated).toHaveBeenCalledTimes(2);
  generatedSnapshot([generated({ revision: 17 })]);
  view.rerender(<WidgetManager embedded />);
  vi.mocked(command).mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole("button", { name: "AI로 수정하기" }));
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("generate_widget", {
      request: "오류를 고쳐 줘",
      id: "generated-counter",
      expectedRevision: 17,
    }),
  );
});

it("keeps an installed widget usable when the current model cannot edit it", async () => {
  vi.mocked(useGeneratedWidgets).mockReturnValue({
    workshop: {
      widgets: [generated()],
      automatic: true,
      runtime: "javascript",
      generationEligibility: {
        ...eligibility,
        allowed: false,
        parameterBillions: 4,
        reason: "9B 이하 모델은 제작할 수 없어요.",
      },
    },
    error: null,
    reload: reloadGenerated,
  });
  render(<WidgetManager embedded />);
  expect(screen.getByRole("region", { name: "단수 세기 설정" })).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "수정할 내용" }), {
    target: { value: "목표 추가" },
  });
  expect(screen.getByRole("button", { name: "AI로 수정하기" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "위젯 실행 ↗" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_generated_widget", { id: "generated-counter" }),
  );
  expect(command).not.toHaveBeenCalledWith("generate_widget", expect.anything());
});

it("omits retired collection and journal even when legacy records are present", () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { ...PREVIEW_WIDGETS, widgets: [installed("collection"), installed("journal")] },
    error: null,
    reload,
  });
  render(<WidgetManager embedded />);
  expect(screen.queryByRole("button", { name: /^수집함·소품/ })).toBeNull();
  expect(screen.queryByRole("button", { name: /^함께한 사건 일지/ })).toBeNull();
  expect(PREVIEW_WIDGETS.catalog).toHaveLength(14);
});

it("keeps AI creation and its automatic setting in a closed experiment disclosure below the list", async () => {
  render(<WidgetManager embedded />);
  const list = within(screen.getByRole("region", { name: "위젯 목록" }));
  const toggle = list.getByRole("button", { name: "실험 기능" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  expect(screen.queryByRole("button", { name: "AI로 위젯 만들기" })).toBeNull();
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(list.getByRole("button", { name: "AI로 위젯 만들기" })).toBeTruthy();
  fireEvent.click(
    screen.getByRole("checkbox", { name: "대화에서 필요한 도구가 보이면 자동으로 만들기" }),
  );
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("set_widget_creation_automatic", { enabled: false }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "AI로 위젯 만들기" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "AI로 위젯 만들기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("open_widget_workshop", undefined));
});

it("allows closing a last confirmed display after query failure without claiming it is closed before a fresh read", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { ...PREVIEW_WIDGETS, onboardingDone: true, widgets: [installed("weather")] },
    error: null,
    reload,
  });
  const native = {
    id: "weather",
    toolWindow: { state: "minimized" as const, shared: null },
    displayWindow: "visible" as const,
    noteWindows: null,
    toys: null,
    queryError: null,
    actionError: null,
  };
  vi.mocked(useWidgetRuntime).mockReturnValue({
    snapshot: { sequence: 1, widgets: [native] },
    error: null,
    reload: () => undefined,
  });
  const view = render(<WidgetManager embedded />);
  expect(screen.getByText("위젯 창 최소화됨")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "창으로 이동 ↗" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("open_widget", { id: "weather" }));
  fireEvent.click(screen.getByRole("button", { name: "표시 닫기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("close_widget_display", { id: "weather" }),
  );
  vi.mocked(useWidgetRuntime).mockReturnValue({
    snapshot: {
      sequence: 2,
      widgets: [{ ...native, queryError: "조회 실패", lastConfirmed: true }],
    },
    error: null,
    reload: () => undefined,
  });
  view.rerender(<WidgetManager embedded />);
  expect(screen.getByRole("button", { name: "창으로 이동 ↗" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "표시 닫기" })).toHaveProperty("disabled", false);
  expect(screen.getByRole("button", { name: "다시 확인" })).toBeTruthy();
  vi.mocked(command).mockClear();
  fireEvent.click(screen.getByRole("button", { name: "표시 닫기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledExactlyOnceWith("close_widget_display", { id: "weather" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "표시 닫기" })).toHaveProperty("disabled", false),
  );
  expect(screen.queryByText("바탕화면 표시 닫힘")).toBeNull();
  expect(screen.getAllByText("마지막 확인 상태 · 갱신 실패").length).toBeGreaterThan(0);
  vi.mocked(useWidgetRuntime).mockReturnValue({
    snapshot: { sequence: 3, widgets: [{ ...native, displayWindow: "closed" }] },
    error: null,
    reload: () => undefined,
  });
  view.rerender(<WidgetManager embedded />);
  expect(screen.getByText("바탕화면 표시 닫힘")).toBeTruthy();
  expect(screen.getByRole("button", { name: "바탕화면 표시" })).toHaveProperty("disabled", false);
});

it("offers toy actions without a duplicate generic window and keeps creation failure distinct from counts", () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { ...PREVIEW_WIDGETS, onboardingDone: true, widgets: [installed("ball")] },
    error: null,
    reload,
  });
  vi.mocked(useWidgetRuntime).mockReturnValue({
    snapshot: {
      sequence: 1,
      widgets: [
        {
          id: "ball",
          toolWindow: null,
          displayWindow: null,
          noteWindows: null,
          toys: { starting: 1, visible: 0 },
          queryError: null,
          actionError: { attemptId: "launch", message: "생성 실패" },
        },
      ],
    },
    error: null,
    reload: () => undefined,
  });
  render(<WidgetManager embedded />);
  expect(screen.queryByRole("button", { name: "위젯 열기 ↗" })).toBeNull();
  expect(screen.getByRole("button", { name: "바탕화면에 꺼내기" })).toBeTruthy();
  expect(screen.getByText("준비 중 1개 · 표시 0개")).toBeTruthy();
  expect(screen.getByRole("alert")).toHaveProperty("textContent", "생성 실패");
});

it("keeps appearance save controls in their owning white panel and preserves disabled state across widgets", () => {
  const widgets = [installed("clock"), installed("weather")];
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { ...PREVIEW_WIDGETS, onboardingDone: true, widgets },
    error: null,
    reload,
  });
  const view = render(<WidgetManager embedded />);
  fireEvent.click(screen.getByRole("button", { name: "바탕화면 꾸미기" }));
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: "글자 위치" })).getByRole("radio", {
      name: "오른쪽 아래",
    }),
  );
  const save = screen.getByRole("button", { name: "표시 설정 저장" });
  expect(save.closest("fieldset")).toBeNull();
  expect(save.closest("[data-widget-settings]")).toBeTruthy();
  expect(
    save
      .closest("[data-widget-settings]")
      ?.querySelector("[data-widget-settings-body]")
      ?.contains(save),
  ).toBe(false);
  expect(save).toHaveProperty("disabled", false);
  fireEvent.click(screen.getByRole("button", { name: /^날씨 켜짐$/ }));
  expect(screen.queryByRole("button", { name: "표시 설정 저장" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "바탕화면 꾸미기" }));
  expect(screen.getAllByRole("button", { name: "표시 설정 저장" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "표시 설정 저장" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: /^시계·기념일 켜짐$/ }));
  expect(screen.getByRole("button", { name: "표시 설정 저장" })).toHaveProperty("disabled", false);
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: {
      ...PREVIEW_WIDGETS,
      onboardingDone: true,
      widgets: widgets.map((widget) => ({ ...widget, enabled: false, status: "disabled" })),
    },
    error: null,
    reload,
  });
  view.rerender(<WidgetManager embedded />);
  expect(screen.getByRole("button", { name: "표시 설정 저장" })).toHaveProperty("disabled", true);
  expect(command).not.toHaveBeenCalled();
});

it("keeps the appearance save footer and draft when the window becomes narrow", () => {
  const previousWidth = window.innerWidth;
  Object.defineProperty(window, "innerWidth", { value: 1920, writable: true, configurable: true });
  try {
    vi.mocked(useWidgets).mockReturnValue({
      snapshot: { ...PREVIEW_WIDGETS, onboardingDone: true, widgets: [installed("clock")] },
      error: null,
      reload,
    });
    render(<WidgetManager embedded />);
    fireEvent.click(screen.getByRole("button", { name: "바탕화면 꾸미기" }));
    fireEvent.click(
      within(screen.getByRole("radiogroup", { name: "글자 위치" })).getByRole("radio", {
        name: "오른쪽 아래",
      }),
    );
    expect(
      screen.getByRole("button", { name: "표시 설정 저장" }).closest("[data-appearance-actions]"),
    ).toBeTruthy();
    window.innerWidth = 960;
    fireEvent(window, new Event("resize"));
    const save = screen.getByRole("button", { name: "표시 설정 저장" });
    expect(save.closest("[data-compact-appearance-actions]")).toBeTruthy();
    expect(save).toHaveProperty("disabled", false);
    expect(
      within(screen.getByRole("radiogroup", { name: "글자 위치" }))
        .getByRole("radio", {
          name: "오른쪽 아래",
        })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(command).not.toHaveBeenCalled();
  } finally {
    window.innerWidth = previousWidth;
  }
});

it("creates a detached memo without requiring the retired list window", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { ...PREVIEW_WIDGETS, widgets: [installed("memo")] },
    error: null,
    reload,
  });
  vi.mocked(useWidgetRuntime).mockReturnValue({
    snapshot: {
      sequence: 1,
      widgets: [
        {
          id: "memo",
          toolWindow: null,
          displayWindow: null,
          noteWindows: { open: 2, visible: 1 },
          toys: null,
          queryError: null,
          actionError: null,
        },
      ],
    },
    error: null,
    reload: () => undefined,
  });
  render(<WidgetManager embedded />);
  expect(screen.getByText("바탕화면 낱장 메모")).toBeTruthy();
  expect(screen.getByText("메모 2개 열림 · 1개 표시")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "새 메모 꺼내기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("create_memo_note", { id: "memo" }));
  expect(command).not.toHaveBeenCalledWith("open_widget", expect.anything());
});
