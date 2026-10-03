import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { JournalTool } from "./JournalTool";
import { command } from "../../hooks/useSnapshot";
import type { WidgetView } from "../types";

vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));

afterEach(cleanup);

it("keeps a failed journal load distinct from an empty journal and permits retry", async () => {
  vi.mocked(command)
    .mockRejectedValueOnce(new Error("일지를 읽을 수 없어요."))
    .mockResolvedValueOnce([]);
  const widget: WidgetView = {
    id: "journal",
    kind: "journal",
    installed: true,
    enabled: true,
    revision: 1,
    version: 1,
    data: {},
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
  };
  render(<JournalTool widget={widget} />);
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "일지를 읽을 수 없어요.");
  expect(screen.queryByText("아직 함께한 사건이 없어요.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "새로고침" }));
  expect(await screen.findByText("아직 함께한 사건이 없어요.")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});
