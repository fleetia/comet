import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WordbookPanel } from "../components/WordbookPanel/WordbookPanel";
import { command } from "../hooks/useSnapshot";
import type { WordbookEntry } from "../types";
vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(undefined);
});
const FIRST: WordbookEntry = {
  id: "first",
  title: "인사",
  keywords: ["안녕"],
  lines: [
    { persona: "a", expression: "기쁨", text: "  안녕!\n반가워.  " },
    { persona: "b", expression: "평온", text: "B도 왔어." },
  ],
  enabled: true,
  useForIdle: false,
};
const SECOND: WordbookEntry = {
  ...FIRST,
  id: "second",
  title: "작별",
  keywords: ["잘 가"],
  lines: [{ persona: "b", expression: "평온", text: "또 만나." }],
};
it("saves reordered lines verbatim and parses ordinary keyword separators", async () => {
  render(<WordbookPanel entries={[FIRST]} />);
  fireEvent.change(screen.getByRole("textbox", { name: "키워드" }), {
    target: { value: "안녕, 반가워\n안녕\n어서 와" },
  });
  fireEvent.click(screen.getByRole("button", { name: "2번 대사 위로" }));
  expect(screen.getByLabelText("대사 2")).toHaveProperty("value", FIRST.lines[0].text);
  fireEvent.click(screen.getByLabelText("자동 잡담에도 사용"));
  fireEvent.click(screen.getByRole("button", { name: "단어장 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_wordbook_entry", {
      entry: {
        ...FIRST,
        keywords: ["안녕", "반가워", "어서 와"],
        lines: [FIRST.lines[1], FIRST.lines[0]],
        useForIdle: true,
      },
    }),
  );
});
it("retains each dirty draft across selection, snapshot updates and save failure", async () => {
  const { rerender } = render(<WordbookPanel entries={[FIRST, SECOND]} />);
  fireEvent.change(screen.getByLabelText("대사 1"), { target: { value: "고치던 인사" } });
  fireEvent.click(screen.getByRole("button", { name: "작별" }));
  fireEvent.change(screen.getByLabelText("대사 1"), { target: { value: "고치던 작별" } });
  rerender(<WordbookPanel entries={[{ ...FIRST }, { ...SECOND }]} />);
  fireEvent.click(screen.getByRole("button", { name: "인사 · 미저장" }));
  expect(screen.getByLabelText("대사 1")).toHaveProperty("value", "고치던 인사");
  vi.mocked(command).mockRejectedValueOnce(new Error("저장할 수 없어요."));
  fireEvent.click(screen.getByRole("button", { name: "단어장 저장" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "저장할 수 없어요.");
  expect(screen.getByLabelText("대사 1")).toHaveProperty("value", "고치던 인사");
  fireEvent.click(screen.getByRole("button", { name: "작별 · 미저장" }));
  expect(screen.getByLabelText("대사 1")).toHaveProperty("value", "고치던 작별");
});
it("creates an enabled entry with idle off and deletes only the selected entry", async () => {
  render(<WordbookPanel entries={[FIRST, SECOND]} />);
  fireEvent.click(screen.getByRole("button", { name: "새 항목 만들기" }));
  expect(screen.getByLabelText("이 항목 사용")).toHaveProperty("checked", true);
  expect(screen.getByLabelText("자동 잡담에도 사용")).toHaveProperty("checked", false);
  fireEvent.change(screen.getByRole("textbox", { name: "제목" }), { target: { value: "간식" } });
  fireEvent.change(screen.getByRole("textbox", { name: "키워드" }), {
    target: { value: "배고파" },
  });
  fireEvent.change(screen.getByLabelText("대사 1"), { target: { value: "  간식 먹자!  " } });
  fireEvent.click(screen.getByRole("button", { name: "단어장 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_wordbook_entry", {
      entry: expect.objectContaining({
        title: "간식",
        keywords: ["배고파"],
        enabled: true,
        useForIdle: false,
        lines: [{ persona: "a", expression: "평온", text: "  간식 먹자!  " }],
      }),
    }),
  );
  await screen.findByText("단어장에 저장했어요.");
  fireEvent.click(screen.getByRole("button", { name: "작별" }));
  fireEvent.click(screen.getByRole("button", { name: "항목 삭제" }));
  expect(command).not.toHaveBeenCalledWith("delete_wordbook_entry", { id: "second" });
  fireEvent.click(screen.getByRole("button", { name: "삭제 취소" }));
  expect(screen.getByRole("button", { name: "작별" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "항목 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "항목 삭제 확인" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("delete_wordbook_entry", { id: "second" }),
  );
  await waitFor(() => expect(screen.queryByRole("button", { name: "작별" })).toBeNull());
  expect(screen.getByRole("button", { name: "인사" })).toBeTruthy();
});
