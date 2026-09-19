import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { App } from "../App";
import { PREVIEW_SNAPSHOT, useSnapshot } from "../hooks/useSnapshot";

const close = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ close }) }));
vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  useSnapshot: vi.fn(),
  isDesktop: () => true,
}));
beforeEach(() => close.mockReset().mockResolvedValue(undefined));
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

it.each([
  ["settings", "설정 닫기"],
  ["characters", "캐릭터 관리 닫기"],
])("keeps %s closable during loading, failure, and loaded content", async (view, label) => {
  window.history.replaceState(null, "", `/?view=${view}`);
  const reload = vi.fn();
  vi.mocked(useSnapshot).mockReturnValue({ snapshot: null, error: null, reload });
  const { rerender } = render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "창 닫기" }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
  vi.mocked(useSnapshot).mockReturnValue({ snapshot: null, error: "읽기 실패", reload });
  rerender(<App />);
  fireEvent.click(screen.getByRole("button", { name: "창 닫기" }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(2));
  vi.mocked(useSnapshot).mockReturnValue({ snapshot: PREVIEW_SNAPSHOT, error: null, reload });
  rerender(<App />);
  fireEvent.click(screen.getByRole("button", { name: label }));
  await waitFor(() => expect(close).toHaveBeenCalledTimes(3));
});
