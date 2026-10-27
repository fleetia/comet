import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { command } from "../../hooks/useSnapshot";
import { useGeneratedWidgets } from "./useGeneratedWidgets";
import { WidgetWorkshop } from "./WidgetWorkshop";

vi.mock("./useGeneratedWidgets", () => ({ useGeneratedWidgets: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));
vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
const reload = vi.fn();
beforeEach(() => {
  vi.mocked(listen).mockClear();
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(undefined);
  reload.mockReset();
  vi.mocked(useGeneratedWidgets).mockReturnValue({
    workshop: {
      widgets: [],
      automatic: true,
      runtime: "javascript",
      generationEligibility: {
        allowed: true,
        reason: "12B 모델로 제작할 수 있어요.",
        model: "test-12b",
        parameterBillions: 12,
        source: "catalog",
      },
    },
    error: null,
    reload,
  });
});
afterEach(cleanup);

async function confirmCreate(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "만들기" }));
  const dialog = within(await screen.findByRole("dialog", { name: "위젯을 만들까요?" }));
  fireEvent.click(dialog.getByRole("button", { name: "만들기" }));
}

it("asks for confirmation with the request and model before generating", async () => {
  render(<WidgetWorkshop />);
  fireEvent.change(screen.getByLabelText("어떤 도구가 필요한가요?"), {
    target: { value: "단수 세기\n목표 40" },
  });
  fireEvent.click(screen.getByRole("button", { name: "만들기" }));
  const dialog = within(await screen.findByRole("dialog", { name: "위젯을 만들까요?" }));
  expect(dialog.getByText("단수 세기 목표 40", { normalizer: (text) => text.replace(/\s+/g, " ") })).toBeTruthy();
  expect(dialog.getByText(/test-12b/)).toBeTruthy();
  expect(command).not.toHaveBeenCalledWith("generate_widget", expect.anything());
  fireEvent.click(dialog.getByRole("button", { name: "취소" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "위젯을 만들까요?" })).toBeNull());
  expect(command).not.toHaveBeenCalledWith("generate_widget", expect.anything());
  expect(screen.getByLabelText("어떤 도구가 필요한가요?")).toHaveProperty("value", "단수 세기\n목표 40");
});

it("generates the request shown in the confirmation even if the draft changes behind it", async () => {
  render(<WidgetWorkshop />);
  const field = screen.getByLabelText("어떤 도구가 필요한가요?");
  fireEvent.change(field, { target: { value: "단수 세기" } });
  fireEvent.click(screen.getByRole("button", { name: "만들기" }));
  const dialog = within(await screen.findByRole("dialog", { name: "위젯을 만들까요?" }));
  fireEvent.change(field, { target: { value: "다른 요청" } });
  fireEvent.click(dialog.getByRole("button", { name: "만들기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("generate_widget", {
      id: null,
      expectedRevision: null,
      request: "단수 세기",
    }),
  );
  expect(field).toHaveProperty("value", "다른 요청");
});

it("recovers a missed import request after listener readiness and ignores reordered old modes", async () => {
  vi.mocked(command).mockImplementation(async (name) => name === "get_widget_workshop_mode" ? { mode: "import", sequence: 3 } : undefined);
  render(<WidgetWorkshop />);
  const details = screen.getByText("다른 AI가 만든 위젯 가져오기").closest("details")!;
  await waitFor(() => expect(details.open).toBe(true));
  fireEvent.change(screen.getByLabelText("위젯 JSON"), { target: { value: "JSON 초안" } });
  fireEvent.change(screen.getByLabelText("어떤 도구가 필요한가요?"), { target: { value: "생성 초안" } });
  const callback = vi.mocked(listen).mock.calls.find(([name]) => name === "widget-workshop-mode")![1];
  act(() => callback({ event: "widget-workshop-mode", id: 1, payload: { mode: "create", sequence: 4 } }));
  expect(details.open).toBe(false);
  act(() => callback({ event: "widget-workshop-mode", id: 1, payload: { mode: "import", sequence: 2 } }));
  expect(details.open).toBe(false);
  expect(screen.getByLabelText("위젯 JSON")).toHaveProperty("value", "JSON 초안");
  expect(screen.getByLabelText("어떤 도구가 필요한가요?")).toHaveProperty("value", "생성 초안");
  expect(command).not.toHaveBeenCalledWith("generate_widget", expect.anything());
  expect(command).not.toHaveBeenCalledWith("import_generated_widget", expect.anything());
});

it("keeps cancel available while import is open and confirms close without clearing either draft", async () => {
  let finish!: () => void;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "generate_widget") return new Promise<void>((resolve) => { finish = resolve; });
  });
  render(<WidgetWorkshop />);
  fireEvent.change(screen.getByLabelText("어떤 도구가 필요한가요?"), { target: { value: "작성 중" } });
  await confirmCreate();
  fireEvent.click(screen.getByText("다른 AI가 만든 위젯 가져오기"));
  fireEvent.change(screen.getByLabelText("위젯 JSON"), { target: { value: "다른 초안" } });
  fireEvent.click(screen.getByRole("button", { name: "제작 중단" }));
  expect(command).toHaveBeenCalledWith("cancel_widget_generation");
  fireEvent.click(screen.getByRole("button", { name: "위젯 제작 닫기" }));
  expect(command).not.toHaveBeenCalledWith("close_widget_workshop");
  fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
  expect(screen.getByLabelText("위젯 JSON")).toHaveProperty("value", "다른 초안");
  fireEvent.click(screen.getByRole("button", { name: "위젯 제작 닫기" }));
  fireEvent.click(screen.getByRole("button", { name: "저장하지 않고 닫기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("close_widget_workshop"));
  await act(async () => finish());
  expect(screen.getByLabelText("어떤 도구가 필요한가요?")).toHaveProperty("value", "작성 중");
});

it("keeps creation and import here and routes existing widget management to the shared list", async () => {
  render(<WidgetWorkshop />);
  expect(screen.queryByLabelText("AI가 만든 위젯")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "위젯 목록 열기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("open_widgets"));
  fireEvent.change(screen.getByLabelText("어떤 도구가 필요한가요?"), {
    target: { value: "단수 세기" },
  });
  await confirmCreate();
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("generate_widget", {
      id: null,
      expectedRevision: null,
      request: "단수 세기",
    }),
  );
  expect(screen.getByLabelText("어떤 도구가 필요한가요?")).toHaveProperty("value", "");
});

it("blocks small-model generation while leaving manual import available", async () => {
  const current = vi.mocked(useGeneratedWidgets)();
  vi.mocked(useGeneratedWidgets).mockReturnValue({
    ...current,
    workshop: {
      ...current.workshop,
      generationEligibility: {
        ...current.workshop.generationEligibility,
        allowed: false,
        reason: "9B 이하는 제작할 수 없어요.",
      },
    },
  });
  render(<WidgetWorkshop />);
  fireEvent.change(screen.getByLabelText("어떤 도구가 필요한가요?"), {
    target: { value: "단수 세기" },
  });
  expect(screen.getByRole("button", { name: "만들기" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByText("다른 AI가 만든 위젯 가져오기"));
  fireEvent.change(screen.getByLabelText("위젯 JSON"), { target: { value: '{"name":"단수"}' } });
  fireEvent.click(screen.getByRole("button", { name: "가져오기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("import_generated_widget", {
      definition: { name: "단수" },
    }),
  );
});

it("preserves a failed creation request and reloads eligibility for retry", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "generate_widget") throw new Error("모델 준비 실패");
  });
  render(<WidgetWorkshop />);
  fireEvent.change(screen.getByLabelText("어떤 도구가 필요한가요?"), {
    target: { value: "단수 세기" },
  });
  await confirmCreate();
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "모델 준비 실패");
  expect(screen.getByLabelText("어떤 도구가 필요한가요?")).toHaveProperty("value", "단수 세기");
  expect(reload).toHaveBeenCalled();
});
