import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NameRegistration } from "../components/Balloon/NameRegistration";
import type { Dispatch } from "../types";

afterEach(cleanup);

it("keeps a failed first-registration draft and uses only the registration command", async () => {
  const dispatch: Dispatch = vi.fn().mockRejectedValueOnce(new Error("저장 실패"));
  render(<NameRegistration greeting="안녕! 만나서 반가워." dispatch={dispatch} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "  민수  " } });
  fireEvent.click(screen.getByRole("button", { name: "이름 알려주기" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "저장 실패");
  expect(screen.getByRole("textbox")).toHaveProperty("value", "  민수  ");
  expect(dispatch).toHaveBeenCalledWith("register_user_name", { name: "민수" });
  fireEvent.click(screen.getByRole("button", { name: "이름 알려주기" }));
  await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
  expect(dispatch).not.toHaveBeenCalledWith("open_settings");
});

it("counts Unicode characters and suppresses submission while Korean composition is active", async () => {
  const dispatch: Dispatch = vi.fn().mockResolvedValue(undefined);
  render(<NameRegistration greeting="안녕!" dispatch={dispatch} />);
  const field = screen.getByRole("textbox");
  const button = screen.getByRole("button", { name: "이름 알려주기" });
  fireEvent.change(field, { target: { value: "🌟".repeat(41) } });
  expect(button).toHaveProperty("disabled", true);
  fireEvent.change(field, { target: { value: "🌟".repeat(40) } });
  expect(button).toHaveProperty("disabled", false);
  fireEvent.compositionStart(field);
  fireEvent.keyDown(field, { key: "Enter", keyCode: 229, isComposing: true });
  fireEvent.submit(screen.getByRole("form", { name: "이름 알려주기" }));
  expect(dispatch).not.toHaveBeenCalled();
  fireEvent.compositionEnd(field);
  fireEvent.submit(screen.getByRole("form", { name: "이름 알려주기" }));
  await waitFor(() =>
    expect(dispatch).toHaveBeenCalledWith("register_user_name", { name: "🌟".repeat(40) }),
  );
});

it("prevents duplicate registrations while the save is pending", async () => {
  const dispatch: Dispatch = vi.fn(() => new Promise<void>(() => {}));
  render(<NameRegistration greeting="안녕!" dispatch={dispatch} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "친구" } });
  const form = screen.getByRole("form", { name: "이름 알려주기" });
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(dispatch).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("textbox")).toHaveProperty("disabled", true);
});
