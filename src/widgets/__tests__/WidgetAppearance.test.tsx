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
      widget={
        widget({
          appearance: {
            backgroundColor: "#24202d",
            backgroundPosition: "center-center",
            textColor: "#fffaf2",
            textPosition: "center-center",
          },
        })
      }
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
