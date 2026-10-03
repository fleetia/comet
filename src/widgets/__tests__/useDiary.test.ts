import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { listen, type Event } from "@tauri-apps/api/event";
import { command } from "../../hooks/useSnapshot";
import { useDiary } from "../Planner/useDiary";
import type { DiaryState } from "../Planner/diaryTypes";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
const state = (revision: number): DiaryState => ({ revision, pages: [], notes: [], moves: [] });
let receive: ((event: Event<DiaryState>) => void) | undefined;
const unlisten = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listen).mockImplementation(async (_name, callback) => {
    receive = callback;
    return unlisten;
  });
});
afterEach(cleanup);

it("keeps a newer published revision when the initial read arrives late", async () => {
  let resolveInitial: ((value: DiaryState) => void) | undefined;
  vi.mocked(command).mockReturnValue(
    new Promise<DiaryState>((resolve) => {
      resolveInitial = resolve;
    }),
  );
  const { result, unmount } = renderHook(useDiary);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_diary"));
  act(() => receive?.({ event: "diary-updated", id: 1, payload: state(4) }));
  await act(async () => resolveInitial?.(state(1)));
  expect(result.current.state?.revision).toBe(4);
  unmount();
  expect(unlisten).toHaveBeenCalledOnce();
});

it("serializes edits against the revision returned by the preceding save", async () => {
  const revisions: unknown[] = [];
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_diary") return state(3);
    revisions.push(args?.expectedRevision);
    return state(revisions.length + 3);
  });
  const { result } = renderHook(useDiary);
  await waitFor(() => expect(result.current.state?.revision).toBe(3));
  await act(async () => {
    await Promise.all([
      result.current.mutate("note-create", { title: "하나" }),
      result.current.mutate("note-create", { title: "둘" }),
    ]);
  });
  expect(revisions).toEqual([3, 4]);
  expect(result.current.state?.revision).toBe(5);
  expect(result.current.busy).toBe(false);
});

it("reloads after conflict without retrying or reporting a failed edit as saved", async () => {
  let reads = 0;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_diary") return state(++reads === 1 ? 1 : 2);
    throw new Error("다른 화면에서 바뀌었어요");
  });
  const { result } = renderHook(useDiary);
  await waitFor(() => expect(result.current.state?.revision).toBe(1));
  let saved: DiaryState | null | undefined;
  await act(async () => {
    saved = await result.current.mutate("entry-update", { text: "초안" });
  });
  expect(saved).toBeNull();
  expect(result.current.state?.revision).toBe(2);
  expect(result.current.error).toContain("다른 화면");
  expect(vi.mocked(command).mock.calls.filter(([name]) => name === "update_diary")).toHaveLength(1);
});
