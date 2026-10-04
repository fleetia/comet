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

it("cancels only the selected entry to its latest saved baseline and retains other drafts", () => {
  const { rerender } = render(<WordbookPanel entries={[FIRST, SECOND]} />);
  fireEvent.change(screen.getByLabelText("대사 1"), { target: { value: "미저장 인사" } });
  fireEvent.click(screen.getByRole("button", { name: "작별" }));
  fireEvent.change(screen.getByLabelText("대사 1"), { target: { value: "미저장 작별" } });
  const latest = { ...FIRST, lines: [{ ...FIRST.lines[0], text: "최근 저장된 인사" }] };
  rerender(<WordbookPanel entries={[latest, SECOND]} />);
  fireEvent.click(screen.getByRole("button", { name: "인사 · 미저장" }));
  fireEvent.click(screen.getByRole("button", { name: "수정 취소" }));
  expect(screen.getByLabelText("대사 1")).toHaveProperty("value", "최근 저장된 인사");
  fireEvent.click(screen.getByRole("button", { name: "작별 · 미저장" }));
  expect(screen.getByLabelText("대사 1")).toHaveProperty("value", "미저장 작별");
  expect(command).not.toHaveBeenCalled();
});

it("discards only a new unsaved entry and returns to the existing dirty entry", () => {
  render(<WordbookPanel entries={[FIRST]} />);
  fireEvent.change(screen.getByLabelText("대사 1"), { target: { value: "먼저 편집한 인사" } });
  fireEvent.click(screen.getByRole("button", { name: "새 항목 만들기" }));
  fireEvent.change(screen.getByRole("textbox", { name: "제목" }), {
    target: { value: "버릴 새 항목" },
  });
  fireEvent.click(screen.getByRole("button", { name: "수정 취소" }));
  expect(screen.queryByRole("button", { name: /버릴 새 항목/ })).toBeNull();
  expect(screen.getByLabelText("대사 1")).toHaveProperty("value", "먼저 편집한 인사");
  expect(command).not.toHaveBeenCalled();
});

it("keeps optional groups organizational, preserves drafts across filtering, and saves only metadata", async () => {
  const original = { ...FIRST, title: "  원래 제목  ", keywords: ["  공백 키워드  "] };
  render(<WordbookPanel entries={[original, { ...SECOND, group: "rest" }]} />);
  expect(screen.getByRole("combobox", { name: "분류 (선택)" })).toHaveProperty("value", "");
  fireEvent.change(screen.getByRole("combobox", { name: "분류 (선택)" }), {
    target: { value: "work" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "분류로 찾기" }), {
    target: { value: "rest" },
  });
  expect(screen.queryByRole("button", { name: /원래 제목/ })).toBeNull();
  expect(screen.getByLabelText("대사 1")).toHaveProperty("value", original.lines[0].text);
  expect(screen.getByText(/현재 편집 중인 항목은 다른 분류/)).toBeTruthy();
  expect(command).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "단어장 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_wordbook_entry", {
      entry: { ...original, group: "work" },
    }),
  );
  expect(screen.getByText(/재생 조건은 바뀌지 않아요/)).toBeTruthy();
});

it("creates under the selected group and can return an entry to ungrouped", async () => {
  render(<WordbookPanel entries={[{ ...FIRST, group: "daily" }]} />);
  fireEvent.change(screen.getByRole("combobox", { name: "분류 (선택)" }), {
    target: { value: "" },
  });
  fireEvent.click(screen.getByRole("button", { name: "단어장 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_wordbook_entry", {
      entry: { ...FIRST, group: undefined },
    }),
  );
  await screen.findByText("단어장에 저장했어요.");
  fireEvent.change(screen.getByRole("combobox", { name: "분류로 찾기" }), {
    target: { value: "daily" },
  });
  expect(screen.getByText("이 분류에 항목이 없어요.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "새 항목 만들기" }));
  expect(screen.getByRole("combobox", { name: "분류 (선택)" })).toHaveProperty("value", "daily");
});

it("exposes a labeled verbatim preview in the personal wordbook", () => {
  const { container } = render(<WordbookPanel entries={[FIRST]} />);
  const summary = screen.getByText("대사 미리보기 · 현재 편집 내용");
  expect(summary.tagName).toBe("SUMMARY");
  const preview = screen.getByLabelText("키워드 대사 미리보기");
  expect(preview.querySelector("li span")).toHaveProperty("textContent", FIRST.lines[0].text);
  fireEvent.click(screen.getByRole("button", { name: "2번 대사 위로" }));
  expect(Array.from(preview.querySelectorAll("li span")).map((line) => line.textContent)).toEqual([
    FIRST.lines[1].text,
    FIRST.lines[0].text,
  ]);
  expect(container.querySelector("details")).toBeTruthy();
  expect(command).not.toHaveBeenCalled();
});

it("warns about duplicate keywords across groups without changing registration or blocking edits", () => {
  const duplicate = { ...SECOND, keywords: ["HELLO"], group: "rest" as const, enabled: false };
  render(<WordbookPanel entries={[{ ...FIRST, keywords: ["hello"], group: "work" }, duplicate]} />);
  fireEvent.change(screen.getByRole("combobox", { name: "분류로 찾기" }), {
    target: { value: "work" },
  });
  const warning = screen.getByRole("note");
  expect(warning.textContent).toContain("‘작별’ (꺼짐)");
  expect(warning.textContent).toContain("긴 일치 키워드가 우선");
  expect(warning.textContent).toContain("먼저 등록한 항목");
  expect(screen.queryByRole("button", { name: "작별 · 꺼짐" })).toBeNull();
  expect(command).not.toHaveBeenCalled();
});

it("tests saved entries in registration order independent of group filter and unsaved drafts", async () => {
  const first = { ...FIRST, group: "work" as const };
  const second = { ...SECOND, group: "rest" as const };
  vi.mocked(command).mockResolvedValueOnce({ entry: second, keyword: "잘 가" });
  render(<WordbookPanel entries={[first, second]} />);
  fireEvent.change(screen.getByLabelText("대사 1"), { target: { value: "미저장 대사" } });
  fireEvent.change(screen.getByRole("textbox", { name: "키워드" }), {
    target: { value: "미저장 키워드" },
  });
  fireEvent.change(screen.getByRole("combobox", { name: "분류로 찾기" }), {
    target: { value: "work" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "테스트할 말" }), {
    target: { value: "잘 가, 내일 만나" },
  });
  fireEvent.click(screen.getByRole("button", { name: "매칭 테스트" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("preview_wordbook_match", {
      entries: [first, second],
      input: "잘 가, 내일 만나",
    }),
  );
  expect((await screen.findByLabelText("매칭 결과")).textContent).toContain(
    "일치한 등록 항목: 작별",
  );
  expect(screen.getByLabelText("일치한 등록 대사").querySelector("li span")).toHaveProperty(
    "textContent",
    second.lines[0].text,
  );
  expect(screen.getByLabelText("대사 1")).toHaveProperty("value", "미저장 대사");
  expect(command).toHaveBeenCalledTimes(1);
});

it("uses Enter to test without saving and reports no match only after the backend responds", async () => {
  vi.mocked(command).mockResolvedValueOnce(null);
  render(<WordbookPanel entries={[FIRST]} />);
  expect(screen.queryByText("일치하는 저장된 활성 항목이 없어요.")).toBeNull();
  const input = screen.getByRole("textbox", { name: "테스트할 말" });
  fireEvent.change(input, { target: { value: "다른 말" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(await screen.findByText("일치하는 저장된 활성 항목이 없어요.")).toBeTruthy();
  expect(command).toHaveBeenCalledTimes(1);
  expect(command).toHaveBeenCalledWith("preview_wordbook_match", {
    entries: [FIRST],
    input: "다른 말",
  });
});

it("ignores stale matching responses when the test input changes", async () => {
  let resolve: (result: { entry: WordbookEntry; keyword: string }) => void = () => {};
  vi.mocked(command).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  render(<WordbookPanel entries={[FIRST]} />);
  const input = screen.getByRole("textbox", { name: "테스트할 말" });
  fireEvent.change(input, { target: { value: "안녕" } });
  fireEvent.click(screen.getByRole("button", { name: "매칭 테스트" }));
  expect(screen.getByRole("button", { name: "확인 중…" })).toHaveProperty("disabled", true);
  fireEvent.change(input, { target: { value: "다른 입력" } });
  resolve({ entry: FIRST, keyword: "안녕" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "매칭 테스트" })).toHaveProperty("disabled", false),
  );
  expect(screen.queryByLabelText("매칭 결과")).toBeNull();
});

it("invalidates a completed match when saved entries update but keeps it across display filters", async () => {
  vi.mocked(command).mockResolvedValueOnce({ entry: FIRST, keyword: "안녕" });
  const { rerender } = render(<WordbookPanel entries={[FIRST]} />);
  fireEvent.change(screen.getByRole("textbox", { name: "테스트할 말" }), {
    target: { value: "안녕" },
  });
  fireEvent.click(screen.getByRole("button", { name: "매칭 테스트" }));
  await screen.findByLabelText("매칭 결과");
  fireEvent.change(screen.getByRole("combobox", { name: "분류로 찾기" }), {
    target: { value: "rest" },
  });
  expect(screen.getByLabelText("매칭 결과")).toBeTruthy();
  rerender(<WordbookPanel entries={[{ ...FIRST, enabled: false }]} />);
  await waitFor(() => expect(screen.queryByLabelText("매칭 결과")).toBeNull());
});

it("retains input and drafts after test failure and permits a read-only retry", async () => {
  vi.mocked(command).mockRejectedValueOnce(new Error("테스트 연결 실패"));
  render(<WordbookPanel entries={[FIRST]} />);
  fireEvent.change(screen.getByLabelText("대사 1"), { target: { value: "유지할 초안" } });
  fireEvent.change(screen.getByRole("textbox", { name: "테스트할 말" }), {
    target: { value: "안녕" },
  });
  fireEvent.click(screen.getByRole("button", { name: "매칭 테스트" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "테스트 연결 실패");
  expect(screen.getByLabelText("대사 1")).toHaveProperty("value", "유지할 초안");
  expect(screen.getByRole("textbox", { name: "테스트할 말" })).toHaveProperty("value", "안녕");
  vi.mocked(command).mockResolvedValueOnce({ entry: FIRST, keyword: "안녕" });
  fireEvent.click(screen.getByRole("button", { name: "매칭 테스트" }));
  expect(await screen.findByLabelText("일치한 등록 대사")).toBeTruthy();
  expect(command).toHaveBeenCalledTimes(2);
});

it("excludes externally deleted entries from tests while retaining their unsaved drafts", async () => {
  const { rerender } = render(<WordbookPanel entries={[FIRST, SECOND]} />);
  fireEvent.change(screen.getByLabelText("대사 1"), {
    target: { value: "삭제되어도 보존할 초안" },
  });
  rerender(<WordbookPanel entries={[SECOND]} />);
  expect(screen.getByLabelText("대사 1")).toHaveProperty("value", "삭제되어도 보존할 초안");
  vi.mocked(command).mockResolvedValueOnce(null);
  fireEvent.change(screen.getByRole("textbox", { name: "테스트할 말" }), {
    target: { value: "안녕" },
  });
  fireEvent.click(screen.getByRole("button", { name: "매칭 테스트" }));
  expect(await screen.findByText("일치하는 저장된 활성 항목이 없어요.")).toBeTruthy();
  expect(command).toHaveBeenCalledWith("preview_wordbook_match", {
    entries: [SECOND],
    input: "안녕",
  });
});

it("invalidates a pending matching response when its saved entry is externally deleted", async () => {
  let resolve: (result: { entry: WordbookEntry; keyword: string }) => void = () => {};
  vi.mocked(command).mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { rerender } = render(<WordbookPanel entries={[FIRST, SECOND]} />);
  fireEvent.change(screen.getByRole("textbox", { name: "테스트할 말" }), {
    target: { value: "안녕" },
  });
  fireEvent.click(screen.getByRole("button", { name: "매칭 테스트" }));
  expect(screen.getByRole("button", { name: "확인 중…" })).toHaveProperty("disabled", true);
  rerender(<WordbookPanel entries={[SECOND]} />);
  resolve({ entry: FIRST, keyword: "안녕" });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "매칭 테스트" })).toHaveProperty("disabled", false),
  );
  expect(screen.queryByLabelText("매칭 결과")).toBeNull();
  vi.mocked(command).mockResolvedValueOnce(null);
  fireEvent.click(screen.getByRole("button", { name: "매칭 테스트" }));
  await screen.findByText("일치하는 저장된 활성 항목이 없어요.");
  expect(command).toHaveBeenLastCalledWith("preview_wordbook_match", {
    entries: [SECOND],
    input: "안녕",
  });
});

it("includes a newly saved local entry before a snapshot and defers to the next snapshot afterward", async () => {
  const { rerender } = render(<WordbookPanel entries={[FIRST]} />);
  fireEvent.click(screen.getByRole("button", { name: "새 항목 만들기" }));
  fireEvent.change(screen.getByRole("textbox", { name: "제목" }), { target: { value: "새 저장" } });
  fireEvent.change(screen.getByRole("textbox", { name: "키워드" }), {
    target: { value: "새 키워드" },
  });
  fireEvent.change(screen.getByLabelText("대사 1"), { target: { value: "  새 원문  " } });
  fireEvent.click(screen.getByRole("button", { name: "단어장 저장" }));
  await screen.findByText("단어장에 저장했어요.");
  const saved = vi.mocked(command).mock.calls[0][1]?.entry as WordbookEntry;
  vi.mocked(command).mockResolvedValueOnce({ entry: saved, keyword: "새 키워드" });
  fireEvent.change(screen.getByRole("textbox", { name: "테스트할 말" }), {
    target: { value: "새 키워드" },
  });
  fireEvent.click(screen.getByRole("button", { name: "매칭 테스트" }));
  await screen.findByLabelText("매칭 결과");
  expect(command).toHaveBeenLastCalledWith("preview_wordbook_match", {
    entries: [FIRST, saved],
    input: "새 키워드",
  });
  rerender(<WordbookPanel entries={[FIRST, saved]} />);
  rerender(<WordbookPanel entries={[FIRST]} />);
  expect(screen.queryByLabelText("매칭 결과")).toBeNull();
  vi.mocked(command).mockResolvedValueOnce(null);
  fireEvent.click(screen.getByRole("button", { name: "매칭 테스트" }));
  await screen.findByText("일치하는 저장된 활성 항목이 없어요.");
  expect(command).toHaveBeenLastCalledWith("preview_wordbook_match", {
    entries: [FIRST],
    input: "새 키워드",
  });
});

it("preserves local registration order when saved entries are edited before snapshot delivery", async () => {
  render(<WordbookPanel entries={[]} />);
  async function fillAndSave(title: string) {
    fireEvent.change(screen.getByRole("textbox", { name: "제목" }), { target: { value: title } });
    fireEvent.change(screen.getByRole("textbox", { name: "키워드" }), {
      target: { value: "동일" },
    });
    fireEvent.change(screen.getByLabelText("대사 1"), { target: { value: title } });
    fireEvent.click(screen.getByRole("button", { name: "단어장 저장" }));
    await screen.findByText("단어장에 저장했어요.");
  }
  await fillAndSave("먼저 등록");
  const first = vi.mocked(command).mock.calls[0][1]?.entry as WordbookEntry;
  fireEvent.click(screen.getByRole("button", { name: "새 항목 만들기" }));
  await fillAndSave("나중 등록");
  const second = vi.mocked(command).mock.calls[1][1]?.entry as WordbookEntry;
  fireEvent.click(screen.getByRole("button", { name: "먼저 등록" }));
  await fillAndSave("먼저 등록 수정");
  const updated = vi.mocked(command).mock.calls[2][1]?.entry as WordbookEntry;
  expect(updated.id).toBe(first.id);
  vi.mocked(command).mockResolvedValueOnce({ entry: updated, keyword: "동일" });
  fireEvent.change(screen.getByRole("textbox", { name: "테스트할 말" }), {
    target: { value: "동일" },
  });
  fireEvent.click(screen.getByRole("button", { name: "매칭 테스트" }));
  await screen.findByLabelText("매칭 결과");
  expect(command).toHaveBeenLastCalledWith("preview_wordbook_match", {
    entries: [updated, second],
    input: "동일",
  });
});

it("does not resurrect a saved entry deleted by a newer snapshot before save completion", async () => {
  let resolveSave: () => void = () => {};
  vi.mocked(command).mockReturnValueOnce(
    new Promise<void>((resolve) => {
      resolveSave = resolve;
    }),
  );
  const { rerender } = render(<WordbookPanel entries={[FIRST, SECOND]} />);
  fireEvent.change(screen.getByRole("textbox", { name: "제목" }), {
    target: { value: "저장 요청한 인사" },
  });
  fireEvent.click(screen.getByRole("button", { name: "단어장 저장" }));
  const saved = vi.mocked(command).mock.calls[0][1]?.entry as WordbookEntry;
  rerender(<WordbookPanel entries={[saved, SECOND]} />);
  rerender(<WordbookPanel entries={[SECOND]} />);
  resolveSave();
  await screen.findByText("단어장에 저장했어요.");
  vi.mocked(command).mockResolvedValueOnce(null);
  fireEvent.change(screen.getByRole("textbox", { name: "테스트할 말" }), {
    target: { value: "안녕" },
  });
  fireEvent.click(screen.getByRole("button", { name: "매칭 테스트" }));
  await screen.findByText("일치하는 저장된 활성 항목이 없어요.");
  expect(command).toHaveBeenLastCalledWith("preview_wordbook_match", {
    entries: [SECOND],
    input: "안녕",
  });
});
