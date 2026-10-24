import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { command } from "../hooks/useSnapshot";
import { PlanningWindow } from "./PlanningWindow";
import { DiaryNoteDetail } from "../widgets/Planner/DiaryNoteDetail";

const native = vi.hoisted(() => ({ destroy: vi.fn(), onCloseRequested: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("../hooks/useSnapshot", () => ({
  command: vi.fn(),
  isDesktop: () => true,
  errorText: String,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
let receive: (event: { payload: { label: string; generation: number; active: boolean } }) => void;
const cleanupEditor = vi.fn();
const save = vi.fn().mockResolvedValue(true);

beforeEach(() => {
  vi.clearAllMocks();
  native.destroy.mockResolvedValue(undefined);
  native.onCloseRequested.mockResolvedValue(() => undefined);
  localStorage.clear();
  vi.mocked(listen).mockImplementation(async (_name, handler) => {
    receive = handler as typeof receive;
    return vi.fn<() => void>();
  });
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_planning_window_state") return { generation: 1, active: true } as never;
    if (name === "release_planning_window") {
      expect(cleanupEditor).toHaveBeenCalled();
      return { generation: (args as { generation: number }).generation, active: false } as never;
    }
    return undefined as never;
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Editor({ close }: { close: () => void }) {
  const [draft, setDraft] = useState("");
  const [confirm, setConfirm] = useState(false);
  useEffect(() => () => cleanupEditor(), []);
  return (
    <>
      <input aria-label="draft" value={draft} onChange={(e) => setDraft(e.target.value)} />
      <button onClick={() => (draft ? setConfirm(true) : close())}>close</button>
      {confirm && (
        <>
          <button onClick={() => setConfirm(false)}>keep</button>
          <button onClick={close}>discard</button>
        </>
      )}
    </>
  );
}
const fixture = () => (
  <PlanningWindow label="planner">{(close) => <Editor close={close} />}</PlanningWindow>
);
async function state(generation: number, active = true) {
  await act(async () => receive({ payload: { label: "planner", generation, active } }));
}

it("keeps active drafts on navigation and cancel, then unmounts before release and remounts on reopen", async () => {
  render(fixture());
  const input = await screen.findByLabelText("draft");
  fireEvent.change(input, { target: { value: "unsaved" } });
  await state(2);
  expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("unsaved");
  fireEvent.click(screen.getByText("close"));
  fireEvent.click(screen.getByText("keep"));
  expect(cleanupEditor).not.toHaveBeenCalled();
  expect(command).not.toHaveBeenCalledWith("release_planning_window", expect.anything());
  fireEvent.click(screen.getByText("close"));
  fireEvent.click(screen.getByText("discard"));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("release_planning_window", { generation: 2 }),
  );
  expect(screen.queryByLabelText("draft")).toBeNull();
  await state(3);
  expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("");
  for (let generation = 4; generation <= 7; generation++) {
    fireEvent.click(screen.getByText("close"));
    await waitFor(() => expect(screen.queryByLabelText("draft")).toBeNull());
    await state(generation);
    expect(screen.getByLabelText("draft")).toBeTruthy();
  }
});

it("does not let delayed release hide a newer open", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(command).mockImplementation((name) =>
    name === "get_planning_window_state"
      ? Promise.resolve({ generation: 1, active: true } as never)
      : new Promise((resolve) => {
          finish = resolve;
        }),
  );
  render(fixture());
  await screen.findByLabelText("draft");
  fireEvent.click(screen.getByText("close"));
  await state(2);
  fireEvent.change(screen.getByLabelText("draft"), { target: { value: "new" } });
  await act(async () => finish({ generation: 1, active: false }));
  expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("new");
});

it("ignores initial hydration after receiving a newer open event", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(command).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(fixture());
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_planning_window_state"));
  await state(3);
  fireEvent.change(screen.getByLabelText("draft"), { target: { value: "latest" } });
  await act(async () => finish({ generation: 1, active: false }));
  expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("latest");
});

it("cleans up a real note autosave timer while preserving its recoverable local draft", async () => {
  render(
    <PlanningWindow label="planner">
      {(close) => (
        <>
          <Editor close={close} />
          <DiaryNoteDetail
            id="note"
            note={{ title: "Saved", body: "original" }}
            storageKey="reuse-note"
            busy={false}
            onSave={save}
            onDelete={vi.fn()}
            onDirtyChange={vi.fn()}
          />
        </>
      )}
    </PlanningWindow>,
  );
  await screen.findByLabelText("메모 내용");
  vi.useFakeTimers();
  fireEvent.change(screen.getByLabelText("메모 내용"), { target: { value: "recoverable draft" } });
  fireEvent.click(screen.getByText("close"));
  await act(async () => {
    await Promise.resolve();
    vi.advanceTimersByTime(1000);
  });
  expect(save).not.toHaveBeenCalled();
  expect(localStorage.getItem("reuse-note")).toContain("recoverable draft");
  await state(2);
  expect((screen.getByLabelText("메모 내용") as HTMLTextAreaElement).value).toBe(
    "recoverable draft",
  );
});

it("restores a usable editor and reports a failed native release", async () => {
  vi.mocked(command).mockImplementation((name) =>
    name === "get_planning_window_state"
      ? Promise.resolve({ generation: 1, active: true } as never)
      : Promise.reject(new Error("hide failed")),
  );
  render(fixture());
  await screen.findByLabelText("draft");
  fireEvent.click(screen.getByText("close"));
  await screen.findByRole("alert");
  expect(screen.getByLabelText("draft")).toBeTruthy();
});

it("ignores an old release response containing the new generation after a second close", async () => {
  const releases = new Map<number, (value: unknown) => void>();
  vi.mocked(command).mockImplementation((name, args) =>
    name === "get_planning_window_state"
      ? Promise.resolve({ generation: 1, active: true } as never)
      : new Promise((resolve) => {
          releases.set(args?.generation as number, resolve);
        }),
  );
  render(fixture());
  await screen.findByLabelText("draft");
  fireEvent.click(screen.getByText("close"));
  await state(2);
  fireEvent.click(screen.getByText("close"));
  await act(async () => releases.get(2)!({ generation: 2, active: false }));
  await act(async () => releases.get(1)!({ generation: 2, active: true }));
  await state(2, true);
  expect(screen.queryByLabelText("draft")).toBeNull();
  await state(3);
  expect(screen.getByLabelText("draft")).toBeTruthy();
});

it("keeps a second planning window mounted when another window closes or reopens", async () => {
  const listeners: Array<
    (event: { payload: { label: string; generation: number; active: boolean } }) => void
  > = [];
  vi.mocked(listen).mockImplementation(async (_name, handler) => {
    listeners.push(handler as (typeof listeners)[number]);
    return () => undefined;
  });
  render(
    <>
      <PlanningWindow label="planner">
        {() => <input aria-label="planner draft" defaultValue="keep diary draft" />}
      </PlanningWindow>
      <PlanningWindow label="travel">
        {() => <input aria-label="travel draft" defaultValue="trip draft" />}
      </PlanningWindow>
    </>,
  );
  const diary = await screen.findByLabelText("planner draft");
  await screen.findByLabelText("travel draft");
  await act(async () =>
    listeners.forEach((handler) =>
      handler({ payload: { label: "travel", generation: 1, active: false } }),
    ),
  );
  expect(screen.getByLabelText("planner draft")).toBe(diary);
  expect((diary as HTMLInputElement).value).toBe("keep diary draft");
  expect(screen.queryByLabelText("travel draft")).toBeNull();
  await act(async () =>
    listeners.forEach((handler) =>
      handler({ payload: { label: "travel", generation: 2, active: true } }),
    ),
  );
  expect(screen.getByLabelText("planner draft")).toBe(diary);
  expect(screen.getByLabelText("travel draft")).toBeTruthy();
  await act(async () =>
    listeners.forEach((handler) =>
      handler({ payload: { label: "planner", generation: 1, active: false } }),
    ),
  );
  expect(screen.queryByLabelText("planner draft")).toBeNull();
  expect(screen.getByLabelText("travel draft")).toBeTruthy();
  expect(listen).toHaveBeenCalledWith("planning-window-state", expect.any(Function), {
    target: { kind: "WebviewWindow", label: "planner" },
  });
  expect(listen).toHaveBeenCalledWith("planning-window-state", expect.any(Function), {
    target: { kind: "WebviewWindow", label: "travel" },
  });
});

it("does not let another window's early event suppress its own startup hydration", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(command).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(fixture());
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_planning_window_state"));
  await act(async () => receive({ payload: { label: "travel", generation: 8, active: false } }));
  await act(async () => finish({ generation: 1, active: true }));
  expect(screen.getByLabelText("draft")).toBeTruthy();
});

async function nativeClose(): Promise<void> {
  for (const [handler] of native.onCloseRequested.mock.calls) {
    const event = { preventDefault: vi.fn() };
    await handler(event);
    // Match Tauri's onCloseRequested wrapper, including its default destroy.
    if (!event.preventDefault.mock.calls.length) await native.destroy();
  }
}

it.each(["listener", "state getter"])(
  "allows native close after startup %s failure",
  async (failure) => {
    if (failure === "listener") {
      vi.mocked(listen).mockRejectedValueOnce(new Error("listener unavailable"));
    } else {
      vi.mocked(command).mockRejectedValueOnce(new Error("state unavailable"));
    }
    render(fixture());
    await screen.findByRole("alert");
    await nativeClose();
    expect(native.destroy).toHaveBeenCalledOnce();
    expect(screen.queryByLabelText("draft")).toBeNull();
    expect(command).not.toHaveBeenCalledWith("release_planning_window", expect.anything());
  },
);

it("prevents default destroy in a startup close callback retained after unmount", async () => {
  const view = render(fixture());
  await screen.findByLabelText("draft");
  view.unmount();
  await nativeClose();
  expect(native.destroy).not.toHaveBeenCalled();
});

it("preserves an editor opened by a newer event when startup hydration later fails", async () => {
  let reject!: (cause: unknown) => void;
  vi.mocked(command).mockImplementationOnce(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  render(fixture());
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_planning_window_state"));
  await state(2);
  fireEvent.change(screen.getByLabelText("draft"), { target: { value: "keep draft" } });
  await act(async () => reject(new Error("old hydration failed")));
  await nativeClose();
  expect(native.destroy).not.toHaveBeenCalled();
  expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("keep draft");
  fireEvent.click(screen.getByText("close"));
  fireEvent.click(screen.getByText("keep"));
  expect(command).not.toHaveBeenCalledWith("release_planning_window", expect.anything());
  expect((screen.getByLabelText("draft") as HTMLInputElement).value).toBe("keep draft");
});
