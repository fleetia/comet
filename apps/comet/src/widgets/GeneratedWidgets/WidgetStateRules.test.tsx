// @vitest-environment jsdom
// happy-dom does not disable controls inside a disabled fieldset.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { command } from "../../hooks/useSnapshot";
import { PREVIEW_SNAPSHOT } from "../../previewSnapshot";
import { WidgetStateRules } from "./WidgetStateRules";
import type { RuleDraft } from "./WidgetStateRules";

vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: vi.fn().mockResolvedValue(() => undefined) }),
}));
const RULE: RuleDraft = {
  id: "rule-1",
  widgetId: "counter",
  characterId: PREVIEW_SNAPSHOT.characters.active[0],
  field: "count",
  operator: "gte",
  valueJson: "5",
  text: "한 단씩 잘 올라가네.",
  expression: null,
  motion: null,
  cooldownMs: 30_000,
  enabled: true,
};
const EDITOR = { rules: [RULE], stateJson: '{"count":0}', baseline: "1", characters: PREVIEW_SNAPSHOT.characters };

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
  const saved = { ...RULE, text, valueJson: "12", characterId };
  expect(command).toHaveBeenCalledWith("save_widget_state_rules", {
    id: "counter",
    rules: [saved], expectedBaseline: "1",
  });
  vi.mocked(command).mockResolvedValueOnce({ rules: [saved], baseline: "2" });
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
    .mockResolvedValueOnce({ ...EDITOR, rules: [nextRule], stateJson: '{"remaining":0}' });
  const rendered = render(<WidgetStateRules id="counter" />);
  rendered.rerender(<WidgetStateRules id="timer" />);
  await waitFor(() =>
    expect(screen.getByLabelText("조건 1 대사")).toHaveProperty("value", nextRule.text),
  );
  await act(async () => finishOld(EDITOR));
  expect(screen.getByLabelText("조건 1 대사")).toHaveProperty("value", nextRule.text);
  vi.mocked(command).mockResolvedValueOnce({ rules: [nextRule], baseline: "2" });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_widget_state_rules", {
      id: "timer",
      rules: [nextRule], expectedBaseline: "1",
    }),
  );
  expect(command).not.toHaveBeenCalledWith(
    "save_widget_state_rules",
    expect.objectContaining({ id: "counter" }),
  );
});


function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (cause: Error) => void } {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  return { promise: new Promise<T>((yes, no) => { resolve = yes; reject = no; }), resolve, reject };
}

it("keeps integer and floating JSON source through editing, trial, and saving", async () => {
  render(<WidgetStateRules id="counter" />);
  fireEvent.change(await screen.findByLabelText("조건 1 값"), { target: { value: "9007199254740993" } });
  fireEvent.change(screen.getByLabelText("시험할 전체 상태 JSON"), { target: { value: '{"count":9007199254740993}' } });
  vi.mocked(command).mockResolvedValueOnce({ valid: false, fieldPresent: null, matched: null, error: "숫자 한도" });
  fireEvent.click(screen.getByRole("button", { name: "조건 1 시험" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "숫자 한도");
  expect(command).toHaveBeenCalledWith("test_widget_state_rule", {
    id: "counter", rule: { ...RULE, valueJson: "9007199254740993" }, stateJson: '{"count":9007199254740993}',
  });
  fireEvent.change(screen.getByLabelText("조건 1 값"), { target: { value: "1.0" } });
  const saved = { ...RULE, valueJson: "1.0" };
  vi.mocked(command).mockResolvedValueOnce({ rules: [saved], baseline: "2" });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(await screen.findByText("저장했어요.")).toBeTruthy();
  expect(command).toHaveBeenLastCalledWith("save_widget_state_rules", { id: "counter", rules: [saved], expectedBaseline: "1" });
  expect(screen.getByLabelText("조건 1 값")).toHaveProperty("value", "1.0");
});

it("distinguishes missing fields from a valid non-match and ignores late trials after an edit", async () => {
  render(<WidgetStateRules id="counter" />);
  await screen.findByLabelText("조건 1 대사");
  vi.mocked(command).mockResolvedValueOnce({ valid: true, fieldPresent: false, matched: false, error: null });
  fireEvent.click(screen.getByRole("button", { name: "조건 1 시험" }));
  expect(await screen.findByText("필드가 없어요. 조건은 일치하지 않아요.")).toBeTruthy();
  const late = deferred<{ valid: boolean; fieldPresent: boolean; matched: boolean; error: null }>();
  vi.mocked(command).mockReturnValueOnce(late.promise);
  fireEvent.click(screen.getByRole("button", { name: "조건 1 시험" }));
  fireEvent.change(screen.getByLabelText("조건 1 대사"), { target: { value: "다른 대사" } });
  await act(async () => late.resolve({ valid: true, fieldPresent: true, matched: true, error: null }));
  expect(screen.queryByText("이 상태에서 조건이 일치해요.")).toBeNull();
});

it("locks edits and duplicate saves until a pending save completes, then cancels to its successful baseline", async () => {
  render(<WidgetStateRules id="counter" />);
  fireEvent.change(await screen.findByLabelText("조건 1 대사"), { target: { value: "저장할 원문" } });
  const pending = deferred<{ rules: RuleDraft[]; baseline: string }>();
  vi.mocked(command).mockReturnValueOnce(pending.promise);
  const save = screen.getByRole("button", { name: "저장" });
  fireEvent.click(save);
  fireEvent.click(save);
  expect(screen.getByLabelText("조건 1 대사").matches(":disabled")).toBe(true);
  expect(command).toHaveBeenCalledTimes(2);
  const saved = { ...RULE, text: "저장할 원문" };
  await act(async () => pending.resolve({ rules: [saved], baseline: "2" }));
  fireEvent.change(screen.getByLabelText("조건 1 대사"), { target: { value: "다음 초안" } });
  fireEvent.click(screen.getByRole("button", { name: "수정 취소" }));
  expect(screen.getByLabelText("조건 1 대사")).toHaveProperty("value", saved.text);
  expect(screen.getByRole("button", { name: "수정 취소" })).toHaveProperty("disabled", true);
});

it("ignores a late A save after the target changes to B and back to A", async () => {
  const oldSave = deferred<{ rules: RuleDraft[]; baseline: string }>();
  render(<WidgetStateRules id="counter" />).unmount();
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValueOnce(EDITOR).mockReturnValueOnce(oldSave.promise)
    .mockResolvedValueOnce({ ...EDITOR, rules: [{ ...RULE, widgetId: "timer", text: "B" }] })
    .mockResolvedValueOnce({ ...EDITOR, rules: [{ ...RULE, text: "현재 A" }], baseline: "3" });
  const view = render(<WidgetStateRules id="counter" />);
  fireEvent.change(await screen.findByLabelText("조건 1 대사"), { target: { value: "이전 A" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  view.rerender(<WidgetStateRules id="timer" />);
  await waitFor(() => expect(screen.getByLabelText("조건 1 대사")).toHaveProperty("value", "B"));
  view.rerender(<WidgetStateRules id="counter" />);
  await waitFor(() => expect(screen.getByLabelText("조건 1 대사")).toHaveProperty("value", "현재 A"));
  await act(async () => oldSave.resolve({ rules: [{ ...RULE, text: "이전 A" }], baseline: "2" }));
  expect(screen.getByLabelText("조건 1 대사")).toHaveProperty("value", "현재 A");
  expect(screen.queryByText("저장했어요.")).toBeNull();
});

it("preserves conflicting drafts and requires explicit discard before reloading or closing", async () => {
  render(<WidgetStateRules id="counter" />);
  fireEvent.change(await screen.findByLabelText("조건 1 대사"), { target: { value: "충돌할 초안" } });
  vi.mocked(command).mockRejectedValueOnce(new Error("다른 창에서 조건을 변경했어요."));
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await screen.findByText("다른 창에서 조건을 변경했어요.");
  fireEvent.click(screen.getByRole("button", { name: "최신 내용 확인" }));
  expect(await screen.findByRole("dialog", { name: "최신 조건을 확인할까요?" })).toBeTruthy();
  expect(command).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
  expect(screen.getByLabelText("조건 1 대사")).toHaveProperty("value", "충돌할 초안");
  fireEvent.click(screen.getByRole("button", { name: "상태별 대사 닫기" }));
  expect(await screen.findByRole("dialog", { name: "저장하지 않은 조건이 있어요" })).toBeTruthy();
  expect(command).not.toHaveBeenCalledWith("close_widget_state_rules", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "저장하지 않고 닫기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("close_widget_state_rules", { id: "counter" }));
});
