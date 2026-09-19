import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UpdatePanel } from "../components/UpdatePanel";
import { command } from "../hooks/useSnapshot";

vi.mock("../hooks/useSnapshot", () => ({
  command: vi.fn(),
  isDesktop: () => true,
  errorText: (error: unknown): string => String(error),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

const available = {
  phase: "available",
  version: "0.4.1",
  notes: "작은 오류를 고쳤어요.",
  downloaded: 0,
  total: null,
  message: null,
};

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(command).mockReset();
  vi.mocked(command).mockImplementation(async (name) =>
    name === "install_app_update" ? undefined : available,
  );
});

it("shows an automatic discovery without installing until the user approves its version", async () => {
  render(<UpdatePanel />);
  const install = await screen.findByRole("button", { name: "설치하고 다시 시작" });
  expect(command).not.toHaveBeenCalledWith("install_app_update", expect.anything());
  fireEvent.click(install);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("install_app_update", { version: "0.4.1" }),
  );
});

it("keeps a failed check visible and permits a later manual retry", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "check_app_update") throw new Error("업데이트 서버에 연결하지 못했어요.");
    return { ...available, phase: "idle", version: null, notes: null };
  });
  render(<UpdatePanel />);
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_update_status"));
  fireEvent.click(screen.getByRole("button", { name: "업데이트 확인" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "Error: 업데이트 서버에 연결하지 못했어요.",
  );
  expect(screen.getByRole("button", { name: "업데이트 확인" })).toHaveProperty("disabled", false);
  expect(screen.queryByRole("button", { name: "설치하고 다시 시작" })).toBeNull();
});
