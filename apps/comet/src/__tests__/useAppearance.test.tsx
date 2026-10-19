import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen, type Event } from "@tauri-apps/api/event";
import type { Appearance } from "../types";
import { DEFAULT_APPEARANCE } from "../appearance";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true, invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));

let broadcast: (event: Event<Appearance>) => void = () => {};
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  vi.mocked(listen).mockImplementation(async (_name, callback) => {
    broadcast = callback as typeof broadcast;
    return () => {};
  });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

async function load(): Promise<typeof import("../hooks/useAppearance")> {
  return import("../hooks/useAppearance");
}

it("saves one edit at a time, keeps only the latest queued edit, and ignores older broadcasts", async () => {
  const saves: Array<(value: Appearance) => void> = [];
  vi.mocked(invoke).mockImplementation((name) =>
    name === "get_appearance"
      ? Promise.resolve({ ...DEFAULT_APPEARANCE, revision: 4 })
      : new Promise((resolve) => saves.push(resolve)),
  );
  const { useAppearance, updateAppearance } = await load();
  const { result } = renderHook(useAppearance);
  await waitFor(() => expect(result.current.appearance.revision).toBe(4));

  act(() => updateAppearance({ ...result.current.appearance, skin: "paper" }));
  act(() => updateAppearance({ ...result.current.appearance, skin: "play" }));
  act(() => updateAppearance({ ...result.current.appearance, balloonOpacity: 60 }));
  expect(result.current.appearance).toMatchObject({ skin: "play", balloonOpacity: 60 });
  act(() =>
    broadcast({ event: "appearance", id: 1, payload: { ...DEFAULT_APPEARANCE, revision: 4 } }),
  );
  expect(result.current.appearance.skin).toBe("play");

  await act(async () => saves[0]({ ...DEFAULT_APPEARANCE, skin: "paper", revision: 5 }));
  const sent = vi.mocked(invoke).mock.calls.filter(([name]) => name === "save_appearance");
  expect(sent).toHaveLength(2);
  expect(sent[1][1]).toMatchObject({ appearance: { skin: "play", balloonOpacity: 60 } });
  expect(result.current.appearance).toMatchObject({ skin: "play", revision: 5 });

  await act(async () =>
    saves[1]({ ...DEFAULT_APPEARANCE, skin: "play", balloonOpacity: 60, revision: 6 }),
  );
  expect(result.current.appearance).toMatchObject({ skin: "play", balloonOpacity: 60, revision: 6 });
  act(() =>
    broadcast({ event: "appearance", id: 2, payload: { ...DEFAULT_APPEARANCE, revision: 5 } }),
  );
  expect(result.current.appearance.revision).toBe(6);
});

it("shows a failed save and returns to the saved appearance", async () => {
  vi.mocked(invoke).mockImplementation((name) =>
    name === "save_appearance"
      ? Promise.reject(new Error("투명도는 20~100% 사이로 정해 주세요."))
      : Promise.resolve({ ...DEFAULT_APPEARANCE, skin: "paper", revision: 2 }),
  );
  const { useAppearance, updateAppearance } = await load();
  const { result } = renderHook(useAppearance);
  await waitFor(() => expect(result.current.appearance.skin).toBe("paper"));
  await act(async () => updateAppearance({ ...result.current.appearance, balloonOpacity: 5 }));
  await waitFor(() => expect(result.current.error).toBe("투명도는 20~100% 사이로 정해 주세요."));
  expect(result.current.appearance).toMatchObject({ skin: "paper", balloonOpacity: 100 });
});
