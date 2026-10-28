import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { GeneratedWidget, GenerationEligibility } from "../GeneratedWidgets/types";
import { GeneratedWidgetSettings } from "./GeneratedWidgetSettings";

vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
}));
afterEach(cleanup);

const widget: GeneratedWidget = {
  id: "counter",
  definition: { name: "단수", description: "고친 뜨개질 단수", source: "new", initialState: { count: 0 } },
  state: { count: 4 },
  revision: 3,
  installed: true,
  reaction: true,
  installation: null,
  updatedAt: null,
  status: "ready",
  error: null,
};
const eligibility: GenerationEligibility = {
  allowed: true,
  reason: "",
  model: "test",
  parameterBillions: null,
  source: "unknown",
};

function renderSettings(value: GeneratedWidget, run = vi.fn(async () => true)) {
  render(
    <GeneratedWidgetSettings
      widget={value}
      eligibility={eligibility}
      canAct
      run={run}
      onRemove={vi.fn()}
      onDirtyChange={vi.fn()}
    />,
  );
  return run;
}

it("keeps going back disabled until an AI fix has replaced the code", () => {
  renderSettings(widget);
  expect(screen.getByRole("button", { name: "이전 모습으로 되돌리기" })).toHaveProperty(
    "disabled",
    true,
  );
});

it("asks before going back to the code kept from before the latest AI fix", async () => {
  const run = renderSettings({
    ...widget,
    previousDefinition: { ...widget.definition, description: "처음 뜨개질 단수", source: "old" },
  });
  fireEvent.click(screen.getByRole("button", { name: "이전 모습으로 되돌리기" }));
  const dialog = within(await screen.findByRole("dialog", { name: "이전 모습으로 되돌릴까요?" }));
  expect(run).not.toHaveBeenCalled();
  fireEvent.click(dialog.getByRole("button", { name: "되돌리기" }));
  await waitFor(() =>
    expect(run).toHaveBeenCalledWith("restore_previous_generated_widget", {
      id: "counter",
      expectedRevision: 3,
    }),
  );
  expect(await screen.findByText(/이전 모습으로 되돌렸어요/)).toBeTruthy();
});
