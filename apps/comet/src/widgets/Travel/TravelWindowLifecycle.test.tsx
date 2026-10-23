import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { command } from "../../hooks/useSnapshot";
import { PlanningWindow } from "../../components/PlanningWindow";
import { Travel } from "./Travel";

const native = vi.hoisted(() => ({
  onCloseRequested: vi.fn(),
  destroy: vi.fn(),
  startDragging: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../../hooks/useSnapshot", () => ({
  command: vi.fn(),
  isDesktop: () => true,
  errorText: String,
}));
vi.mock("../useWidgets", () => ({
  useWidgets: () => ({ snapshot: { widgets: [] }, reload: vi.fn() }),
}));
vi.mock("../Planner/useDiary", () => ({
  useDiary: () => ({
    state: {
      revision: 1,
      travels: ["a", "b"].map((id) => ({
        id,
        title: `Trip ${id}`,
        destination: "",
        startDate: "2026-11-01",
        endDate: "2026-11-02",
        timeZone: "Asia/Seoul",
        currency: "KRW",
        budget: 0,
        finished: false,
      })),
    },
    busy: false,
    mutate: vi.fn(),
    reload: vi.fn(),
  }),
}));
const handlers = new Map<string, (event: { payload: unknown }) => void>();
let target: string | null;

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  target = "b";
  native.onCloseRequested.mockResolvedValue(() => undefined);
  vi.mocked(listen).mockImplementation(async (name, callback) => {
    handlers.set(name, callback as (event: { payload: unknown }) => void);
    return () => {
      if (handlers.get(name) === callback) handlers.delete(name);
    };
  });
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_planning_window_state") return { generation: 1, active: true } as never;
    if (name === "get_travel_target") return target as never;
    if (name === "release_planning_window")
      return { generation: args?.generation, active: false } as never;
    return null as never;
  });
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(cleanup);

it("reopens with fresh target and no stale editor after native or header closure", async () => {
  render(<PlanningWindow label="travel">{(close) => <Travel onClose={close} />}</PlanningWindow>);
  await screen.findByRole("heading", { name: "Trip b" });
  fireEvent.click(screen.getByRole("button", { name: "고치기" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
  const preventDefault = vi.fn();
  act(() => native.onCloseRequested.mock.calls[0][0]({ preventDefault }));
  expect(preventDefault).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(native.destroy).not.toHaveBeenCalled();
  target = null;
  await act(async () =>
    handlers.get("planning-window-state")!({ payload: { label: "travel", generation: 2, active: true } }),
  );
  await screen.findByRole("heading", { name: "Trip a" });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "여행 창 닫기" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Trip a" })).toBeNull());
  target = "b";
  await act(async () =>
    handlers.get("planning-window-state")!({ payload: { label: "travel", generation: 3, active: true } }),
  );
  await screen.findByRole("heading", { name: "Trip b" });
});
