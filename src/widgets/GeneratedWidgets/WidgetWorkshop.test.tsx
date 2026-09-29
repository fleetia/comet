import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { command } from "../../hooks/useSnapshot";
import { useGeneratedWidgets } from "./useGeneratedWidgets";
import { WidgetWorkshop } from "./WidgetWorkshop";

vi.mock("./useGeneratedWidgets", () => ({ useGeneratedWidgets: vi.fn() }));
vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
const reload = vi.fn();
beforeEach(() => {
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

it("keeps creation and import here and routes existing widget management to the shared list", async () => {
  render(<WidgetWorkshop />);
  expect(screen.queryByLabelText("AI가 만든 위젯")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "위젯 목록 열기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("open_widgets"));
  fireEvent.change(screen.getByLabelText("어떤 도구가 필요한가요?"), {
    target: { value: "단수 세기" },
  });
  fireEvent.click(screen.getByRole("button", { name: "만들기" }));
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
  vi.mocked(command).mockRejectedValueOnce(new Error("모델 준비 실패"));
  render(<WidgetWorkshop />);
  fireEvent.change(screen.getByLabelText("어떤 도구가 필요한가요?"), {
    target: { value: "단수 세기" },
  });
  fireEvent.click(screen.getByRole("button", { name: "만들기" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "모델 준비 실패");
  expect(screen.getByLabelText("어떤 도구가 필요한가요?")).toHaveProperty("value", "단수 세기");
  expect(reload).toHaveBeenCalled();
});
