import { afterEach, expect, it, vi } from "vitest";
import {
  act as reactAct,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { FocusSettingsPreview } from "./FocusSettingsPreview";
import type { ToolAction } from "../toolData";
import type { WidgetView } from "../types";

const timer: WidgetView = {
  id: "focus",
  kind: "focus-timer",
  installed: true,
  enabled: true,
  revision: 1,
  version: 1,
  data: { mode: "rest", status: "running", durationMs: 300000, focusDurationMs: 1800000 },
  error: null,
  missing: [],
  status: "enabled",
  packageBytes: 1,
};
afterEach(cleanup);

it("previews the default focus duration during rest and saves shape against the latest snapshot", async () => {
  const act = vi.fn<ToolAction>().mockResolvedValue(true);
  const view = render(<FocusSettingsPreview widget={timer} act={act} />);
  expect(screen.getByRole("timer").textContent).toBe("30:00");
  expect(screen.queryByRole("button", { name: /시작/ })).toBeNull();
  const updated = {
    ...timer,
    revision: 2,
    data: { ...(timer.data as object), focusDurationMs: 2700000 },
  };
  view.rerender(<FocusSettingsPreview widget={updated} act={act} />);
  expect(screen.getByRole("timer").textContent).toBe("45:00");
  fireEvent.click(screen.getByRole("radio", { name: "숫자만" }));
  await waitFor(() =>
    expect(act).toHaveBeenCalledExactlyOnceWith("configure", { presentation: "digits" }, updated),
  );
  expect(screen.getByRole("radio", { name: "숫자만" })).toHaveProperty("checked", true);
});

it("locks shape while saving, releases its manager lock, and preserves the saved shape on failure", async () => {
  let reject!: (cause: unknown) => void;
  const act = vi.fn<ToolAction>().mockImplementation(
    () =>
      new Promise((_, no) => {
        reject = no;
      }),
  );
  const onBusyChange = vi.fn();
  render(<FocusSettingsPreview widget={timer} act={act} onBusyChange={onBusyChange} />);
  fireEvent.click(screen.getByRole("radio", { name: "숫자만" }));
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole("radio", { name: "고리" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("radio", { name: "고리" }));
  expect(act).toHaveBeenCalledTimes(1);
  await reactAct(async () => reject("저장 실패"));
  expect(screen.getByRole("alert").textContent).toContain("저장 실패");
  expect(screen.getByRole("radio", { name: "고리" })).toHaveProperty("checked", true);
  expect(screen.getByRole("radio", { name: "고리" })).toHaveProperty("disabled", false);
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
});

it("does not change a disabled preview", () => {
  const act = vi.fn<ToolAction>();
  render(<FocusSettingsPreview widget={timer} act={act} disabled />);
  fireEvent.click(screen.getByRole("radio", { name: "숫자만" }));
  expect(act).not.toHaveBeenCalled();
});
