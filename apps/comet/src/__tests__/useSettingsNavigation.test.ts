import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { listen, type EventCallback } from "@tauri-apps/api/event";
import { StrictMode } from "react";
import { command } from "../hooks/useSnapshot";
import { trackSettingsView } from "../analytics";
import { useSettingsNavigation } from "../components/SettingsPanel/useSettingsNavigation";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../analytics", () => ({ trackSettingsView: vi.fn() }));
vi.mock("../hooks/useSnapshot", () => ({
  command: vi.fn(),
  isDesktop: () => true,
  errorText: (value: unknown) => String(value),
}));
let receive: EventCallback<string>;
const unlisten = vi.fn();
beforeEach(() => {
  vi.mocked(command).mockReset().mockResolvedValue(undefined);
  vi.mocked(trackSettingsView).mockClear();
  unlisten.mockClear();
  vi.mocked(listen).mockImplementation(async (_event, callback) => {
    receive = callback as EventCallback<string>;
    return unlisten;
  });
});
afterEach(cleanup);

it("restores a selected friend before the settings listener was registered", async () => {
  vi.mocked(command).mockImplementation(async (name) =>
    name === "get_settings_section" ? "characters" : { id: "builtin-b", requestId: "target-1" },
  );
  const { result } = renderHook(() => useSettingsNavigation("characters"));
  await waitFor(() => expect(result.current.characterRequest?.id).toBe("builtin-b"));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("ack_settings_character", { requestId: "target-1" }),
  );
  const request = result.current.characterRequest;
  act(() => receive({ event: "open-settings-section", id: 2, payload: "characters" }));
  await waitFor(() => expect(command).toHaveBeenCalledTimes(5));
  expect(result.current.characterRequest).toBe(request);
  act(() => result.current.navigate("model"));
  expect(result.current.characterRequest).toBeNull();
  act(() => receive({ event: "open-settings-section", id: 3, payload: "characters" }));
  await waitFor(() => expect(command).toHaveBeenCalledTimes(8));
  expect(result.current.characterRequest).toBeNull();
});

it("retires a late friend destination after manual navigation so generic reopen cannot replay it", async () => {
  type Request = { id: string; requestId: string };
  let pending: Request | null = { id: "builtin-b", requestId: "target-1" };
  let finish: (value: { id: string; requestId: string }) => void = () => {};
  let reads = 0;
  vi.mocked(command).mockImplementation((name, args) => {
    if (name === "get_settings_section") return Promise.resolve("characters");
    if (name === "get_settings_character") {
      reads += 1;
      return reads === 1
        ? new Promise<Request>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(pending);
    }
    if (name === "ack_settings_character" && args?.requestId === pending?.requestId) pending = null;
    return Promise.resolve();
  });
  const { result } = renderHook(() => useSettingsNavigation("characters"));
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_settings_character"));
  act(() => result.current.navigate("model"));
  await act(async () => finish({ id: "builtin-b", requestId: "target-1" }));
  expect(result.current.characterRequest).toBeNull();
  expect(result.current.section).toBe("model");
  expect(command).toHaveBeenCalledWith("ack_settings_character", { requestId: "target-1" });
  act(() => result.current.navigate("characters"));
  act(() => receive({ event: "open-settings-section", id: 2, payload: "characters" }));
  await waitFor(() => expect(reads).toBe(2));
  expect(result.current.characterRequest).toBeNull();
});

it("leaves a stale read unacknowledged when a newer native request followed manual navigation", async () => {
  type Request = { id: string; requestId: string };
  let finish: (value: Request) => void = () => {};
  let reads = 0;
  vi.mocked(command).mockImplementation((name) => {
    if (name === "get_settings_section") return Promise.resolve("characters");
    if (name === "get_settings_character") {
      reads += 1;
      return reads === 1
        ? new Promise<Request>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({ id: "builtin-a", requestId: "target-2" });
    }
    return Promise.resolve();
  });
  const { result } = renderHook(() => useSettingsNavigation("characters"));
  await waitFor(() => expect(reads).toBe(1));
  act(() => result.current.navigate("model"));
  act(() => receive({ event: "open-settings-section", id: 2, payload: "characters" }));
  await waitFor(() => expect(result.current.characterRequest?.id).toBe("builtin-a"));
  await act(async () => finish({ id: "builtin-b", requestId: "target-1" }));
  expect(result.current.characterRequest?.id).toBe("builtin-a");
  expect(command).not.toHaveBeenCalledWith("ack_settings_character", { requestId: "target-1" });
  expect(command).toHaveBeenCalledWith("ack_settings_character", { requestId: "target-2" });
});

it("does not acknowledge a pending destination from a disposed effect", async () => {
  type Request = { id: string; requestId: string };
  let finish: (value: Request) => void = () => {};
  vi.mocked(command).mockImplementation((name) => {
    if (name === "get_settings_section") return Promise.resolve("characters");
    if (name === "get_settings_character")
      return new Promise<Request>((resolve) => {
        finish = resolve;
      });
    return Promise.resolve();
  });
  const { result, unmount } = renderHook(() => useSettingsNavigation("characters"));
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_settings_character"));
  act(() => result.current.navigate("model"));
  unmount();
  await act(async () => finish({ id: "builtin-b", requestId: "target-1" }));
  expect(command).not.toHaveBeenCalledWith("ack_settings_character", expect.anything());
});

it.each([
  ["wordbook", "dialogue", "dialogue"],
  ["talk", "dialogue", "dialogue"],
  ["user", "user", "general"],
])(
  "opens %s as %s without discarding visited sections",
  async (legacy, section, persistedSection) => {
    vi.mocked(command).mockResolvedValue(legacy);
    const { result } = renderHook(() => useSettingsNavigation(legacy));
    expect(result.current.section).toBe(section);
    await waitFor(() => expect(command).toHaveBeenCalledWith("get_settings_section"));
    act(() => result.current.navigate("model"));
    act(() => receive({ event: "open-settings-section", id: 1, payload: legacy }));
    expect(result.current.section).toBe(section);
    act(() => result.current.navigate("characters"));
    act(() => result.current.navigate(legacy));
    expect(result.current.section).toBe(section);
    expect(command).toHaveBeenLastCalledWith("set_settings_section", {
      section: persistedSection,
    });
    expect([...result.current.visited]).toEqual([section, "model", "characters"]);
  },
);

it("recovers a destination requested before listener registration and keeps visited drafts mounted", async () => {
  vi.mocked(command).mockResolvedValue("widgets");
  const { result, unmount } = renderHook(() => useSettingsNavigation("characters"));
  await waitFor(() => expect(result.current.section).toBe("widgets"));
  act(() => result.current.navigate("model"));
  expect([...result.current.visited]).toEqual(["characters", "widgets", "model"]);
  unmount();
  expect(unlisten).toHaveBeenCalledOnce();
});

it.each(["event", "click"])(
  "does not let a late initial query overwrite a newer %s navigation",
  async (source) => {
    let finish: (value: string) => void = () => {};
    vi.mocked(command).mockImplementation((name) =>
      name === "get_settings_section"
        ? new Promise<string>((resolve) => {
            finish = resolve;
          })
        : Promise.resolve(),
    );
    const { result } = renderHook(() => useSettingsNavigation());
    await waitFor(() => expect(command).toHaveBeenCalledWith("get_settings_section"));
    act(() => {
      if (source === "event")
        receive({ event: "open-settings-section", id: 1, payload: "widgets" });
      else result.current.navigate("widgets");
    });
    await act(async () => finish("characters"));
    expect(result.current.section).toBe("widgets");
    act(() => receive({ event: "open-settings-section", id: 2, payload: "updates" }));
    expect(result.current.section).toBe("general");
  },
);

it("falls back for unknown destinations and exposes listener failure without losing navigation", async () => {
  vi.mocked(listen).mockRejectedValueOnce(new Error("listener failed"));
  const { result } = renderHook(() => useSettingsNavigation("missing"));
  await waitFor(() => expect(result.current.navigationError).toContain("listener failed"));
  expect(result.current.section).toBe("characters");
  act(() => result.current.navigate("characters"));
  act(() => result.current.navigate("missing"));
  expect(result.current.section).toBe("characters");
});

it("tracks the displayed section on initial entry, UI aliases and native navigation without StrictMode duplicates", async () => {
  vi.mocked(command).mockResolvedValue("desktop");
  const { result, rerender } = renderHook(() => useSettingsNavigation("desktop"), {
    wrapper: StrictMode,
  });
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_settings_section"));
  expect(trackSettingsView).toHaveBeenCalledExactlyOnceWith("desktop");

  act(() => result.current.navigate("user"));
  expect(command).toHaveBeenLastCalledWith("set_settings_section", { section: "general" });
  expect(result.current.section).toBe("user");
  expect(trackSettingsView).toHaveBeenLastCalledWith("user");
  act(() => result.current.navigate("organizer"));
  expect(command).toHaveBeenLastCalledWith("set_settings_section", { section: "general" });
  expect(trackSettingsView).toHaveBeenLastCalledWith("organizer");

  act(() => receive({ event: "open-settings-section", id: 1, payload: "memory" }));
  expect(result.current.section).toBe("characters");
  expect(trackSettingsView).toHaveBeenLastCalledWith("characters");
  act(() => receive({ event: "open-settings-section", id: 2, payload: "memory" }));
  rerender();
  expect(vi.mocked(trackSettingsView).mock.calls.map(([section]) => section)).toEqual([
    "desktop",
    "user",
    "organizer",
    "characters",
  ]);
});
