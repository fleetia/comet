import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

it("shows required disabled packages before explicit installation confirmation", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { ...PREVIEW_WIDGETS, widgets: [installed("calendar", false)] },
    error: null,
    reload,
  });
  render(<WidgetManager />);
  expect(screen.getByRole("heading", { name: "캘린더" })).toBeTruthy();
  expect(screen.queryByRole("checkbox", { name: "캘린더 설치 선택" })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: /추가할 위젯/ }));
  fireEvent.click(screen.getByLabelText("준비 봉투 설치 선택"));
  fireEvent.click(screen.getByRole("button", { name: "선택한 위젯 설치 (1)" }));
  expect(screen.getByText("필수 위젯도 함께 설치하거나 켭니다: 캘린더")).toBeTruthy();
  expect(command).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "설치 확인" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("install_widgets", { kinds: ["preparation", "calendar"] }),
  );
});

it("shows dependents and preserves data by default when removing", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { ...PREVIEW_WIDGETS, widgets: [installed("todo"), installed("completion-jar")] },
    error: null,
    reload,
  });
  render(<WidgetManager />);
  fireEvent.click(
    within(screen.getByRole("region", { name: "할 일" })).getByRole("button", { name: "제거" }),
  );
  expect(screen.getByText(/필수 연결을 사용할 수 없게 되는 도구: 완료 구슬병/)).toBeTruthy();
  expect(screen.getByLabelText("이 위젯의 작성 데이터도 삭제")).toHaveProperty("checked", false);
  fireEvent.click(screen.getByRole("button", { name: "제거 확인" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("remove_widget", { id: "todo", deleteData: false }),
  );
});

it("keeps a failed removal visible with the explicit data deletion choice", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: { ...PREVIEW_WIDGETS, widgets: [installed("memo")] },
    error: null,
    reload,
  });
  vi.mocked(command).mockRejectedValue(new Error("저장 실패"));
  render(<WidgetManager />);
  fireEvent.click(screen.getByRole("button", { name: "제거" }));
  fireEvent.click(screen.getByLabelText("이 위젯의 작성 데이터도 삭제"));
  fireEvent.click(screen.getByRole("button", { name: "제거 확인" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "저장 실패");
  expect(command).toHaveBeenCalledWith("remove_widget", { id: "memo", deleteData: true });
  expect(screen.getByLabelText("이 위젯의 작성 데이터도 삭제")).toHaveProperty("checked", true);
});

it("can skip all widgets and never invokes desktop commands in browser preview", async () => {
  const view = render(<WidgetManager />);
  fireEvent.click(screen.getByRole("button", { name: "모두 건너뛰고 시작하기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("finish_widget_onboarding", undefined));
  await waitFor(() => expect(command).toHaveBeenCalledWith("close_widgets"));
  view.unmount();
  vi.mocked(command).mockClear();
  vi.mocked(isDesktop).mockReturnValue(false);
  render(<WidgetManager />);
  fireEvent.click(screen.getByLabelText("할 일 설치 선택"));
  expect(screen.getByRole("button", { name: "선택한 위젯 설치 (1)" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(command).not.toHaveBeenCalled();
});

it("opens preserved preparation data when the required calendar was removed", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: {
      ...PREVIEW_WIDGETS,
      widgets: [{ ...installed("preparation"), missing: ["calendar"] }],
    },
    error: null,
    reload,
  });
  render(<WidgetManager />);
  fireEvent.click(screen.getByRole("button", { name: "꺼내기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("open_widget", { id: "preparation" }));
});

it.each([false, true])("closes only the manager while loading=%s", async (loading) => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: loading ? null : PREVIEW_WIDGETS,
    error: null,
    reload,
  });
  render(<WidgetManager />);
  fireEvent.click(screen.getByRole("button", { name: "위젯 관리 닫기" }));
  await waitFor(() => expect(command).toHaveBeenCalledExactlyOnceWith("close_widgets"));
});

it("keeps installation choices across tabs and requires installing or clearing before finishing", () => {
  render(<WidgetManager />);
  fireEvent.click(screen.getByLabelText("할 일 설치 선택"));
  expect(screen.getByRole("button", { name: "모두 건너뛰고 시작하기" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(screen.getByRole("tab", { name: /설치됨/ }));
  expect(screen.getByRole("button", { name: "선택한 위젯 설치 (1)" })).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: /추가할 위젯/ }));
  expect(screen.getByLabelText("할 일 설치 선택")).toHaveProperty("checked", true);
  fireEvent.click(screen.getByRole("button", { name: "선택 해제" }));
  expect(screen.getByRole("button", { name: "모두 건너뛰고 시작하기" })).toHaveProperty(
    "disabled",
    false,
  );
  expect(command).not.toHaveBeenCalled();
});

it("filters installed setup issues without hiding preserved local data behind a disabled open action", async () => {
  vi.mocked(useWidgets).mockReturnValue({
    snapshot: {
      ...PREVIEW_WIDGETS,
      widgets: [
        installed("todo"),
        { ...installed("preparation"), status: "setup", missing: ["calendar"] },
      ],
    },
    error: null,
    reload,
  });
  render(<WidgetManager />);
  fireEvent.click(screen.getByRole("button", { name: "확인 필요 (1)" }));
  expect(screen.queryByRole("region", { name: "할 일" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "설정 열기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("open_widget", { id: "preparation" }));
});
