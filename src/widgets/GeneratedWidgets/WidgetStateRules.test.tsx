import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { command } from "../../hooks/useSnapshot";
import { PREVIEW_SNAPSHOT } from "../../previewSnapshot";
import { WidgetStateRules } from "./WidgetStateRules";
import type { StateRule } from "./types";

vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
const RULE: StateRule = {
  id: "rule-1",
  widgetId: "counter",
  characterId: PREVIEW_SNAPSHOT.characters.active[0],
  field: "count",
  operator: "gte",
  value: 5,
  text: "한 단씩 잘 올라가네.",
  expression: null,
  motion: null,
  cooldownMs: 30_000,
  enabled: true,
};
const EDITOR = { rules: [RULE], state: { count: 0 }, characters: PREVIEW_SNAPSHOT.characters };

beforeEach(() => {
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(EDITOR);
});
afterEach(cleanup);

it("preserves authored whitespace after a failed save and retries against the same widget and character", async () => {
  vi.mocked(command)
    .mockResolvedValueOnce(EDITOR)
    .mockRejectedValueOnce(new Error("disk unavailable"));
  render(<WidgetStateRules id="counter" />);
  const text = "  해냈다!\n\n한 단 더...  ";
  fireEvent.change(await screen.findByLabelText("조건 1 대사"), { target: { value: text } });
  fireEvent.change(screen.getByLabelText("조건 1 값"), { target: { value: "12" } });
  const characterId = PREVIEW_SNAPSHOT.characters.installed[1].id;
  fireEvent.change(screen.getByLabelText("조건 1 캐릭터"), { target: { value: characterId } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "disk unavailable");
  expect(screen.getByLabelText("조건 1 대사")).toHaveProperty("value", text);
  const saved = { ...RULE, text, value: 12, characterId };
  expect(command).toHaveBeenCalledWith("save_widget_state_rules", {
    id: "counter",
    rules: [saved],
  });
  vi.mocked(command).mockResolvedValueOnce([saved]);
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(await screen.findByRole("status")).toHaveProperty("textContent", "저장했어요.");
  expect(screen.getByLabelText("조건 1 대사")).toHaveProperty("value", text);
});

it("ignores the previous widget's late editor response and saves only the selected widget's rules", async () => {
  let finishOld!: (value: typeof EDITOR) => void;
  const oldResponse = new Promise<typeof EDITOR>((resolve) => {
    finishOld = resolve;
  });
  const nextRule = {
    ...RULE,
    id: "rule-2",
    widgetId: "timer",
    field: "remaining",
    text: "이제 잠깐 쉬자.",
  };
  vi.mocked(command)
    .mockReturnValueOnce(oldResponse)
    .mockResolvedValueOnce({ ...EDITOR, rules: [nextRule], state: { remaining: 0 } });
  const rendered = render(<WidgetStateRules id="counter" />);
  rendered.rerender(<WidgetStateRules id="timer" />);
  await waitFor(() =>
    expect(screen.getByLabelText("조건 1 대사")).toHaveProperty("value", nextRule.text),
  );
  await act(async () => finishOld(EDITOR));
  expect(screen.getByLabelText("조건 1 대사")).toHaveProperty("value", nextRule.text);
  vi.mocked(command).mockResolvedValueOnce([nextRule]);
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_widget_state_rules", {
      id: "timer",
      rules: [nextRule],
    }),
  );
  expect(command).not.toHaveBeenCalledWith(
    "save_widget_state_rules",
    expect.objectContaining({ id: "counter" }),
  );
});
