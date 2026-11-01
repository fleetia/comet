import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { listen, type EventCallback } from "@tauri-apps/api/event";
import { Launcher } from "../components/Launcher/Launcher";
import { bindTarget, launcherResults, type LauncherState } from "../components/Launcher/search";
import { PREVIEW_SNAPSHOT, command, isDesktop } from "../hooks/useSnapshot";
import { getWidgetPreview } from "../widgets/previewWidgets";
import type { WidgetSnapshot } from "../widgets/types";
import type { WidgetDesktopState } from "../widgets/WidgetManager/useWidgetDesktop";

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
vi.mock("../widgets/GeneratedWidgets/useGeneratedWidgets", () => ({
  useGeneratedWidgets: () => ({
    workshop: {
      widgets: [],
      automatic: true,
      runtime: "javascript",
      generationEligibility: {
        allowed: false,
        reason: "위젯을 제작할 모델을 확인하고 있어요.",
        model: "",
        parameterBillions: null,
        source: "unknown",
      },
    },
    error: null,
    reload: vi.fn(),
  }),
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
  vi.mocked(listen).mockImplementation(async (name, callback) => {
    if (name === "launcher-opened") receive = callback as EventCallback<LauncherState>;
    return vi.fn<() => void>();
  });
});
afterEach(cleanup);

it("hydrates the first lazy open when its event preceded listener registration", async () => {
  let ready: (() => void) | undefined;
  vi.mocked(listen).mockImplementation((name) =>
    name === "launcher-opened"
      ? new Promise((resolve) => {
          ready = () => resolve(vi.fn<() => void>());
        })
      : Promise.resolve(vi.fn<() => void>()),
  );
  const opened = { ...initial, sessionId: 4 };
  vi.mocked(command).mockImplementation(async (name) =>
    name === "get_launcher_state" ? opened : undefined,
  );
  render(<Launcher snapshot={PREVIEW_SNAPSHOT} />);
  expect(command).not.toHaveBeenCalledWith("get_launcher_state");
  await act(async () => ready?.());
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_launcher_state"));
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "메모" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("execute_launcher", {
      request: expect.objectContaining({ sessionId: 4 }),
    }),
  );
});

it("ignores a stale hydration response after a rapid reopen event", async () => {
  let hydrate: ((state: LauncherState) => void) | undefined;
  vi.mocked(command).mockImplementation((name) =>
    name === "get_launcher_state"
      ? new Promise<LauncherState>((resolve) => {
          hydrate = resolve;
        })
      : Promise.resolve(undefined),
  );
  render(<Launcher snapshot={PREVIEW_SNAPSHOT} />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_launcher_state"));
  act(() => receive({ event: "launcher-opened", id: 2, payload: { ...initial, sessionId: 3 } }));
  const input = screen.getByRole("combobox") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "다음에 쓸 초안" } });
  await act(async () => hydrate?.(initial));
  expect(input.value).toBe("다음에 쓸 초안");
  fireEvent.keyDown(input, { key: "Escape" });
  await waitFor(() => expect(command).toHaveBeenCalledWith("close_launcher", { sessionId: 3 }));
  expect(command).not.toHaveBeenCalledWith("close_launcher", { sessionId: 1 });
});

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
  it.each(["clock", "weather"])("routes %s to the shared open action even before setup", (kind) => {
    const instance = widgets.widgets.find((item) => item.kind === kind)!;
    const state: WidgetSnapshot = { ...widgets, widgets: widgets.widgets.map((item) => item.id === instance.id ? { ...item, status: "setup" } : item) };
    const entry = state.catalog.find((item) => item.id === kind)!;
    expect(results(entry.name, state).find((item) => item.id === `widget:${kind}`)?.action).toEqual({
      type: "widget", id: instance.id, expectedRevision: instance.revision,
    });
  });

  it("offers keyboard navigation to desktop widgets", () => {
    const clock = widgets.widgets.find((item) => item.kind === "clock")!;
    const weather = widgets.widgets.find((item) => item.kind === "weather")!;
    const desktop: WidgetDesktopState = { revision: 1, mode: "freeform", order: [clock.id, weather.id] };
    const found = launcherResults("바탕화면 위젯으로 이동", PREVIEW_SNAPSHOT, widgets, null, [], desktop);
    for (const widget of [clock, weather]) {
      const result = found.find((item) => item.id === `focus-desktop:widget-display-${widget.id}`);
      expect(result?.title).toBe(`이동: ${widgets.catalog.find((entry) => entry.id === widget.kind)?.name}`);
      expect(result?.action)
        .toEqual({ type: "focusDesktopWidget", label: `widget-display-${widget.id}` });
    }
    const clockResults = launcherResults("시계로 이동", PREVIEW_SNAPSHOT, widgets, null, [], desktop);
    expect(clockResults.find((item) => item.id === `focus-desktop:widget-display-${clock.id}`)?.title)
      .toBe(`이동: ${widgets.catalog.find((entry) => entry.id === "clock")?.name}`);
    const simpleNameWidgets = { ...widgets, catalog: widgets.catalog.map((entry) => entry.id === "clock" ? { ...entry, name: "시계" } : entry) };
    const simpleClock = launcherResults("시계로 이동", PREVIEW_SNAPSHOT, simpleNameWidgets, null, [], desktop);
    expect(simpleClock.find((item) => item.id === `focus-desktop:widget-display-${clock.id}`)?.title).toBe("이동: 시계");
  });
  it.each([
    [{ revision: 1, mode: "stack", stackHidden: true, order: ["clock"] }, true],
    [{ revision: 1, mode: "stack", stackHidden: false, order: ["clock"] }, false],
    [{ revision: 1, mode: "stack", stackHidden: true, order: [] }, false],
    [{ revision: 1, mode: "freeform", stackHidden: true, order: ["clock"] }, false],
  ] as [WidgetDesktopState, boolean][])(
    "shows stack recovery only when available",
    (desktop, visible) => {
      for (const query of ["", "모아두기"]) {
        const found = launcherResults(query, PREVIEW_SNAPSHOT, widgets, null, [], desktop);
        expect(found.some((item) => item.id === "widget-stack")).toBe(visible);
        if (visible) {
          expect(found.find((item) => item.id === "widget-stack")?.action).toEqual({
            type: "openWidgetStack",
          });
        }
      }
    },
  );

  it("executes stack recovery through the current launcher session", async () => {
    let receiveDesktop: EventCallback<WidgetDesktopState> | undefined;
    vi.mocked(listen).mockImplementation(async (name, callback) => {
      if (name === "launcher-opened") receive = callback as EventCallback<LauncherState>;
      if (name === "widget-desktop-state")
        receiveDesktop = callback as EventCallback<WidgetDesktopState>;
      return vi.fn<() => void>();
    });
    vi.mocked(command).mockImplementation(async (name) => {
      if (name === "get_launcher_state") return initial;
      if (name === "get_widget_desktop") {
        return { revision: 1, mode: "stack", stackHidden: false, order: ["clock"] };
      }
      return undefined;
    });
    const input = await compose("모아두기");
    await waitFor(() => expect(receiveDesktop).toBeDefined());
    expect(screen.queryByRole("option", { name: /모아두기 다시 표시/ })).toBeNull();
    act(() =>
      receiveDesktop?.({
        event: "widget-desktop-state",
        id: 1,
        payload: { revision: 2, mode: "stack", stackHidden: true, order: ["clock"] },
      }),
    );
    await screen.findByRole("option", { name: /모아두기 다시 표시/ });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("execute_launcher", {
        request: { sessionId: 1, action: { type: "openWidgetStack" } },
      }),
    );
  });
  it.each([
    ["안내서", "guide", "안내서 열기"],
    ["튜토리얼", "tutorial", "튜토리얼 다시 보기"],
    ["처음부터", "tutorial", "튜토리얼 다시 보기"],
  ])("finds and executes %s in 도움", async (query, type, title) => {
    const input = await compose(query);
    expect(screen.getByText("도움")).toBeTruthy();
    expect(screen.getByRole("option", { name: new RegExp(title) })).toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("execute_launcher", {
        request: { sessionId: 1, action: { type } },
      }),
    );
  });

  it("lists guide before tutorial in the help group", () => {
    expect(
      results("안내서")
        .filter((result) => result.kind === "help")
        .map((result) => result.id),
    ).toEqual(["guide", "tutorial"]);
  });

  it("describes the search scope until a friend is being picked", async () => {
    const input = await compose("");
    const hint = document.getElementById("launcher-hint");
    expect(hint?.textContent).toBe("설정·위젯·여행을 찾아요. 메모는 다이어리에서 찾아요.");
    fireEvent.change(input, { target: { value: ">" } });
    expect(hint?.textContent).toBe("친구를 고르고 말을 적어 주세요. 예: >B 오늘 졸리네");
  });

  it.each([
    [true, true, "지금은 쉬고 있어요"],
    [true, false, "지금은 쉬고 있어요"],
    [false, true, "바탕화면에 있어요"],
    [false, false, "자리 비움"],
  ] as const)(
    "reflects hidden=%s and present=%s in initial character rows",
    (hidden, present, detail) => {
      const id = PREVIEW_SNAPSHOT.characters.active[0];
      const snapshot = {
        ...PREVIEW_SNAPSHOT,
        runtime: {
          ...PREVIEW_SNAPSHOT.runtime,
          hidden,
          presentCharacterIds: present ? [id] : [],
        },
      };
      for (const query of ["", "  "]) {
        const found = launcherResults(query, snapshot, widgets, null);
        expect(found.find((result) => result.id === `target:${id}`)).toMatchObject({
          kind: "target",
          detail,
          recipient: { id, token: "A" },
        });
        expect(found.find((result) => result.id === "target:all")?.detail).toBe(
          "친구들이 순서대로 답해요",
        );
      }
    },
  );

  it.each([
    ["단어장 설정", "dialogue"],
    ["대화팩 설정", "dialogue"],
    ["사용자 설정", "general"],
  ])("routes the legacy %s alias to %s", (query, section) => {
    expect(results(query)[0].action).toEqual({ type: "settings", section });
  });

  it("matches aliases and specific settings while retaining the conversation alternative", () => {
    expect(results("설정")[0].action).toEqual({ type: "settings", section: null });
    expect(results("AI 연결")[0].action).toEqual({ type: "settings", section: "model" });
    expect(results("공던지기")[0].action).toEqual({
      type: "widget",
      id: expect.any(String),
      expectedRevision: expect.any(Number),
    });
    // The conversation alternative stays, followed only by the explicit task row.
    expect(
      results("공 던지기")
        .map((result) => result.kind)
        .slice(-2),
    ).toEqual(["chat", "todo"]);
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
    expect(results(">B 오늘 졸리네").at(-1)?.action).toMatchObject({ type: "addTodo", title: "오늘 졸리네" });
    expect(results("가".repeat(501)).at(-1)).toMatchObject({ kind: "todo", action: undefined });
    const withoutTodo = {
      ...widgets,
      widgets: widgets.widgets.filter((item) => item.kind !== "todo"),
    };
    expect(results("우유 사기", withoutTodo).at(-1)).toMatchObject({
      id: "widget:todo",
      action: { type: "settings", section: "widgets", widgetKind: "todo" },
    });
    expect(results("우유 사기", null).some((result) => result.kind === "todo")).toBe(false);
  });
  it("does not turn a known widget into chat while loading or when not installed", () => {
    expect(results("공던지기", null)[0].kind).toBe("notice");
    expect(results("공던지기", null)[0].action).toBeUndefined();
    expect(results("공던지기", { ...widgets, widgets: [] })[0].action).toEqual({
      type: "settings",
      section: "widgets",
      widgetKind: "ball",
    });
    expect(
      results("공던지기", {
        ...widgets,
        widgets: widgets.widgets.map((entry) => ({ ...entry, reaction: false })),
      })[0].title,
    ).toContain("꺼내기");
  });
  it("opens trips by name or destination and keeps conversation as the last choice", () => {
    const travels = [
      {
        id: "jeju",
        title: "제주 가족 여행",
        destination: "제주",
        startDate: "2026-10-24",
        endDate: "2026-10-25",
        finished: false,
      },
      {
        id: "old",
        title: "작년 제주",
        destination: "제주",
        startDate: "2025-05-01",
        endDate: "2025-05-02",
        finished: true,
      },
      {
        id: "tokyo",
        title: "도쿄 출장",
        destination: "도쿄",
        startDate: "2026-11-02",
        endDate: "2026-11-04",
        finished: false,
      },
    ];
    const found = launcherResults("제주", PREVIEW_SNAPSHOT, widgets, null, travels);
    expect(
      found.filter((result) => result.kind === "travel").map((result) => result.action),
    ).toEqual([
      { type: "travel", id: "jeju" },
      { type: "travel", id: "old" },
    ]);
    expect(found.at(-2)?.kind).toBe("chat");
    expect(
      launcherResults("", PREVIEW_SNAPSHOT, widgets, null, travels).some(
        (result) => result.kind === "travel",
      ),
    ).toBe(false);
  });

  it("labels memo launch as creating a desktop sheet", () => {
    const result = results("메모").find((item) => item.id === "widget:memo");
    expect(result?.title).toBe("새 메모 꺼내기");
    expect(result?.preview).toContain("다이어리");
    expect(result?.action).toMatchObject({ type: "widget", id: "memo" });
  });
  it("does not offer retired collection or journal widgets", () => {
    for (const [query, kind] of [
      ["수집함", "collection"],
      ["사건 일지", "journal"],
    ]) {
      expect(results(query).some((result) => result.id === `widget:${kind}`)).toBe(false);
    }
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
    expect(result.action).toEqual({ type: "settings", section: "widgets", widgetKind: "ball" });
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

it("refreshes character presence labels and selects a hidden recipient without sending", async () => {
  const id = PREVIEW_SNAPSHOT.characters.active[0];
  const snapshot = {
    ...PREVIEW_SNAPSHOT,
    runtime: { ...PREVIEW_SNAPSHOT.runtime, hidden: false, presentCharacterIds: [id] },
  };
  const { rerender } = render(<Launcher snapshot={snapshot} />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_launcher_state"));
  const selected = (): HTMLElement => screen.getByRole("option", { selected: true });
  expect(selected().textContent).toContain("바탕화면에 있어요");

  const hidden = { ...snapshot, runtime: { ...snapshot.runtime, hidden: true } };
  rerender(<Launcher snapshot={hidden} />);
  expect(selected().textContent).toContain("지금은 쉬고 있어요");
  rerender(
    <Launcher
      snapshot={{ ...snapshot, runtime: { ...snapshot.runtime, presentCharacterIds: [] } }}
    />,
  );
  expect(selected().textContent).toContain("자리 비움");
  rerender(<Launcher snapshot={snapshot} />);
  expect(selected().textContent).toContain("바탕화면에 있어요");

  rerender(<Launcher snapshot={hidden} />);
  const input = screen.getByRole("combobox") as HTMLInputElement;
  fireEvent.keyDown(input, { key: "Enter" });
  expect(input.value).toBe("");
  expect(screen.getByRole("button", { name: /수신자 해제/ })).toBeTruthy();
  expect(selected().textContent).toContain("캐릭터 표시 후 말 걸기");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(executed()).toHaveLength(0);
});

it("previews only chat rows and uses arrows and Enter for the selected row", async () => {
  const input = await compose("설정");
  expect(screen.queryByRole("region", { name: "실행 미리보기" })).toBeNull();
  expect(executed()).toHaveLength(0);
  const chat = screen.getByRole("option", { name: /모두에게.*말 걸기/ });
  fireEvent.pointerMove(chat);
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
it.each(["missing", "setup"] as const)(
  "carries the selected %s widget settings target through the current launcher session",
  async (status) => {
    widgetState = {
      ...widgets,
      widgets:
        status === "missing"
          ? widgets.widgets.filter((item) => item.kind !== "focus-timer")
          : widgets.widgets.map((item) =>
              item.kind === "focus-timer"
                ? {
                    ...item,
                    status: "setup",
                  }
                : item,
            ),
    };
    const input = await compose("집중");
    expect(screen.getByRole("option", { selected: true }).textContent).toContain("집중 타이머");
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(input.value).toBe(""));
    expect(executed()).toEqual([
      [
        "execute_launcher",
        {
          request: {
            sessionId: 1,
            action: { type: "settings", section: "widgets", widgetKind: "focus-timer" },
          },
        },
      ],
    ]);
    expect(command).not.toHaveBeenCalledWith("open_planner_settings", expect.anything());
    expect(command).not.toHaveBeenCalledWith("install_widgets", expect.anything());
    expect(command).not.toHaveBeenCalledWith("set_widget_enabled", expect.anything());
  },
);
it("preserves the instance id and revision when launching an available widget", async () => {
  widgetState = {
    ...widgets,
    widgets: widgets.widgets.map((item) =>
      item.kind === "focus-timer"
        ? {
            ...item,
            id: "focus-instance",
            revision: 27,
            status: "enabled",
          }
        : item,
    ),
  };
  const input = await compose("집중");
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(input.value).toBe(""));
  expect(executed()).toEqual([
    [
      "execute_launcher",
      {
        request: {
          sessionId: 1,
          action: { type: "widget", id: "focus-instance", expectedRevision: 27 },
        },
      },
    ],
  ]);
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
  expect(input.value).toBe("오늘 졸리네");
  expect(screen.getByRole("button", { name: /수신자 해제/ })).toBeTruthy();
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
  expect(input.value).toBe("");
  expect(screen.getByRole("button", { name: /수신자 해제/ })).toBeTruthy();
  expect(executed()).toHaveLength(0);
});


it.each([["봉투", "preparation"], ["펫", "pet"], ["운세", "fortune"]])(
  "finds %s by its widget name or alias", (query, id) => {
    expect(results(query).some((item) => item.id === `widget:${id}`)).toBe(true);
  },
);
it("matches widget ids only by exact value or prefix while preserving visible substring matches", () => {
  for (const query of ["hi", "no", "he"]) {
    expect(results(query)[0].kind).toBe("chat");
  }
  expect(results("notice").some((item) => item.id === "widget:external-notice")).toBe(false);
  for (const query of ["fish", "fishing"]) {
    expect(results(query)[0].id).toBe("widget:fishing");
  }
  expect(results("료구").some((item) => item.id === "widget:completion-jar")).toBe(true);
  expect(results("위바").some((item) => item.id === "widget:small-match")).toBe(true);
});
it("preserves one-character prefixes but excludes one-character word and substring matches", () => {
  expect(results("메").some((item) => item.id === "widget:memo")).toBe(true);
  expect(results("설").some((item) => item.id === "settings")).toBe(true);
  const generated = [{ id: "lake", installed: true, definition: { name: "달빛 호수", description: "" } }] as Parameters<typeof launcherResults>[6];
  for (const query of ["호", "빛"]) {
    expect(launcherResults(query, PREVIEW_SNAPSHOT, widgets, null, [], null, generated)
      .some((item) => item.id === "generated:lake")).toBe(false);
  }
});
it("keeps the default results for an empty query", () => {
  expect(results("").filter((item) => item.kind !== "target").map((item) => item.id))
    .toEqual(["diary", "widget:focus-timer", "widget:memo", "settings"]);
  expect(results("").filter((item) => item.kind === "target")).toHaveLength(PREVIEW_SNAPSHOT.characters.active.length + 1);
});
it("keeps a one-character conversation and sentence Enter as chat", async () => {
  expect(results("졸")[0].kind).toBe("chat");
  const input = await compose("안녕 친구야");
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(executed()[0][1]).toMatchObject({ request: { action: { type: "chat", content: "안녕 친구야" } } }));
});
it("shows diary first in defaults, today status, and desktop editing aliases", () => {
  const found = results("");
  const diary = found.find((item) => item.id === "diary");
  expect(diary?.action).toEqual({ type: "diary" });
  expect(diary?.detail).toMatch(/오늘 일정 \d+개 · 할 일 \d+\/\d+ 완료/);
  expect(results("오늘")[0].action).toEqual({ type: "diary" });
  expect(results("자유 배치")[0].action).toEqual({ type: "editWidgetDesktop" });
});
it("offers installed AI widgets in search only", () => {
  const generated = [{ id: "g", installed: true, definition: { name: "나만의 계산기", description: "계산" } }, { id: "gone", installed: false, definition: { name: "삭제 계산기", description: "" } }] as Parameters<typeof launcherResults>[6];
  const found = launcherResults("계산기", PREVIEW_SNAPSHOT, widgets, null, [], null, generated);
  expect(found.find((item) => item.id === "generated:g")?.action).toEqual({ type: "generatedWidget", id: "g" });
  expect(found.some((item) => item.id === "generated:gone")).toBe(false);
  expect(launcherResults("", PREVIEW_SNAPSHOT, widgets, null, [], null, generated).some((item) => item.id === "generated:g")).toBe(false);
});
it("keeps the message when removing a recipient and saves only the body with Shift+Enter", async () => {
  const input = await compose(">");
  fireEvent.click(screen.getAllByRole("option")[1]);
  fireEvent.change(input, { target: { value: "우유 사기" } });
  expect(screen.getByRole("button", { name: /수신자 해제/ })).toBeTruthy();
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  await waitFor(() => expect(executed()[0][1]).toMatchObject({ request: { action: { type: "addTodo", title: "우유 사기" } } }));
});
it("removes the chip with Backspace only for empty input outside composition", async () => {
  const input = await compose(">");
  fireEvent.click(screen.getAllByRole("option")[1]);
  fireEvent.compositionStart(input);
  fireEvent.keyDown(input, { key: "Backspace", keyCode: 229 });
  expect(screen.getByRole("button", { name: /수신자 해제/ })).toBeTruthy();
  fireEvent.compositionEnd(input);
  fireEvent.keyDown(input, { key: "Backspace", isComposing: true });
  expect(screen.getByRole("button", { name: /수신자 해제/ })).toBeTruthy();
  fireEvent.keyDown(input, { key: "Backspace" });
  expect(screen.queryByRole("button", { name: /수신자 해제/ })).toBeNull();
});
it("restores the draft and recipient when leaving the friend picker without choosing", async () => {
  const input = await compose(">B 기존 본문");
  const recipient = screen.getByRole("button", { name: /수신자 해제/ }).textContent;
  fireEvent.click(screen.getByRole("button", { name: /친구 고르기/ }));
  expect(input.value).toBe(">");
  fireEvent.change(input, { target: { value: "" } });
  expect(input.value).toBe("기존 본문");
  expect(screen.getByRole("button", { name: /수신자 해제/ }).textContent).toBe(recipient);
});
it("keeps the new text and discards the previous draft when removing the picker prefix", async () => {
  const input = await compose(">B 이전 본문");
  fireEvent.click(screen.getByRole("button", { name: /친구 고르기/ }));
  fireEvent.change(input, { target: { value: "> 안녕" } });
  fireEvent.change(input, { target: { value: " 안녕" } });
  expect(input.value).toBe(" 안녕");
  expect(screen.queryByRole("button", { name: /수신자 해제/ })).toBeNull();
  fireEvent.change(input, { target: { value: "" } });
  expect(input.value).toBe("");
  expect(screen.queryByRole("button", { name: /수신자 해제/ })).toBeNull();
});
it("filters friends after typing > with a recipient and preserves the previous draft", async () => {
  const third = {
    ...PREVIEW_SNAPSHOT.characters.installed[0],
    id: "builtin-c",
    definition: { ...PREVIEW_SNAPSHOT.characters.installed[0].definition, name: "세 번째" },
  };
  const snapshot = {
    ...PREVIEW_SNAPSHOT,
    characters: {
      installed: [...PREVIEW_SNAPSHOT.characters.installed, third],
      active: [...PREVIEW_SNAPSHOT.characters.active, third.id],
    },
  };
  render(<Launcher snapshot={snapshot} />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_launcher_state"));
  const input = screen.getByRole("combobox") as HTMLInputElement;
  fireEvent.change(input, { target: { value: ">B 기존 본문" } });
  const previousRecipient = screen.getByRole("button", { name: /수신자 해제/ }).textContent;
  fireEvent.change(input, { target: { value: ">C" } });
  expect(screen.queryByRole("button", { name: /수신자 해제/ })).toBeNull();
  expect(screen.getAllByRole("option")).toHaveLength(1);
  expect(screen.getByRole("option").textContent).toContain("C · 세 번째");
  fireEvent.change(input, { target: { value: "" } });
  expect(input.value).toBe("기존 본문");
  expect(screen.getByRole("button", { name: /수신자 해제/ }).textContent).toBe(previousRecipient);
  fireEvent.change(input, { target: { value: ">C" } });
  fireEvent.click(screen.getByRole("option"));
  expect(input.value).toBe("기존 본문");
  expect(screen.getByRole("button", { name: /수신자 해제/ }).textContent).toContain("세 번째");
});
it("sends > content to everyone and keeps the next draft after a recipient was selected", async () => {
  const input = await compose(">B 이전 본문");
  fireEvent.change(input, { target: { value: "> 안녕" } });
  expect(screen.queryByRole("button", { name: /수신자 해제/ })).toBeNull();
  expect(screen.getByRole("option").textContent).toContain("모두에게");
  fireEvent.keyDown(input, { key: "Enter" });
  await waitFor(() => expect(executed()[0][1]).toMatchObject({
    request: { action: { type: "chat", content: "안녕", target: "all" } },
  }));
  await waitFor(() => expect(input.value).toBe(""));
  fireEvent.change(input, { target: { value: "새 초안" } });
  expect(input.value).toBe("새 초안");
  expect(screen.queryByRole("button", { name: /수신자 해제/ })).toBeNull();
});
it("keeps > content and the previous draft when sending fails", async () => {
  const input = await compose(">B 이전 본문");
  const previousRecipient = screen.getByRole("button", { name: /수신자 해제/ }).textContent;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "execute_launcher") throw new Error("전송 실패");
    return initial;
  });
  fireEvent.change(input, { target: { value: "> 안녕" } });
  fireEvent.keyDown(input, { key: "Enter" });
  await screen.findByRole("alert");
  expect(input.value).toBe("> 안녕");
  expect(executed()[0][1]).toMatchObject({
    request: { action: { type: "chat", content: "안녕", target: "all" } },
  });
  fireEvent.change(input, { target: { value: "" } });
  expect(input.value).toBe("이전 본문");
  expect(screen.getByRole("button", { name: /수신자 해제/ }).textContent).toBe(previousRecipient);
});
it("keeps the draft when choosing a friend by typing and allows subsequent edits", async () => {
  const input = await compose("기존 본문");
  fireEvent.click(screen.getByRole("button", { name: /친구 고르기/ }));
  fireEvent.change(input, { target: { value: ">B " } });
  expect(input.value).toBe("기존 본문");
  expect(screen.getByRole("button", { name: /수신자 해제/ })).toBeTruthy();
  fireEvent.change(input, { target: { value: "새 본문" } });
  expect(input.value).toBe("새 본문");
});
it("keeps the body after removing the recipient chip", async () => {
  const input = await compose(">");
  fireEvent.click(screen.getAllByRole("option")[1]);
  fireEvent.change(input, { target: { value: "초안 유지" } });
  fireEvent.click(screen.getByRole("button", { name: /수신자 해제/ }));
  expect(input.value).toBe("초안 유지");
});
it("does not close or clear a reopened session after saving a task", async () => {
  const input = await compose("우유 사기");
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  await screen.findByText("할 일을 저장했어요");
  act(() => receive({ event: "launcher-opened", id: 2, payload: { ...initial, sessionId: 2 } }));
  fireEvent.change(input, { target: { value: "새 초안" } });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(input.value).toBe("새 초안");
  expect(command).not.toHaveBeenCalledWith("close_launcher", { sessionId: 1 });
});

it("clears a saved task immediately so reopening cannot save it again", async () => {
  const input = await compose(">B 우유 사기");
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  await screen.findByText("할 일을 저장했어요");
  expect(input.value).toBe("");
  expect(screen.queryByRole("button", { name: /수신자 해제/ })).toBeNull();
  act(() => receive({ event: "launcher-opened", id: 2, payload: { ...initial, sessionId: 2 } }));
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  expect(executed()).toHaveLength(1);
});

it("does not report a saved task as failed when closing the launcher fails", async () => {
  const input = await compose("우유 사기");
  vi.mocked(command).mockImplementation((name) =>
    name === "close_launcher" ? Promise.reject(new Error("닫기 실패")) : Promise.resolve(initial),
  );
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  await screen.findByText("할 일을 저장했어요");
  await waitFor(() => expect(command).toHaveBeenCalledWith("close_launcher", { sessionId: 1 }), { timeout: 1500 });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(input.value).toBe("");
});

it("does not close the launcher after its saved-task view unmounts", async () => {
  const view = render(<Launcher snapshot={PREVIEW_SNAPSHOT} />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_launcher_state"));
  const input = screen.getByRole("combobox");
  fireEvent.change(input, { target: { value: "우유 사기" } });
  fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
  await screen.findByText("할 일을 저장했어요");
  view.unmount();
  await new Promise((resolve) => setTimeout(resolve, 1000));
  expect(command).not.toHaveBeenCalledWith("close_launcher", { sessionId: 1 });
});
