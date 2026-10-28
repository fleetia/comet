import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DiaryNotes } from "./DiaryNotes";
import type { DiaryAction } from "./diaryTypes";

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const note = { id: "one", title: "작은 생각", body: "원래 생각", pinned: true };
async function debounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(550);
  });
}

it("autosaves after composition, preserving whitespace and the base content", async () => {
  const save = vi.fn<DiaryAction>().mockResolvedValue(true);
  render(<DiaryNotes notes={[note]} diaryAction={save} busy={false} />);
  const body = screen.getByRole("textbox", { name: "메모 내용" });
  fireEvent.compositionStart(body);
  fireEvent.change(body, { target: { value: "  새 생각\n이어 쓰기  " } });
  await debounce();
  expect(save).not.toHaveBeenCalled();
  fireEvent.compositionEnd(body);
  await debounce();
  expect(save).toHaveBeenCalledWith("note-update", {
    id: "one",
    title: note.title,
    body: "  새 생각\n이어 쓰기  ",
    expectedTitle: note.title,
    expectedBody: note.body,
  });
  expect(localStorage.getItem("comet.diary.note-draft:sidebar:one")).toBeNull();
});

it("keeps newer input while a save is pending and saves it against the acknowledged base", async () => {
  let finish: ((value: boolean) => void) | undefined;
  const save = vi
    .fn<DiaryAction>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(true);
  render(<DiaryNotes notes={[note]} diaryAction={save} busy={false} />);
  const body = screen.getByRole("textbox", { name: "메모 내용" });
  fireEvent.change(body, { target: { value: "첫 수정" } });
  await debounce();
  fireEvent.change(body, { target: { value: "뒤이은 수정" } });
  await act(async () => {
    finish?.(true);
  });
  expect(body).toHaveProperty("value", "뒤이은 수정");
  await debounce();
  expect(save).toHaveBeenCalledTimes(2);
  expect(save).toHaveBeenLastCalledWith(
    "note-update",
    expect.objectContaining({ body: "뒤이은 수정", expectedBody: "첫 수정" }),
  );
});

it("does not let an unmounted editor's save clear a newer editor's draft", async () => {
  let finish: ((value: boolean) => void) | undefined;
  const save = vi.fn<DiaryAction>().mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<DiaryNotes notes={[note]} diaryAction={save} busy={false} />);
  fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
    target: { value: "먼저 저장한 초안" },
  });
  await debounce();
  view.unmount();
  render(<DiaryNotes notes={[note]} diaryAction={save} busy={false} />);
  fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
    target: { value: "새 편집기의 초안" },
  });
  await act(async () => finish?.(true));
  expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveProperty(
    "value",
    "새 편집기의 초안",
  );
  expect(
    JSON.parse(localStorage.getItem("comet.diary.note-draft:sidebar:one") || "null"),
  ).toMatchObject({ body: "새 편집기의 초안" });
});

it("recognizes a restored draft already acknowledged by the original store", () => {
  const saved = { ...note, body: "저장된 새 본문" };
  localStorage.setItem(
    "comet.diary.note-draft:sidebar:one",
    JSON.stringify({
      title: saved.title,
      body: saved.body,
      baseTitle: note.title,
      baseBody: note.body,
    }),
  );
  const save = vi.fn<DiaryAction>().mockResolvedValue(true);
  render(<DiaryNotes notes={[saved]} diaryAction={save} busy={false} />);
  expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveProperty("value", saved.body);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("status").textContent).toContain("저장됨");
  expect(save).not.toHaveBeenCalled();
});

it("keeps hidden drafts and refuses to overwrite a remote change", async () => {
  const save = vi.fn<DiaryAction>().mockResolvedValue(true);
  const second = { ...note, id: "two", title: "다른 메모", body: "다른 내용", pinned: false };
  const view = render(<DiaryNotes notes={[note, second]} diaryAction={save} busy={false} />);
  fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
    target: { value: "남길 초안" },
  });
  fireEvent.click(screen.getByRole("button", { name: "다른 메모 메모 열기" }));
  view.rerender(
    <DiaryNotes
      notes={[{ ...note, body: "밖에서 바뀐 내용" }, second]}
      diaryAction={save}
      busy={false}
    />,
  );
  await debounce();
  expect(save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "작은 생각 메모 열기" }));
  expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveProperty("value", "남길 초안");
  expect(screen.getByRole("alert").textContent).toContain("다른 곳");
  fireEvent.click(screen.getByRole("button", { name: "최신 내용 다시 불러오기" }));
  expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveProperty(
    "value",
    "밖에서 바뀐 내용",
  );
});

it("does not retry failed autosaves until the user retries and restores the draft after remount", async () => {
  const save = vi.fn<DiaryAction>().mockResolvedValue(false);
  const view = render(<DiaryNotes notes={[note]} diaryAction={save} busy={false} />);
  fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
    target: { value: "실패해도 남겨요" },
  });
  await debounce();
  await debounce();
  expect(save).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("alert").textContent).toContain("저장하지 못했어요");
  view.unmount();
  render(<DiaryNotes notes={[note]} diaryAction={save} busy={false} />);
  expect(screen.getByRole("textbox", { name: "메모 내용" })).toHaveProperty(
    "value",
    "실패해도 남겨요",
  );
});

it("filters both stores and autosaves the desktop original with both conflict guards", async () => {
  const diaryAction = vi.fn<DiaryAction>().mockResolvedValue(true);
  const widget = {
    id: "memo",
    kind: "memo",
    reaction: true,
    revision: 1,
    version: 1,
    data: { notes: [{ id: "desktop", title: "바깥 생각", body: "바탕화면 원문", isOpen: true }] },
    error: null,
    missing: [],
    status: "enabled" as const,
    packageBytes: 1,
  };
  const desktop = {
    widgets: [widget],
    busy: false,
    act: vi.fn().mockResolvedValue(true),
    onCreate: vi.fn().mockResolvedValue(true),
    onOpenNote: vi.fn().mockResolvedValue(true),
    onAdd: vi.fn(),
  };
  render(<DiaryNotes notes={[note]} diaryAction={diaryAction} busy={false} desktop={desktop} />);
  fireEvent.click(screen.getByRole("radio", { name: "바탕화면에 꺼낸 것" }));
  expect(screen.queryByRole("button", { name: "작은 생각 메모 열기" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "메모 내용" }), {
    target: { value: "  편집한 원문\n  " },
  });
  await debounce();
  expect(desktop.act).toHaveBeenCalledWith(
    "update",
    {
      id: "desktop",
      body: "  편집한 원문\n  ",
      expectedTitle: "바깥 생각",
      expectedBody: "바탕화면 원문",
    },
    widget,
  );
  expect(diaryAction).not.toHaveBeenCalled();
});
