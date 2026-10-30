import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NameRegistration } from "../components/Balloon/NameRegistration";
import type { Dispatch } from "../types";

afterEach(cleanup);

it("keeps a failed first-registration draft and uses only the registration command", async () => {
  const dispatch: Dispatch = vi.fn().mockRejectedValueOnce(new Error("저장 실패"));
  render(<NameRegistration greeting="안녕! 만나서 반가워." dispatch={dispatch} />);
  expect(screen.queryByRole("checkbox")).toBeNull();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "  민수  " } });
  fireEvent.click(screen.getByRole("button", { name: "이름 알려주기" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "저장 실패");
  expect(screen.getByRole("textbox")).toHaveProperty("value", "  민수  ");
  expect(dispatch).toHaveBeenCalledWith("register_user_profile", { name: "민수", birthday: null });
  fireEvent.click(screen.getByRole("button", { name: "이름 알려주기" }));
  await waitFor(() => expect(dispatch).toHaveBeenCalledTimes(2));
  expect(dispatch).not.toHaveBeenCalledWith("open_settings");
});

it("registers without a consent choice while preserving Unicode and composition validation", async () => {
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
    expect(dispatch).toHaveBeenCalledWith("register_user_profile", { name: "🌟".repeat(40), birthday: null }),
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

it("orders birthday fields as year, month, day", () => {
  render(<NameRegistration greeting="안녕!" dispatch={vi.fn()} />);
  const [year, month, day] = screen.getAllByRole("combobox");
  expect(year).toBe(screen.getByRole("combobox", { name: "연도 (선택)" }));
  expect(month).toBe(screen.getByRole("combobox", { name: "월" }));
  expect(day).toBe(screen.getByRole("combobox", { name: "일" }));
});

it("registers a selected birthday with the name", async () => {
  const dispatch: Dispatch = vi.fn().mockResolvedValue(undefined);
  render(<NameRegistration greeting="안녕!" dispatch={dispatch} />);
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "친구" } });
  fireEvent.change(screen.getByRole("combobox", { name: "월" }), { target: { value: "2" } });
  fireEvent.change(screen.getByRole("combobox", { name: "일" }), { target: { value: "29" } });
  fireEvent.click(screen.getByRole("button", { name: "이름 알려주기" }));
  await waitFor(() =>
    expect(dispatch).toHaveBeenCalledWith("register_user_profile", {
      name: "친구",
      birthday: { month: 2, day: 29, year: null },
    }),
  );
});
