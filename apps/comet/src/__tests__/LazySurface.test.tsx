import { lazy, useState, type ComponentType } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LazySurface } from "../components/LazySurface";

const close = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ close }) }));
vi.mock("../hooks/useSnapshot", () => ({ isDesktop: () => true, errorText: String }));
afterEach(() => {
  cleanup();
  close.mockClear();
});

function pendingSurface() {
  let resolve!: (value: { default: ComponentType }) => void;
  let reject!: (error: Error) => void;
  const load = vi.fn(
    () =>
      new Promise<{ default: ComponentType }>((yes, no) => {
        resolve = yes;
        reject = no;
      }),
  );
  return {
    Surface: lazy(load),
    load,
    resolve: (view: ComponentType) => resolve({ default: view }),
    reject: (error: Error) => reject(error),
  };
}

it("keeps the native close control usable during chunk loading", async () => {
  const { Surface } = pendingSurface();
  render(
    <LazySurface desktop title="설정">
      <Surface />
    </LazySurface>,
  );
  expect(screen.getByRole("status").textContent).toBe("…");
  fireEvent.click(screen.getByRole("button", { name: "창 닫기" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});

it("keeps rejected chunk loading closable instead of leaving a blank window", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const surface = pendingSurface();
  render(
    <LazySurface desktop title="설정">
      <surface.Surface />
    </LazySurface>,
  );
  await act(async () => surface.reject(new Error("chunk unavailable")));
  expect(screen.getByRole("alert").textContent).toContain("불러오지 못했어요");
  fireEvent.click(screen.getByRole("button", { name: "창 닫기" }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});

it("does not reload or remount a loaded draft on parent snapshot updates", async () => {
  const surface = pendingSurface();
  function Draft() {
    const [value, setValue] = useState("");
    return (
      <input
        aria-label="unsaved draft"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
    );
  }
  const { rerender } = render(
    <LazySurface desktop title="설정">
      <surface.Surface />
    </LazySurface>,
  );
  await act(async () => surface.resolve(Draft));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "not saved" } });
  rerender(
    <LazySurface desktop title="설정">
      <surface.Surface />
    </LazySurface>,
  );
  expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe("not saved");
  expect(surface.load).toHaveBeenCalledOnce();
});

it("loads the browser preview without offering a native close action", async () => {
  const surface = pendingSurface();
  render(
    <LazySurface>
      <surface.Surface />
    </LazySurface>,
  );
  expect(screen.queryByRole("button")).toBeNull();
  await act(async () => surface.resolve(() => <p>preview ready</p>));
  expect(screen.getByText("preview ready")).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
});
