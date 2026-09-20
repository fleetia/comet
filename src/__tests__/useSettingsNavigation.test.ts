import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { listen, type EventCallback } from "@tauri-apps/api/event";
import { command } from "../hooks/useSnapshot";
import { useSettingsNavigation } from "../components/SettingsPanel/useSettingsNavigation";

vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../hooks/useSnapshot", () => ({
  command: vi.fn(),
  isDesktop: () => true,
  errorText: (value: unknown) => String(value),
}));
let receive: EventCallback<string>;
const unlisten = vi.fn();
beforeEach(() => {
  vi.mocked(command).mockReset().mockResolvedValue(undefined);
  unlisten.mockClear();
  vi.mocked(listen).mockImplementation(async (_event, callback) => {
    receive = callback as EventCallback<string>;
    return unlisten;
  });
});
afterEach(cleanup);

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
