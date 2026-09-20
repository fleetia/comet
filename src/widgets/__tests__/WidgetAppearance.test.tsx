import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { command } from "../../hooks/useSnapshot";
import { WidgetAppearance } from "../WidgetAppearance/WidgetAppearance";
import type { WidgetView } from "../types";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string, protocol: string) => `${protocol}://localhost/${path}`,
}));
vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));

function widget(data: WidgetView["data"]): WidgetView {
  return {
    id: "clock",
    kind: "clock",
    installed: true,
    enabled: true,
    revision: 4,
    version: 1,
    data,
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
  };
}

beforeEach(() => {
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(undefined);
});
afterEach(cleanup);

it("saves background and text placement together with the observed widget revision", async () => {
  render(
    <WidgetAppearance
      widget={widget({
        appearance: {
          backgroundColor: "#24202d",
          backgroundPosition: "center-center",
          textColor: "#fffaf2",
          textPosition: "center-center",
        },
      })}
    />,
  );
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: "글자 위치" })).getByRole("radio", {
      name: "오른쪽 아래",
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "표시 설정 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("configure_widget_appearance", {
      id: "clock",
      expectedRevision: 4,
      input: {
        backgroundColor: "#24202d",
        backgroundPosition: "center-center",
        textColor: "#fffaf2",
        textPosition: "bottom-right",
      },
    }),
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

it("retains unsaved placement through refresh and failure, and saves with the latest revision", async () => {
  const dirty = vi.fn();
  const view = render(<WidgetAppearance widget={widget({})} onDirtyChange={dirty} />);
  fireEvent.click(
    within(screen.getByRole("radiogroup", { name: "글자 위치" })).getByRole("radio", {
      name: "오른쪽 아래",
    }),
  );
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(true));
  view.rerender(
    <WidgetAppearance
      widget={{ ...widget({ observation: { temperature: 21 } }), revision: 5 }}
      onDirtyChange={dirty}
    />,
  );
  expect(
    within(screen.getByRole("radiogroup", { name: "글자 위치" }))
      .getByRole("radio", {
        name: "오른쪽 아래",
      })
      .getAttribute("aria-checked"),
  ).toBe("true");
  vi.mocked(command).mockRejectedValueOnce(new Error("저장 실패"));
  fireEvent.click(screen.getByRole("button", { name: "표시 설정 저장" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "저장 실패");
  expect(command).toHaveBeenCalledWith(
    "configure_widget_appearance",
    expect.objectContaining({
      expectedRevision: 5,
      input: expect.objectContaining({ textPosition: "bottom-right" }),
    }),
  );
  expect(dirty).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "표시 변경 취소" }));
  await waitFor(() => expect(dirty).toHaveBeenLastCalledWith(false));
});
