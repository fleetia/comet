import { useState, type FormEvent, type ReactElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { EnvelopeCard, NoteCard } from "./Cards";
import { ContentChoice, SettingsSummary, SidebarItem, TaskRow } from "./Lists";
import { ChecklistAdd, RecordPageEntry, RecordQuickAdd, RecordSourceLink } from "./Records";

afterEach(cleanup);

it("reports native task completion without owning the consumer's state and blocks disabled edits", async () => {
  const user = userEvent.setup();
  const onCompletedChange = vi.fn();
  const { rerender } = render(
    <TaskRow
      title="책 준비"
      completionLabel="책 준비 완료"
      completed={false}
      onCompletedChange={onCompletedChange}
    />,
  );
  const checkbox = screen.getByRole<HTMLInputElement>("checkbox", { name: "책 준비 완료" });
  await user.click(checkbox);
  expect(onCompletedChange).toHaveBeenCalledWith(true);
  expect(checkbox.checked).toBe(false);
  rerender(
    <TaskRow
      title="책 준비"
      completionLabel="책 준비 완료"
      completed
      disabled
      onCompletedChange={onCompletedChange}
    />,
  );
  expect(checkbox.checked).toBe(true);
  await user.click(checkbox);
  expect(onCompletedChange).toHaveBeenCalledTimes(1);
});

it("keeps card selection buttons from submitting forms and exposes envelope progress", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
  render(
    <form onSubmit={onSubmit}>
      <NoteCard title="메모" selected onClick={onSelect} />
      <EnvelopeCard title="준비 봉투" completed={3} total={5} disabled onClick={onSelect} />
    </form>,
  );
  await user.tab();
  await user.keyboard("{Enter}");
  expect(screen.getByRole("button", { name: "메모" }).getAttribute("aria-pressed")).toBe("true");
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSubmit).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: /준비 봉투/ }));
  expect(onSelect).toHaveBeenCalledTimes(1);
  const progress = screen.getByRole<HTMLProgressElement>("progressbar", { name: "준비 진행률" });
  expect(progress.value).toBe(3);
  expect(progress.max).toBe(5);
});

it("submits the unmodified quick-add draft and selected kind while ignoring blank input", async () => {
  const user = userEvent.setup();
  const onAdd = vi.fn();
  function Example(): ReactElement {
    const [value, setValue] = useState("");
    const [kind, setKind] = useState("memo");
    return (
      <RecordQuickAdd
        value={value}
        kind={kind}
        kinds={[
          { value: "memo", label: "메모" },
          { value: "task", label: "할 일" },
        ]}
        onValueChange={setValue}
        onKindChange={setKind}
        onAdd={onAdd}
      />
    );
  }
  render(<Example />);
  const input = screen.getByRole("textbox", { name: "기록 내용" });
  await user.type(input, "   {Enter}");
  expect(onAdd).not.toHaveBeenCalled();
  await user.clear(input);
  await user.selectOptions(screen.getByRole("combobox", { name: "기록 종류" }), "task");
  await user.type(input, "  책 챙기기  {Enter}");
  expect(onAdd).toHaveBeenCalledWith("  책 챙기기  ", "task");
  expect(screen.getByRole<HTMLInputElement>("textbox", { name: "기록 내용" }).value).toBe(
    "  책 챙기기  ",
  );
});

it("keeps checklist add drafts controlled and respects disabled submission", async () => {
  const user = userEvent.setup();
  const onAdd = vi.fn();
  const onValueChange = vi.fn();
  const { rerender } = render(
    <ChecklistAdd value="기존 초안" onValueChange={onValueChange} onAdd={onAdd} />,
  );
  const input = screen.getByRole<HTMLInputElement>("textbox", { name: "준비할 일 추가" });
  await user.click(input);
  await user.keyboard("{Enter}");
  expect(onAdd).toHaveBeenCalledWith("기존 초안");
  rerender(<ChecklistAdd value="기존 초안" disabled onValueChange={onValueChange} onAdd={onAdd} />);
  expect(input.disabled).toBe(true);
  expect(input.value).toBe("기존 초안");
  await user.keyboard("{Enter}");
  expect(onAdd).toHaveBeenCalledTimes(1);
});

it("keeps record source navigation and the menu as separate targets and gives ratings a name", async () => {
  const user = userEvent.setup();
  const onMenu = vi.fn();
  render(
    <RecordPageEntry
      date="10월 12일"
      title="페스트"
      rating={4}
      source={<RecordSourceLink href="#original">원문에서</RecordSourceLink>}
      onMenu={onMenu}
    />,
  );
  expect(screen.getByRole("link", { name: "원문에서" }).getAttribute("href")).toBe("#original");
  expect(screen.getByRole("img", { name: "별점 4/5" })).toBeTruthy();
  await user.click(screen.getByRole("button", { name: "기록 메뉴" }));
  expect(onMenu).toHaveBeenCalledTimes(1);
});

it("supports keyboard selection and preserves meaningful zero counts in navigation and summaries", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(
    <>
      <ContentChoice title="이야기" selected={false} onClick={onSelect} />
      <SidebarItem href="#tasks" icon="todo" badge={0} current>
        할 일
      </SidebarItem>
      <SettingsSummary title="대화" variant="categoryCount" count={0} />
    </>,
  );
  await user.tab();
  await user.keyboard(" ");
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "이야기" }).getAttribute("aria-pressed")).toBe("false");
  expect(screen.getByRole("link", { name: /할 일\s*0/ }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("button", { name: /대화\s*0/ })).toBeTruthy();
});
