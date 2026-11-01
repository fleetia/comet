import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
  act(() => native.onCloseRequested.mock.calls.forEach(([handler]) => handler({ preventDefault })));
  expect(preventDefault).toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(native.destroy).not.toHaveBeenCalled();
  target = null;
  await act(async () =>
    handlers.get("planning-window-state")!({
      payload: { label: "travel", generation: 2, active: true },
    }),
  );
  await screen.findByRole("heading", { name: "Trip a" });
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "여행 창 닫기" }));
  await waitFor(() => expect(screen.queryByRole("heading", { name: "Trip a" })).toBeNull());
  target = "b";
  await act(async () =>
    handlers.get("planning-window-state")!({
      payload: { label: "travel", generation: 3, active: true },
    }),
  );
  await screen.findByRole("heading", { name: "Trip b" });
});

it("prevents Tauri's default destroy in a close callback retained after unmount", async () => {
  const view = render(<Travel onClose={vi.fn()} />);
  await screen.findByRole("heading", { name: "Trip b" });
  await waitFor(() => expect(native.onCloseRequested).toHaveBeenCalledOnce());
  const handler = native.onCloseRequested.mock.calls[0][0] as (event: {
    preventDefault: () => void;
  }) => void;
  view.unmount();
  const preventDefault = vi.fn();
  act(() => handler({ preventDefault }));
  expect(preventDefault).toHaveBeenCalledOnce();
});


it.each([
  { kind: "여행", tab: null, add: "고치기", input: /^여행 이름/, method: "native" },
  { kind: "일정", tab: "일정", add: "일정 더하기", input: /^할 일/, method: "escape" },
  { kind: "예약", tab: "예약", add: "예약 더하기", input: /^이름/, method: "backdrop" },
  { kind: "비용", tab: "비용", add: "쓴 돈 적기", input: /^무엇에/, method: "cancel" },
  { kind: "사람", tab: "사람", add: "사람 더하기", input: /^이름/, method: "close" },
])("protects the dirty $kind editor until discard is confirmed ($method)", async ({ tab, add, input, method }) => {
  const close = vi.fn();
  render(<Travel onClose={close} />);
  await screen.findByRole("heading", { name: "Trip b" });
  if (tab) fireEvent.click(screen.getByRole("link", { name: tab }));
  fireEvent.click(screen.getByRole("button", { name: add }));
  const editor = screen.getByRole("dialog");
  const field = within(editor).getByLabelText(input) as HTMLInputElement;
  fireEvent.change(field, { target: { value: "아직 저장하지 않은 내용" } });
  if (method === "native") {
    await waitFor(() => expect(native.onCloseRequested).toHaveBeenCalled());
    const preventDefault = vi.fn();
    act(() => native.onCloseRequested.mock.calls.at(-1)![0]({ preventDefault }));
    expect(preventDefault).toHaveBeenCalled();
  } else if (method === "escape") fireEvent(editor, new Event("cancel", { cancelable: true }));
  else if (method === "backdrop") fireEvent.click(editor);
  else if (method === "cancel") fireEvent.click(within(editor).getByRole("button", { name: "취소" }));
  else fireEvent.click(within(editor).getByRole("button", { name: /닫기/ }));
  const confirmation = screen.getByRole("dialog", { name: "저장하지 않은 변경을 버릴까요?" });
  fireEvent.click(within(confirmation).getByRole("button", { name: "계속 작성" }));
  expect(field.value).toBe("아직 저장하지 않은 내용");
  expect(close).not.toHaveBeenCalled();
  if (method === "native") act(() => native.onCloseRequested.mock.calls.at(-1)![0]({ preventDefault: vi.fn() }));
  else fireEvent.click(within(editor).getByRole("button", { name: "취소" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "저장하지 않은 변경을 버릴까요?" })).getByRole("button", { name: "버리기" }));
  if (method === "native") expect(close).toHaveBeenCalledOnce();
  else expect(screen.queryByRole("dialog", { name: /Trip b/ })).toBeNull();
});
