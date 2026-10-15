import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AutostartSettings } from "../components/AutostartSettings/AutostartSettings";
import { command, isDesktop } from "../hooks/useSnapshot";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(() => true),
}));

afterEach(cleanup);
beforeEach(() => {
  vi.mocked(command).mockReset();
  vi.mocked(isDesktop).mockReturnValue(true);
});

it("waits for OS state without registering on mount and only updates after a successful change", async () => {
  let finishRead: (value: boolean) => void = () => {};
  let finishWrite: (value: boolean) => void = () => {};
  vi.mocked(command).mockImplementation(
    (name) =>
      new Promise((resolve) => {
        if (name === "get_autostart_enabled") finishRead = resolve;
        else finishWrite = resolve;
      }),
  );
  render(<AutostartSettings active />);
  const toggle = screen.getByRole("checkbox", { name: "컴퓨터 로그인 시 자동 실행" });
  expect(toggle).toHaveProperty("disabled", true);
  expect(command).toHaveBeenCalledTimes(1);
  expect(command).toHaveBeenCalledWith("get_autostart_enabled");
  await act(async () => finishRead(false));
  fireEvent.click(toggle);
  expect(command).toHaveBeenLastCalledWith("set_autostart_enabled", { enabled: true });
  expect(toggle).toHaveProperty("checked", false);
  expect(toggle).toHaveProperty("disabled", true);
  fireEvent.focus(window);
  expect(command).toHaveBeenCalledTimes(2);
  await act(async () => finishWrite(true));
  expect(toggle).toHaveProperty("checked", true);
  fireEvent.click(toggle);
  expect(command).toHaveBeenLastCalledWith("set_autostart_enabled", { enabled: false });
  await act(async () => finishWrite(false));
  expect(toggle).toHaveProperty("checked", false);
});

it("keeps failed reads unavailable and allows an explicit retry", async () => {
  vi.mocked(command).mockRejectedValueOnce(new Error("등록 상태를 읽지 못했어요."));
  render(<AutostartSettings active />);
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "등록 상태를 읽지 못했어요.",
  );
  expect(screen.getByRole("checkbox")).toHaveProperty("disabled", true);
  vi.mocked(command).mockResolvedValueOnce(true);
  fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
  await waitFor(() => expect(screen.getByRole("checkbox")).toHaveProperty("checked", true));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("reports registration failures and reads actual state before another change", async () => {
  vi.mocked(command).mockResolvedValueOnce(false).mockRejectedValueOnce(new Error("등록 실패"));
  render(<AutostartSettings active />);
  await waitFor(() => expect(screen.getByRole("checkbox")).toHaveProperty("disabled", false));
  fireEvent.click(screen.getByRole("checkbox"));
  await screen.findByText("등록 실패");
  expect(screen.getByRole("checkbox")).toHaveProperty("checked", false);
  expect(screen.getByRole("checkbox")).toHaveProperty("disabled", true);
  vi.mocked(command).mockResolvedValueOnce(true);
  fireEvent.click(screen.getByRole("button", { name: "다시 확인" }));
  await waitFor(() => expect(screen.getByRole("checkbox")).toHaveProperty("checked", true));
  expect(command).toHaveBeenLastCalledWith("get_autostart_enabled");
});

it("refreshes external changes on focus and returning to general settings", async () => {
  vi.mocked(command).mockResolvedValue(false);
  const { rerender } = render(<AutostartSettings active />);
  await waitFor(() => expect(screen.getByRole("checkbox")).toHaveProperty("disabled", false));
  vi.mocked(command).mockResolvedValueOnce(true);
  fireEvent.focus(window);
  await waitFor(() => expect(screen.getByRole("checkbox")).toHaveProperty("checked", true));
  rerender(<AutostartSettings active={false} />);
  fireEvent.focus(window);
  expect(command).toHaveBeenCalledTimes(2);
  rerender(<AutostartSettings active />);
  await waitFor(() => expect(screen.getByRole("checkbox")).toHaveProperty("checked", false));
  expect(command).toHaveBeenCalledTimes(3);
});

it("does not register or query startup from the browser preview", () => {
  vi.mocked(isDesktop).mockReturnValue(false);
  render(<AutostartSettings active />);
  expect(screen.getByRole("checkbox")).toHaveProperty("disabled", true);
  expect(command).not.toHaveBeenCalled();
});
