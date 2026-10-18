import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { listen } from "@tauri-apps/api/event";
import { command } from "../../hooks/useSnapshot";
import { GeneratedWidgetTool } from "./GeneratedWidgetTool";
import { runWidget, type WidgetResult } from "./sandbox";
import type { GeneratedWidget } from "./types";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("./sandbox", () => ({ runWidget: vi.fn() }));
vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));

const READY: GeneratedWidget = {
  id: "counter",
  definition: {
    name: "단수",
    description: "뜨개질 단수",
    source: "first source",
    initialState: { count: 0 },
  },
  state: { count: 0 },
  revision: 1,
  installed: true,
  enabled: true,
  installation: null,
  updatedAt: null,
  status: "ready",
  error: null,
};
function result(count: number): WidgetResult {
  return {
    state: { count },
    view: [
      { type: "number", label: "현재 단수", value: count },
      { type: "button", label: "한 단 더", action: "increment" },
    ],
  };
}
function inputResult(value: string): WidgetResult {
  return {
    state: { value },
    view: [{ type: "input", label: "메모", value, action: "edit" }],
  };
}
const INPUT: GeneratedWidget = { ...READY, state: { value: "처음" } };
function edit(value: string): void {
  const input = screen.getByRole("textbox", { name: "메모" });
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (cause: Error) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function changed(): void {
  const callback = vi
    .mocked(listen)
    .mock.calls.find(([name]) => name === "generated-widgets-changed")?.[1];
  if (!callback) throw new Error("changed listener missing");
  callback({ event: "generated-widgets-changed", id: 1, payload: undefined });
}
function writes(): string[] {
  return vi
    .mocked(command)
    .mock.calls.map(([name]) => name)
    .filter((name) =>
      ["update_generated_state", "report_generated_result", "generate_widget"].includes(name),
    );
}
function visibility(hidden: boolean): void {
  vi.spyOn(document, "hidden", "get").mockReturnValue(hidden);
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.mocked(listen).mockReset();
  vi.mocked(listen).mockResolvedValue(vi.fn());
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(READY);
  vi.mocked(runWidget).mockReset();
  vi.mocked(runWidget).mockResolvedValue(result(0));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("uses the host executor for declared UI actions and retains the reducer result", async () => {
  const original: GeneratedWidget = {
    ...READY,
    definition: {
      ...READY.definition,
      actions: [
        { id: "increment", description: "한 단 늘리기", operation: "update", inputSchema: {} },
      ],
    },
  };
  const saved: GeneratedWidget = { ...original, state: { count: 1 }, revision: 2 };
  vi.mocked(command).mockImplementation((name) =>
    Promise.resolve(
      name === "execute_generated_ui_action" ? { widget: saved, view: result(1).view } : original,
    ),
  );
  render(<GeneratedWidgetTool id="counter" />);
  await userEvent.click(await screen.findByRole("button", { name: "한 단 더" }));
  expect(await screen.findByText("1")).toBeTruthy();
  expect(command).toHaveBeenCalledWith("execute_generated_ui_action", {
    id: "counter",
    expectedRevision: 1,
    requestId: expect.any(String),
    actionId: "increment",
    input: {},
  });
  expect(vi.mocked(runWidget).mock.calls.every((call) => call[2] === null)).toBe(true);
  expect(writes()).toEqual([]);
});

it.each([false, true])(
  "repairs a host interpreter failure once at its saved revision (publish first: %s)",
  async (publishFirst) => {
    const original: GeneratedWidget = {
      ...READY,
      definition: {
        ...READY.definition,
        actions: [
          { id: "increment", description: "한 단 늘리기", operation: "update", inputSchema: {} },
        ],
      },
    };
    const failed: GeneratedWidget = {
      ...original,
      status: "error",
      error: "reducer failed",
      revision: 2,
    };
    const repaired: GeneratedWidget = {
      ...original,
      revision: 3,
      definition: { ...original.definition, source: "repaired source" },
    };
    let stored = original;
    vi.mocked(command).mockImplementation((name) => {
      if (name === "execute_generated_ui_action") {
        stored = failed;
        if (publishFirst) changed();
        return Promise.reject({ message: "reducer failed", interpreterFailure: failed });
      }
      if (name === "generate_widget") stored = repaired;
      return Promise.resolve(stored);
    });
    render(<GeneratedWidgetTool id="counter" />);
    await userEvent.click(await screen.findByRole("button", { name: "한 단 더" }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("generate_widget", {
        id: "counter",
        expectedRevision: 2,
        request: "기존 기능과 사용자 상태를 유지하며 실행 오류를 수정해 주세요: reducer failed",
      }),
    );
    expect(writes()).toEqual(["generate_widget"]);
    expect(screen.queryByRole("alert")).toBeNull();
  },
);

it.each(["취소된 요청", "위젯 revision 충돌", "저장 실패"])(
  "shows the host message without repairing code for %s",
  async (message) => {
    const original: GeneratedWidget = {
      ...READY,
      definition: {
        ...READY.definition,
        actions: [
          { id: "increment", description: "한 단 늘리기", operation: "update", inputSchema: {} },
        ],
      },
    };
    vi.mocked(command).mockImplementation((name) =>
      name === "execute_generated_ui_action"
        ? Promise.reject({ message })
        : Promise.resolve(original),
    );
    render(<GeneratedWidgetTool id="counter" />);
    await userEvent.click(await screen.findByRole("button", { name: "한 단 더" }));
    expect((await screen.findByRole("alert")).textContent).toBe(message);
    expect(writes()).toEqual([]);
  },
);

it("waits for visibility before rendering or ticking and renders immediately on return", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  visibility(true);
  render(<GeneratedWidgetTool id="counter" />);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("get_generated_widget", { id: "counter" }),
  );
  await act(async () => vi.advanceTimersByTime(5000));
  expect(runWidget).not.toHaveBeenCalled();
  act(() => visibility(false));
  expect(await screen.findByText("0")).toBeTruthy();
  expect(runWidget).toHaveBeenCalledTimes(1);
  expect(vi.mocked(runWidget).mock.calls[0][2]).toBeNull();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(vi.mocked(runWidget).mock.calls[1][2]).toEqual({ type: "tick" });
  expect(writes()).toEqual([]);
});

it.each(["resolve", "reject"] as const)(
  "cancels a hidden tick without repairing its late %s and preserves queued input on return",
  async (outcome) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const tick = deferred<WidgetResult>();
    let stored = INPUT;
    vi.mocked(command).mockImplementation((name, args) => {
      if (name === "update_generated_state") {
        stored = {
          ...stored,
          revision: stored.revision + 1,
          state: (args as { value: GeneratedWidget["state"] }).value,
        };
      }
      return Promise.resolve(stored);
    });
    vi.mocked(runWidget)
      .mockResolvedValueOnce(inputResult("처음"))
      .mockReturnValueOnce(tick.promise)
      .mockResolvedValueOnce(inputResult("처음"))
      .mockResolvedValueOnce(inputResult("남겨 둔 입력"));
    render(<GeneratedWidgetTool id="counter" />);
    await screen.findByRole("textbox", { name: "메모" });
    act(() => vi.advanceTimersByTime(1000));
    edit("남겨 둔 입력");
    const signal = vi.mocked(runWidget).mock.calls[1][4];
    act(() => visibility(true));
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      if (outcome === "resolve") tick.resolve(inputResult("취소된 주기 갱신"));
      else tick.reject(new Error("위젯 실행이 1초 제한을 넘었어요."));
    });
    await act(async () => vi.advanceTimersByTime(5000));
    expect(runWidget).toHaveBeenCalledTimes(2);
    expect(writes()).toEqual([]);
    expect(screen.queryByRole("alert")).toBeNull();
    act(() => visibility(false));
    await waitFor(() => expect(stored.state).toEqual({ value: "남겨 둔 입력" }));
    expect(vi.mocked(runWidget).mock.calls.map((call) => call[2])).toEqual([
      null,
      { type: "tick" },
      null,
      { type: "edit", value: "남겨 둔 입력" },
    ]);
    expect(writes()).toEqual(["update_generated_state"]);
    expect(screen.getByRole("textbox", { name: "메모" })).toHaveProperty("value", "남겨 둔 입력");
  },
);

it("finishes a submitted user action once while hidden and reloads its committed state on return", async () => {
  const action = deferred<WidgetResult>();
  let stored = READY;
  vi.mocked(command).mockImplementation((name, args) => {
    if (name === "update_generated_state") {
      stored = {
        ...stored,
        revision: stored.revision + 1,
        state: (args as { value: GeneratedWidget["state"] }).value,
      };
    }
    return Promise.resolve(stored);
  });
  vi.mocked(runWidget)
    .mockResolvedValueOnce(result(0))
    .mockReturnValueOnce(action.promise)
    .mockResolvedValue(result(1));
  render(<GeneratedWidgetTool id="counter" />);
  fireEvent.click(await screen.findByRole("button", { name: "한 단 더" }));
  const signal = vi.mocked(runWidget).mock.calls[1][4];
  act(() => visibility(true));
  expect(signal?.aborted).toBe(false);
  await act(async () => action.resolve(result(1)));
  expect(stored.state).toEqual({ count: 1 });
  act(() => visibility(false));
  await waitFor(() => expect(runWidget).toHaveBeenCalledTimes(3));
  expect(vi.mocked(runWidget).mock.calls[2][1]).toEqual({ count: 1 });
  expect(writes()).toEqual(["update_generated_state"]);
});

it("still reports a visible interpreter failure and asks AI to repair its matching revision", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const failed: GeneratedWidget = {
    ...READY,
    revision: 2,
    status: "error",
    error: "syntax failure",
  };
  const repaired: GeneratedWidget = {
    ...READY,
    revision: 3,
    definition: { ...READY.definition, source: "repaired source" },
  };
  vi.mocked(command).mockImplementation((name) =>
    Promise.resolve(
      name === "report_generated_result" ? failed : name === "generate_widget" ? repaired : READY,
    ),
  );
  vi.mocked(runWidget)
    .mockResolvedValueOnce(result(0))
    .mockRejectedValueOnce(new Error("syntax failure"))
    .mockResolvedValue(result(0));
  render(<GeneratedWidgetTool id="counter" />);
  fireEvent.click(await screen.findByRole("button", { name: "한 단 더" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("generate_widget", {
      id: "counter",
      expectedRevision: 2,
      request: "기존 기능과 사용자 상태를 유지하며 실행 오류를 수정해 주세요: syntax failure",
    }),
  );
  expect(command).toHaveBeenCalledWith("report_generated_result", {
    id: "counter",
    expectedRevision: 1,
    error: "syntax failure",
  });
  expect(writes()).toEqual(["report_generated_result", "generate_widget"]);
  expect(screen.queryByRole("alert")).toBeNull();
  await act(async () => vi.advanceTimersByTime(1000));
  expect(vi.mocked(runWidget).mock.calls[2][0]).toBe("repaired source");
});

it.each(["resolve", "reject"] as const)(
  "aborts an unmounted interpreter and ignores its late %s",
  async (outcome) => {
    const interpreter = deferred<WidgetResult>();
    vi.mocked(runWidget).mockReturnValue(interpreter.promise);
    const rendered = render(<GeneratedWidgetTool id="counter" />);
    await waitFor(() => expect(runWidget).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(runWidget).mock.calls[0][4];
    rendered.unmount();
    expect(signal?.aborted).toBe(true);
    await act(async () => {
      if (outcome === "resolve") interpreter.resolve(result(1));
      else interpreter.reject(new Error("syntax failure"));
    });
    expect(writes()).toEqual([]);
  },
);

it("does not begin an AI repair after unmount while reporting an interpreter error", async () => {
  const report = deferred<GeneratedWidget>();
  vi.mocked(runWidget).mockRejectedValue(new Error("syntax failure"));
  vi.mocked(command).mockImplementation((name) =>
    name === "report_generated_result" ? report.promise : Promise.resolve(READY),
  );
  const rendered = render(<GeneratedWidgetTool id="counter" />);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "report_generated_result",
      expect.objectContaining({ id: "counter", error: "syntax failure" }),
    ),
  );
  rendered.unmount();
  await act(async () =>
    report.resolve({ ...READY, revision: 2, status: "error", error: "syntax failure" }),
  );
  expect(command).not.toHaveBeenCalledWith("generate_widget", expect.anything());
  expect(command).not.toHaveBeenCalledWith("update_generated_state", expect.anything());
});

it("does not persist interpreted state after unmount while marking a draft ready", async () => {
  const report = deferred<GeneratedWidget>();
  const draft: GeneratedWidget = { ...READY, status: "draft" };
  vi.mocked(runWidget).mockResolvedValue(result(1));
  vi.mocked(command).mockImplementation((name) =>
    name === "report_generated_result" ? report.promise : Promise.resolve(draft),
  );
  const rendered = render(<GeneratedWidgetTool id="counter" />);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "report_generated_result",
      expect.objectContaining({ id: "counter", error: null }),
    ),
  );
  rendered.unmount();
  await act(async () => report.resolve({ ...READY, revision: 2 }));
  expect(command).not.toHaveBeenCalledWith("update_generated_state", expect.anything());
  expect(command).not.toHaveBeenCalledWith("generate_widget", expect.anything());
});

it("reports a storage IPC failure without replacing working code or asking AI to repair it", async () => {
  vi.mocked(runWidget).mockResolvedValueOnce(result(0)).mockResolvedValue(result(1));
  vi.mocked(command).mockImplementation((name) =>
    name === "update_generated_state"
      ? Promise.reject(new Error("disk I/O error"))
      : Promise.resolve(READY),
  );
  render(<GeneratedWidgetTool id="counter" />);
  fireEvent.click(await screen.findByRole("button", { name: "한 단 더" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "disk I/O error");
  expect(command).toHaveBeenCalledWith("update_generated_state", {
    id: "counter",
    expectedRevision: 1,
    value: { count: 1 },
  });
  expect(command).not.toHaveBeenCalledWith("report_generated_result", expect.anything());
  expect(command).not.toHaveBeenCalledWith("generate_widget", expect.anything());
  expect(screen.getByRole("button", { name: "한 단 더" })).toHaveProperty("disabled", true);
});

it("reloads a change received during interpretation and renders the latest source and state", async () => {
  const interpreter = deferred<WidgetResult>();
  const latest: GeneratedWidget = {
    ...READY,
    revision: 2,
    state: { count: 5 },
    definition: { ...READY.definition, source: "updated source" },
  };
  vi.mocked(runWidget).mockReturnValueOnce(interpreter.promise).mockResolvedValue(result(5));
  vi.mocked(command).mockResolvedValueOnce(READY).mockResolvedValue(latest);
  render(<GeneratedWidgetTool id="counter" />);
  await waitFor(() => expect(runWidget).toHaveBeenCalledTimes(1));
  act(changed);
  await act(async () => interpreter.resolve(result(0)));
  await waitFor(() =>
    expect(runWidget).toHaveBeenCalledWith(
      "updated source",
      { count: 5 },
      null,
      expect.any(Number),
      expect.any(AbortSignal),
    ),
  );
  expect(screen.getByText("5")).toBeTruthy();
  expect(writes()).toEqual([]);
});

it("keeps blurred inputs in order across a running tick and reload, without queuing ticks", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const tick = deferred<WidgetResult>();
  const reload = deferred<GeneratedWidget>();
  let stored = INPUT;
  vi.mocked(command).mockImplementation((name, args) => {
    if (name === "update_generated_state") {
      stored = {
        ...stored,
        revision: stored.revision + 1,
        state: (args as { value: GeneratedWidget["state"] }).value,
      };
      return Promise.resolve(stored);
    }
    return Promise.resolve(stored);
  });
  vi.mocked(runWidget)
    .mockResolvedValueOnce(inputResult("처음"))
    .mockReturnValueOnce(tick.promise)
    .mockResolvedValueOnce(inputResult("서버에서 읽음"))
    .mockResolvedValueOnce(inputResult("첫 편집"))
    .mockResolvedValueOnce(inputResult("둘째 편집"));
  render(<GeneratedWidgetTool id="counter" />);
  await screen.findByRole("textbox", { name: "메모" });
  act(() => vi.advanceTimersByTime(1000));
  edit("첫 편집");
  act(() => vi.advanceTimersByTime(2000));
  vi.mocked(command).mockReturnValueOnce(reload.promise);
  act(changed);
  await act(async () => tick.resolve(inputResult("처음")));
  edit("둘째 편집");
  expect(runWidget).toHaveBeenCalledTimes(2);
  stored = { ...INPUT, revision: 2, state: { value: "서버에서 읽음" } };
  await act(async () => reload.resolve(stored));
  await waitFor(() => expect(runWidget).toHaveBeenCalledTimes(5));
  expect(vi.mocked(runWidget).mock.calls.map((call) => [call[1], call[2]])).toEqual([
    [{ value: "처음" }, null],
    [{ value: "처음" }, { type: "tick" }],
    [{ value: "서버에서 읽음" }, null],
    [{ value: "서버에서 읽음" }, { type: "edit", value: "첫 편집" }],
    [{ value: "첫 편집" }, { type: "edit", value: "둘째 편집" }],
  ]);
  expect(screen.getByRole("textbox", { name: "메모" })).toHaveProperty("value", "둘째 편집");
});

it.each(["source change", "disable", "unmount"] as const)(
  "drops queued input after %s while a tick is running",
  async (boundary) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const tick = deferred<WidgetResult>();
    vi.mocked(command).mockResolvedValue(INPUT);
    vi.mocked(runWidget)
      .mockResolvedValueOnce(inputResult("처음"))
      .mockReturnValueOnce(tick.promise)
      .mockResolvedValue(inputResult("처음"));
    const rendered = render(<GeneratedWidgetTool id="counter" />);
    await screen.findByRole("textbox", { name: "메모" });
    act(() => vi.advanceTimersByTime(1000));
    edit("이전 입력");
    if (boundary === "unmount") {
      rendered.unmount();
    } else {
      vi.mocked(command).mockResolvedValue({
        ...INPUT,
        revision: 2,
        enabled: boundary !== "disable",
        definition: {
          ...INPUT.definition,
          source: boundary === "source change" ? "new source" : INPUT.definition.source,
        },
      });
      act(changed);
    }
    await act(async () => tick.resolve(inputResult("처음")));
    expect(runWidget).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ type: "edit" }),
      expect.anything(),
      expect.anything(),
    );
    expect(writes()).toEqual([]);
  },
);

it("discards queued inputs on storage failure and keeps them discarded after explicit retry", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const tick = deferred<WidgetResult>();
  vi.mocked(command).mockImplementation((name) =>
    name === "update_generated_state"
      ? Promise.reject(new Error("disk I/O error"))
      : Promise.resolve(INPUT),
  );
  vi.mocked(runWidget)
    .mockResolvedValueOnce(inputResult("처음"))
    .mockReturnValueOnce(tick.promise)
    .mockResolvedValue(inputResult("처음"));
  render(<GeneratedWidgetTool id="counter" />);
  await screen.findByRole("textbox", { name: "메모" });
  act(() => vi.advanceTimersByTime(1000));
  edit("저장 전 입력");
  await act(async () => tick.resolve(inputResult("주기 갱신")));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "disk I/O error");
  edit("실패 후 입력");
  act(() => vi.advanceTimersByTime(2000));
  expect(runWidget).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
  await waitFor(() => expect(runWidget).toHaveBeenCalledTimes(3));
  expect(vi.mocked(runWidget).mock.calls.map((call) => call[2])).toEqual([
    null,
    { type: "tick" },
    null,
  ]);
});

it.each(["tick", "input blur"] as const)(
  "preserves an input blur followed by a button click while %s is still executing",
  async (runningAction) => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const user = userEvent.setup();
    const pending = deferred<WidgetResult>();
    let stored: GeneratedWidget = { ...READY, state: { count: 0, value: "" } };
    function renderedState(count: number, value: string): WidgetResult {
      return {
        state: { count, value },
        view: [...result(count).view, { type: "input", label: "메모", value, action: "edit" }],
      };
    }
    vi.mocked(command).mockImplementation((name, args) => {
      if (name === "update_generated_state") {
        stored = {
          ...stored,
          revision: stored.revision + 1,
          state: (args as { value: GeneratedWidget["state"] }).value,
        };
      }
      return Promise.resolve(stored);
    });
    vi.mocked(runWidget)
      .mockResolvedValueOnce(renderedState(0, ""))
      .mockReturnValueOnce(pending.promise)
      .mockImplementation(async (_source, state, action) => {
        const before = state as { count: number; value: string };
        const input = action as { type: string; value?: string };
        return renderedState(
          before.count + (input.type === "increment" ? 1 : 0),
          input.type === "edit" ? (input.value ?? "") : before.value,
        );
      });
    render(<GeneratedWidgetTool id="counter" />);
    const input = await screen.findByRole("textbox", { name: "메모" });
    if (runningAction === "tick") act(() => vi.advanceTimersByTime(1000));
    await user.type(input, "남겨 둔 메모");
    const button = screen.getByRole("button", { name: "한 단 더" });
    expect(button).toHaveProperty("disabled", false);
    await user.click(button);
    expect(button).toHaveProperty("disabled", false);
    expect(runWidget).toHaveBeenCalledTimes(2);
    await act(async () =>
      pending.resolve(renderedState(0, runningAction === "tick" ? "" : "남겨 둔 메모")),
    );
    await waitFor(() => expect(stored.state).toEqual({ count: 1, value: "남겨 둔 메모" }));
    expect(vi.mocked(runWidget).mock.calls.map((call) => call[2])).toEqual([
      null,
      ...(runningAction === "tick" ? [{ type: "tick" }] : []),
      { type: "edit", value: "남겨 둔 메모" },
      { type: "increment" },
    ]);
    expect(screen.getByRole("textbox", { name: "메모" })).toHaveProperty("value", "남겨 둔 메모");
    expect(screen.getByText("1")).toBeTruthy();
  },
);
