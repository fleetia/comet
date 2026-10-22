import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { App } from "../App";

vi.mock("@tauri-apps/api/core", async (load) => ({
  ...(await load<typeof import("@tauri-apps/api/core")>()),
  isTauri: () => true,
  invoke: vi.fn(async () => false),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => vi.fn()) }));
vi.mock("../analytics", () => ({
  updateAnalyticsConsent: vi.fn(),
  trackSuccessfulCommand: vi.fn(),
  trackCommandFailure: vi.fn(),
}));
vi.mock("../widgets/GeneratedWidgets/GeneratedWidgetExecutor", () => ({
  GeneratedWidgetExecutor: () => <div>generated-widget-executor</div>,
}));
vi.mock("../widgets/GeneratedWidgets/WidgetWorkshop", () => ({
  WidgetWorkshop: () => <div>widget-workshop</div>,
}));
vi.mock("../widgets/GeneratedWidgets/GeneratedWidgetTool", () => ({
  GeneratedWidgetTool: () => <div>generated-widget</div>,
}));
vi.mock("../widgets/GeneratedWidgets/WidgetStateRules", () => ({
  WidgetStateRules: () => <div>widget-state-rules</div>,
}));
vi.mock("../widgets/Planner/Diary", () => ({ Diary: () => <div>planner</div> }));
vi.mock("../widgets/Travel/Travel", () => ({ Travel: () => <div>travel</div> }));
vi.mock("../components/DesktopToy/DesktopToy", () => ({
  DesktopToy: () => <div>desktop-toy</div>,
}));
vi.mock("../widgets/WidgetDisplay/WidgetStack", () => ({
  WidgetStack: () => <div>widget-stack</div>,
}));
vi.mock("../widgets/WidgetDisplay/WidgetDisplay", () => ({
  WidgetDisplay: () => <div>widget-display</div>,
}));
vi.mock("../widgets/WidgetDisplay/WidgetEditor", () => ({
  WidgetEditor: () => <div>widget-editor</div>,
}));
vi.mock("../widgets/MemoNote/MemoNote", () => ({ MemoNote: () => <div>memo-note</div> }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

it.each([
  "generated-widget-executor",
  "widget-workshop",
  "generated-widget",
  "widget-state-rules",
  "planner",
  "travel",
  "desktop-toy",
  "widget-stack",
  "widget-display",
  "widget-editor",
  "memo-note",
])("%s mounts without a full app snapshot subscription or bootstrap", async (view) => {
  window.history.replaceState(null, "", `/?view=${view}`);
  render(<App />);
  expect(screen.getByText(view)).toBeTruthy();
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_analytics_consent"));
  expect(listen).toHaveBeenCalledTimes(1);
  expect(listen).toHaveBeenCalledWith("analytics-consent", expect.any(Function));
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).not.toHaveBeenCalledWith("get_snapshot", undefined);
});

it("keeps the snapshot subscription when switching to a snapshot-dependent route", async () => {
  window.history.replaceState(null, "", "/?view=planner");
  const { rerender } = render(<App />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_analytics_consent"));
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/?view=launcher");
  rerender(<App />);
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("get_snapshot", undefined));
  expect(listen).toHaveBeenCalledExactlyOnceWith("app-state", expect.any(Function));
  expect(screen.queryByText("planner")).toBeNull();
});
