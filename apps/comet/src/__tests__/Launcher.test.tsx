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

it("hydrates the first lazy open when its event preceded listener registration", async () => {
  let ready: (() => void) | undefined;
  vi.mocked(listen).mockImplementation(
    () =>
      new Promise((resolve) => {
        ready = () => resolve(vi.fn<() => void>());
      }),
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
    expect(results(">B 오늘 졸리네").some((result) => result.kind === "todo")).toBe(false);
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
      { id: "jeju", title: "제주 가족 여행", destination: "제주", startDate: "2026-10-24", endDate: "2026-10-25", finished: false },
      { id: "old", title: "작년 제주", destination: "제주", startDate: "2025-05-01", endDate: "2025-05-02", finished: true },
      { id: "tokyo", title: "도쿄 출장", destination: "도쿄", startDate: "2026-11-02", endDate: "2026-11-04", finished: false },
    ];
    const found = launcherResults("제주", PREVIEW_SNAPSHOT, widgets, null, travels);
    expect(found.filter((result) => result.kind === "travel").map((result) => result.action)).toEqual([
      { type: "travel", id: "jeju" },
      { type: "travel", id: "old" },
    ]);
    expect(found.at(-2)?.kind).toBe("chat");
    expect(launcherResults("", PREVIEW_SNAPSHOT, widgets, null, travels).some((result) => result.kind === "travel")).toBe(false);
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
  expect(input.value).toBe(">A ");
  expect(selected().textContent).toContain("캐릭터 표시 후 말 걸기");
  fireEvent.keyDown(input, { key: "Enter" });
  expect(executed()).toHaveLength(0);
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
