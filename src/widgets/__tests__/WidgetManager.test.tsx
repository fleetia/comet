import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { WidgetManager } from "../WidgetManager/WidgetManager";
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
vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(),
}));

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
  reload.mockReset();
  reloadGenerated.mockReset();
  generatedSnapshot([]);
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
    snapshot: { ...PREVIEW_WIDGETS, widgets: [installed("calendar"), installed("preparation")] },
    error: null,
    reload,
  });
  render(<WidgetManager embedded />);
  fireEvent.click(screen.getByRole("button", { name: "위젯 제거" }));
  expect(screen.getByText(/필수 연결을 사용할 수 없게 되는 도구: 준비 봉투/)).toBeTruthy();
  expect(screen.getByLabelText("이 위젯의 작성 데이터도 삭제")).toHaveProperty("checked", false);
  expect(command).not.toHaveBeenCalledWith("remove_widget", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "제거 확인" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("remove_widget", {
      id: "calendar",
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
  expect(screen.getByRole("region", { name: "위젯 목록" })).toBeTruthy();
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
  expect(screen.getByText("공식 16개 · AI·가져온 위젯 2개 · 설치됨 3개")).toBeTruthy();
  expect(screen.getByRole("option", { name: "전체 18" })).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "설치 상태" }), {
    target: { value: "available" },
  });
  expect(list.queryByRole("button", { name: /^단수 세기/ })).toBeNull();
  fireEvent.change(screen.getByRole("combobox", { name: "설치 상태" }), {
    target: { value: "installed" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "위젯 분류" }), {
    target: { value: "generated" },
  });
  expect(list.queryByRole("button", { name: "할 일 켜짐" })).toBeNull();
  expect(list.getAllByRole("button")).toHaveLength(2);
  fireEvent.change(screen.getByRole("searchbox", { name: "위젯 검색" }), {
    target: { value: "뜨개질" },
  });
  expect(list.getByRole("button", { name: "단수 세기 켜짐" })).toBeTruthy();
  expect(list.queryByRole("button", { name: /^물 마시기/ })).toBeNull();
  fireEvent.change(screen.getByRole("searchbox", { name: "위젯 검색" }), { target: { value: "" } });
  fireEvent.change(screen.getByRole("combobox", { name: "설치 상태" }), {
    target: { value: "attention" },
  });
  expect(list.getByRole("button", { name: "물 마시기 실행 검사 대기" })).toBeTruthy();
  expect(list.queryByRole("button", { name: /^단수 세기/ })).toBeNull();
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
  fireEvent.change(screen.getByRole("combobox", { name: "설치 상태" }), {
    target: { value: "attention" },
  });
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
