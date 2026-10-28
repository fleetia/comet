import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { FormField } from "@comet/ui";
import { command } from "../../hooks/useSnapshot";
import { ColorField } from "./ColorField";
import { APPEARANCE_SAVE_DELAY, WidgetAppearance } from "./WidgetAppearance";
import type { WidgetView } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string, protocol: string) => `${protocol}://localhost/${path}`,
}));
vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));

const appearance = {
  backgroundColor: "#24202d",
  backgroundPosition: "center-center",
  textColor: "#fffaf2",
  textPosition: "center-center",
};
function widget(data: WidgetView["data"] = { appearance }): WidgetView {
  return {
    id: "clock",
    kind: "clock",
    reaction: true,
    revision: 4,
    version: 1,
    data,
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
  };
}
function placeText(name: string): void {
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: "글자 위치" })).getByRole("radio", { name }),
  );
}

beforeEach(() => {
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("saves a placement immediately with the observed revision and no save button", async () => {
  render(<WidgetAppearance widget={widget()} compact />);
  expect(screen.queryByRole("button", { name: /저장/ })).toBeNull();
  placeText("오른쪽 아래");
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("configure_widget_appearance", {
      id: "clock",
      expectedRevision: 4,
      input: { ...appearance, textPosition: "bottom-right" },
    }),
  );
});

it("queues consecutive edits and sends the next one on the revision after the previous save", async () => {
  let release!: () => void;
  vi.mocked(command).mockImplementationOnce(
    () => new Promise<undefined>((resolve) => (release = () => resolve(undefined))),
  );
  render(<WidgetAppearance widget={widget()} compact />);
  placeText("오른쪽 아래");
  placeText("왼쪽 위");
  expect(command).toHaveBeenCalledTimes(1);
  await act(async () => release());
  await waitFor(() => expect(command).toHaveBeenCalledTimes(2));
  expect(command).toHaveBeenLastCalledWith("configure_widget_appearance", {
    id: "clock",
    expectedRevision: 5,
    input: { ...appearance, textPosition: "top-left" },
  });
});

it("waits for typing to settle before saving a color", async () => {
  vi.useFakeTimers();
  render(<WidgetAppearance widget={widget()} compact />);
  const swatch = screen.getByLabelText("배경 색상 선택");
  fireEvent.change(swatch, { target: { value: "#000011" } });
  fireEvent.change(swatch, { target: { value: "#112233" } });
  await act(async () => vi.advanceTimersByTime(APPEARANCE_SAVE_DELAY - 1));
  expect(command).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1));
  expect(command).toHaveBeenCalledTimes(1);
  expect(command).toHaveBeenCalledWith("configure_widget_appearance", {
    id: "clock",
    expectedRevision: 4,
    input: { ...appearance, backgroundColor: "#112233" },
  });
});

it("keeps a failed edit visible and saves it again on request", async () => {
  vi.mocked(command).mockRejectedValueOnce(new Error("저장 실패"));
  render(<WidgetAppearance widget={widget()} compact />);
  placeText("오른쪽 아래");
  expect((await screen.findByRole("alert")).textContent).toBe("저장 실패");
  expect(
    within(screen.getByRole("radiogroup", { name: "글자 위치" }))
      .getByRole("radio", { name: "오른쪽 아래" })
      .getAttribute("aria-checked"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "다시 저장" }));
  await waitFor(() => expect(command).toHaveBeenCalledTimes(2));
  expect(command).toHaveBeenLastCalledWith(
    "configure_widget_appearance",
    expect.objectContaining({ input: expect.objectContaining({ textPosition: "bottom-right" }) }),
  );
});

it("keeps background image actions revision guarded", async () => {
  render(<WidgetAppearance widget={widget({})} />);
  fireEvent.click(screen.getByRole("button", { name: "배경 이미지 선택" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("choose_widget_background", {
      id: "clock",
      expectedRevision: 4,
    }),
  );
});

it("takes its label, required state and error from the surrounding form field", () => {
  render(
    <FormField label="배경 색상" required error="색상이 필요해요">
      <ColorField value="#112233" onValueChange={() => undefined} />
    </FormField>,
  );
  const color = screen.getByRole("textbox", { name: "배경 색상" });
  expect(color).toHaveProperty("required", true);
  expect(color.getAttribute("aria-invalid")).toBe("true");
  expect(screen.getByText("색상이 필요해요").id).toBe(color.getAttribute("aria-describedby"));
});
