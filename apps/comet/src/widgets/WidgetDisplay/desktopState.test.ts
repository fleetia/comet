import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { command } from "../../hooks/useSnapshot";
import { DEFAULT_LAYOUT, useDesktopState, type DesktopState, type LayoutSettings } from "./desktopState";

vi.mock("../../hooks/useSnapshot", () => ({
  isDesktop: () => true,
  command: vi.fn(),
  errorText: (cause: unknown) => String(cause),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => undefined),
  emit: vi.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  vi.mocked(command).mockReset();
});
afterEach(cleanup);

it("recalculates queued relative changes from the latest saved order", async () => {
  let saved: DesktopState = { ...DEFAULT_LAYOUT, revision: 1, editing: true, order: ["a", "b", "c"] };
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_widget_desktop") return saved;
    const input = args?.input as LayoutSettings;
    saved = { ...saved, ...input, revision: saved.revision + 1 };
    return saved;
  });
  const { result } = renderHook(useDesktopState);
  await waitFor(() => expect(result.current.state?.revision).toBe(1));
  const shift = (base: DesktopState): Partial<LayoutSettings> => {
    const order = [...base.order];
    const index = order.indexOf("a");
    [order[index], order[index + 1]] = [order[index + 1], order[index]];
    return { order };
  };
  await act(async () => {
    await Promise.all([result.current.configure(shift), result.current.configure(shift)]);
  });
  expect(saved.order).toEqual(["b", "c", "a"]);
  expect(result.current.state?.order).toEqual(["b", "c", "a"]);
});

it("recalculates relative changes when another window wins the revision", async () => {
  const initial: DesktopState = { ...DEFAULT_LAYOUT, revision: 1, editing: true, order: ["a", "b", "c"] };
  let saved = initial;
  let conflict = true;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_widget_desktop") return saved;
    if (conflict) {
      conflict = false;
      saved = { ...saved, revision: 2, order: ["c", "a", "b"] };
      throw new Error("conflict");
    }
    saved = { ...saved, ...(args?.input as LayoutSettings), revision: 3 };
    return saved;
  });
  const { result } = renderHook(useDesktopState);
  await waitFor(() => expect(result.current.state?.revision).toBe(1));
  await act(async () => {
    await result.current.configure((base) => ({ order: [...base.order.slice(1), base.order[0]] }));
  });
  expect(saved.order).toEqual(["a", "b", "c"]);
});

it("skips a relative change that becomes empty after a revision conflict", async () => {
  let saved: DesktopState = { ...DEFAULT_LAYOUT, revision: 1, editing: true, order: ["a", "b"] };
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_widget_desktop") return saved;
    saved = { ...saved, revision: 2, order: ["b", "a"] };
    throw new Error("conflict");
  });
  const { result } = renderHook(useDesktopState);
  await waitFor(() => expect(result.current.state?.revision).toBe(1));
  let response: DesktopState | null | undefined;
  await act(async () => {
    response = await result.current.configure((base) =>
      base.order[0] === "a" ? { order: ["b", "a"] } : {},
    );
  });
  expect(response).toBeNull();
  expect(result.current.state?.revision).toBe(2);
  expect(command).toHaveBeenCalledTimes(3);
});
