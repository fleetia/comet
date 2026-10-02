import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { listen, type EventCallback } from "@tauri-apps/api/event";
import { Launcher } from "../components/Launcher/Launcher";
import { bindTarget, launcherResults, type LauncherState } from "../components/Launcher/search";
import { PREVIEW_SNAPSHOT, command, isDesktop } from "../hooks/useSnapshot";
import { getWidgetPreview } from "../widgets/previewWidgets";
import type { WidgetSnapshot } from "../widgets/types";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(() => true),
}));
const widgets = getWidgetPreview();
let widgetState: WidgetSnapshot | null = widgets;
vi.mock("../widgets/useWidgets", () => ({
  useWidgets: () => ({ snapshot: widgetState, error: null, reload: vi.fn() }),
}));
const initial: LauncherState = {
  sessionId: 1,
  shortcut: "CommandOrControl+Shift+Space",
  shortcutRegistered: true,
  shortcutError: null,
};
let receive: EventCallback<LauncherState>;
beforeEach(() => {
  widgetState = widgets;
  vi.mocked(isDesktop).mockReturnValue(true);
  vi.mocked(command)
    .mockReset()
    .mockImplementation(async (name) => (name === "get_launcher_state" ? initial : undefined));
  vi.mocked(listen).mockImplementation(async (_name, callback) => {
    receive = callback as EventCallback<LauncherState>;
    return vi.fn<() => void>();
  });
});
afterEach(cleanup);
function results(
  query: string,
  state: WidgetSnapshot | null = widgets,
): ReturnType<typeof launcherResults> {
  return launcherResults(
    query,
    PREVIEW_SNAPSHOT,
    state,
    bindTarget(query, PREVIEW_SNAPSHOT.characters, null),
  );
}
async function compose(query: string): Promise<HTMLInputElement> {
  render(<Launcher snapshot={PREVIEW_SNAPSHOT} />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_launcher_state"));
  const input = screen.getByRole("combobox") as HTMLInputElement;
  fireEvent.change(input, { target: { value: query } });
  return input;
}
function executed(): unknown[][] {
  return vi.mocked(command).mock.calls.filter(([name]) => name === "execute_launcher");
}

describe("local command and conversation routing", () => {
  it("matches aliases and specific settings while retaining the conversation alternative", () => {
    expect(results("설정")[0].action).toEqual({ type: "settings", section: null });
    expect(results("AI 연결")[0].action).toEqual({ type: "settings", section: "model" });
    expect(results("공던지기")[0].action).toEqual({
      type: "widget",
      id: expect.any(String),
      expectedRevision: expect.any(Number),
    });
    // The conversation alternative stays, followed only by the explicit task row.
    expect(results("공 던지기").map((result) => result.kind).slice(-2)).toEqual(["chat", "todo"]);
  });
  it.each(["공원 가고 싶다", "설정 바꾸기 귀찮네", "오늘 졸리네"])(
    "keeps the whole sentence %s as a conversation",
    (query) => {
      expect(results(query).map((result) => result.kind)).toEqual(["chat", "todo"]);
      expect(results(query)[0].action).toEqual({ type: "chat", target: "all", content: query });
      expect(results(query)[1].action).toMatchObject({ type: "addTodo", title: query });
    },
  );
  it("offers the todo row only for plain input that fits and the todo tool can take", () => {
    expect(results(">B 오늘 졸리네").some((result) => result.kind === "todo")).toBe(false);
    expect(results("가".repeat(501)).at(-1)).toMatchObject({ kind: "todo", action: undefined });
    const withoutTodo = { ...widgets, widgets: widgets.widgets.filter((item) => item.kind !== "todo") };
    expect(results("우유 사기", withoutTodo).at(-1)).toMatchObject({
      id: "widget:todo",
      action: { type: "settings", section: "widgets" },
    });
    expect(results("우유 사기", null).some((result) => result.kind === "todo")).toBe(false);
  });
  it("does not turn a known widget into chat while loading or when not installed", () => {
    expect(results("공던지기", null)[0].kind).toBe("notice");
    expect(results("공던지기", null)[0].action).toBeUndefined();
    expect(results("공던지기", { ...widgets, widgets: [] })[0].action).toEqual({
      type: "settings",
      section: "widgets",
    });
    expect(
      results("공던지기", {
        ...widgets,
        widgets: widgets.widgets.map((entry) => ({ ...entry, enabled: false })),
      })[0].title,
    ).toContain("켜기 설정");
  });
  it("does not offer the collection to someone who never had one", () => {
    const fresh = { ...widgets, widgets: widgets.widgets.filter((item) => item.kind !== "collection") };
    expect(results("수집함", fresh).some((result) => result.id === "widget:collection")).toBe(false);
    expect(results("수집함").some((result) => result.id === "widget:collection")).toBe(true);
  });
  it("routes installed widgets requiring setup to their settings", () => {
    const pendingSetup: WidgetSnapshot = {
      ...widgets,
      widgets: widgets.widgets.map((entry) => ({
        ...entry,
        installed: true,
        enabled: true,
        status: "setup",
      })),
    };
    const result = results("공", pendingSetup)[0];
    expect(result.title).toBe("공 설정 열기");
    expect(result.preview).toContain("사용 준비가 필요");
    expect(result.action).toEqual({ type: "settings", section: "widgets" });
  });
  it("explicit conversation bypasses settings and maps B to its real ID", () => {
    expect(results(">B 설정")[0].action).toEqual({
      type: "chat",
      target: PREVIEW_SNAPSHOT.characters.active[1],
      content: "설정",
    });
    expect(results("> 오늘 졸리네")[0].action).toEqual({
      type: "chat",
      target: "all",
      content: "오늘 졸리네",
    });
  });
  it("never falls back to all for missing targets or empty messages", () => {
    expect(results(">Z 오늘 졸리네")[0].action).toBeUndefined();
    expect(results(">B ")[0].action).toBeUndefined();
    const alone = {
      ...PREVIEW_SNAPSHOT,
      characters: {
        ...PREVIEW_SNAPSHOT.characters,
        active: PREVIEW_SNAPSHOT.characters.active.slice(0, 1),
      },
    };
    expect(launcherResults(">B 오늘 졸리네", alone, widgets, null)[0].action).toBeUndefined();
  });
  it("pins selected character identity across reorder and rejects a departed recipient", () => {
    const binding = bindTarget(">B 안녕", PREVIEW_SNAPSHOT.characters, null);
    const reordered = {
      ...PREVIEW_SNAPSHOT.characters,
      active: [...PREVIEW_SNAPSHOT.characters.active].reverse(),
    };
    expect(bindTarget(">B 안녕하세요", reordered, binding)).toEqual(binding);
    expect(
      launcherResults(
        ">B 안녕",
        { ...PREVIEW_SNAPSHOT, characters: reordered },
        widgets,
        binding,
      )[0].action,
    ).toMatchObject({ target: PREVIEW_SNAPSHOT.characters.active[1] });
    expect(
      launcherResults(
        ">B 안녕",
        { ...PREVIEW_SNAPSHOT, characters: { ...reordered, active: [] } },
        widgets,
        binding,
      )[0].action,
    ).toBeUndefined();
  });
});

it("previews only chat rows and uses arrows and Enter for the selected row", async () => {
  const input = await compose("설정");
  expect(screen.queryByRole("region", { name: "실행 미리보기" })).toBeNull();
  expect(executed()).toHaveLength(0);
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(screen.getByRole("option", { selected: true }).textContent).toContain("모두에게");
  expect(screen.getByRole("region", { name: "실행 미리보기" }).textContent).toContain("설정");
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(executed()).toHaveLength(1));
  expect(executed()[0][1]).toEqual({
    request: {
      sessionId: 1,
      action: { type: "chat", target: "all", content: "설정", clientMessageId: expect.any(String) },
    },
  });
});
it("leaves IME Enter, arrows and Escape to composition", async () => {
  const input = await compose("공 던지기");
  fireEvent.compositionStart(input);
  for (const key of ["Enter", "ArrowDown", "Escape"])
    fireEvent.keyDown(input, { key, keyCode: 229 });
  expect(executed()).toHaveLength(0);
  expect(command).not.toHaveBeenCalledWith("close_launcher", expect.anything());
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(input.value).toBe(""));
  expect(executed()).toHaveLength(1);
});
it("retains failed drafts and prevents repeated Enter from dispatching twice", async () => {
  let rejectRequest: (cause: Error) => void = () => {};
  const input = await compose("오늘 졸리네");
  vi.mocked(command).mockImplementation((name) =>
    name === "execute_launcher"
      ? new Promise((_, reject) => {
          rejectRequest = reject;
        })
      : Promise.resolve(initial),
  );
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(executed()).toHaveLength(1);
  await act(async () => rejectRequest(new Error("모델을 먼저 준비해 주세요.")));
  expect(screen.getByRole("alert").textContent).toContain("모델을 먼저 준비");
  expect(input.value).toBe("오늘 졸리네");
});
it("saves a task only when its row is chosen and reuses the request id on retry", async () => {
  let rejectRequest: (cause: Error) => void = () => {};
  const input = await compose("우유 사기");
  vi.mocked(command).mockImplementation((name) =>
    name === "execute_launcher"
      ? new Promise((_, reject) => {
          rejectRequest = reject;
        })
      : Promise.resolve(initial),
  );
  expect(screen.getByRole("option", { selected: true }).textContent).toContain("모두에게");
  fireEvent.keyDown(input, { key: "ArrowDown" });
  expect(screen.getByRole("option", { selected: true }).textContent).toContain("할 일로 적기");
  fireEvent.keyDown(input, { key: "Enter" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(executed()).toHaveLength(1);
  const first = executed()[0][1] as { request: { action: { requestId: string } } };
  expect(first.request.action).toMatchObject({
    type: "addTodo",
    title: "우유 사기",
    requestId: expect.any(String),
  });
  await act(async () => rejectRequest(new Error("다시 시도해 주세요.")));
  expect(input.value).toBe("우유 사기");
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(executed()).toHaveLength(2));
  const retry = executed()[1][1] as { request: { action: { requestId: string } } };
  expect(retry.request.action.requestId).toBe(first.request.action.requestId);
});
it("keeps an abandoned draft when closing and reopening without sending", async () => {
  const input = await compose(">B 오늘 졸리네");
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() => expect(command).toHaveBeenCalledWith("close_launcher", { sessionId: 1 }));
  act(() => receive({ event: "launcher-opened", id: 1, payload: { ...initial, sessionId: 2 } }));
  expect(input.value).toBe(">B 오늘 졸리네");
  expect(executed()).toHaveLength(0);
});
it("does not let a late accepted action erase a newer session draft", async () => {
  let finish: () => void = () => {};
  const input = await compose("메모");
  vi.mocked(command).mockImplementation((name) =>
    name === "execute_launcher"
      ? new Promise<void>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve(initial),
  );
  fireEvent.keyDown(input, { key: "Enter" });
  act(() => receive({ event: "launcher-opened", id: 2, payload: { ...initial, sessionId: 3 } }));
  fireEvent.change(input, { target: { value: "다른 말" } });
  await act(async () => finish());
  expect(input.value).toBe("다른 말");
});
it("offers actual recipients when > is entered and chooses before sending", async () => {
  const input = await compose(">");
  const targets = screen.getAllByRole("option");
  expect(targets).toHaveLength(PREVIEW_SNAPSHOT.characters.active.length + 1);
  fireEvent.click(targets[2]);
  expect(input.value).toBe(">B ");
  expect(executed()).toHaveLength(0);
});
