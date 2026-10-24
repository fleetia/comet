// @vitest-environment jsdom
// happy-dom does not disable controls inside a disabled fieldset.
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DiaryLedger } from "./DiaryLedger";
import {
  DEFAULT_LEDGER_SETTINGS,
  type LedgerEntry,
  type RecurringExpense,
} from "./diaryLedgerTypes";
import type { DiaryAction, DiaryState } from "./diaryTypes";

afterEach(cleanup);
const state: DiaryState = {
  revision: 1,
  pages: [],
  notes: [],
  moves: [],
  ledgerEntries: [],
  ledgerRecurring: [],
  ledgerSettings: DEFAULT_LEDGER_SETTINGS,
};
const entry: LedgerEntry = {
  id: "lunch",
  date: "2026-01-15",
  kind: "expense",
  amount: 9000,
  category: "food",
  title: "점심",
  memo: "원래 메모",
};
const recurring: RecurringExpense = {
  id: "rent",
  title: "월세",
  amount: 550000,
  category: "housing",
  estimated: false,
  frequency: "monthly",
  interval: 1,
  day: 15,
  weekday: 0,
  months: [],
  startDate: "2026-01-01",
  endDate: null,
  weekend: "keep",
  autoRecord: true,
  enabled: true,
  recordedDates: [],
};
const change = (name: string, value: string) =>
  fireEvent.change(screen.getByLabelText(name), { target: { value } });

it("keeps failed quick-add drafts and prevents duplicate submission during a save", async () => {
  let finish: ((value: boolean) => void) | undefined;
  const onAction = vi
    .fn<DiaryAction>()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValue(true);
  render(<DiaryLedger state={state} date="2026-01-15" busy={false} onAction={onAction} />);
  change("금액 (원)", "4,500");
  change("어디에 썼나요?", "커피");
  const submit = screen.getByRole("button", { name: "추가" });
  fireEvent.click(submit);
  fireEvent.click(submit);
  expect(onAction).toHaveBeenCalledExactlyOnceWith("ledger-entry-create", {
    date: "2026-01-15",
    kind: "expense",
    amount: 4500,
    category: "food",
    title: "커피",
    memo: "",
  });
  await act(async () => finish?.(false));
  expect(screen.getByLabelText("금액 (원)")).toHaveProperty("value", "4,500");
  expect(screen.getByRole("alert").textContent).toContain("입력 내용을 유지");
  fireEvent.click(submit);
  await waitFor(() => expect(screen.getByLabelText("금액 (원)")).toHaveProperty("value", ""));
});

it("creates income with its date and retains the original snapshot for edits and deletes", async () => {
  const onAction = vi.fn<DiaryAction>().mockResolvedValue(true);
  render(
    <DiaryLedger
      state={{ ...state, ledgerEntries: [entry] }}
      date="2026-01-15"
      busy={false}
      onAction={onAction}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "수입·지출 추가" }));
  fireEvent.click(screen.getByRole("radio", { name: "수입" }));
  change("기록 이름", "정산");
  change("기록 금액 (원)", "120,000");
  change("기록 날짜", "2026-01-20");
  change("기록 메모", "  원문\n유지  ");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "추가" }));
  await waitFor(() =>
    expect(onAction).toHaveBeenCalledWith(
      "ledger-entry-create",
      expect.objectContaining({
        kind: "income",
        date: "2026-01-20",
        amount: 120000,
        memo: "  원문\n유지  ",
      }),
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "점심 편집" }));
  change("기록 금액 (원)", "10,000");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(onAction).toHaveBeenCalledWith(
      "ledger-entry-update",
      expect.objectContaining({ id: entry.id, expected: entry, amount: 10000 }),
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "점심 편집" }));
  fireEvent.click(screen.getByRole("button", { name: "삭제" }));
  expect(onAction).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "삭제하기" }));
  await waitFor(() =>
    expect(onAction).toHaveBeenCalledWith("ledger-entry-delete", { id: entry.id, expected: entry }),
  );
});

it("keeps an edited draft when the entry changes remotely and requires an explicit reload", async () => {
  const onAction = vi.fn<DiaryAction>().mockResolvedValue(true);
  const view = render(
    <DiaryLedger
      state={{ ...state, ledgerEntries: [entry] }}
      date="2026-01-15"
      busy={false}
      onAction={onAction}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "점심 편집" }));
  change("기록 이름", "내 수정");
  view.rerender(
    <DiaryLedger
      state={{ ...state, ledgerEntries: [{ ...entry, title: "다른 화면 수정" }] }}
      date="2026-01-15"
      busy={false}
      onAction={onAction}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(onAction).not.toHaveBeenCalled();
  expect(screen.getByLabelText("기록 이름")).toHaveProperty("value", "내 수정");
  fireEvent.click(screen.getByRole("button", { name: "최신 내용 다시 불러오기" }));
  fireEvent.click(screen.getByRole("button", { name: "변경 버리기" }));
  expect(screen.getByLabelText("기록 이름")).toHaveProperty("value", "다른 화면 수정");
});

it("shows travel ownership errors without closing the editor or claiming the edit was saved", async () => {
  const failure = "여행에서 자동으로 기록한 내 몫이에요. 여행의 비용이나 예약에서 고쳐 주세요.";
  const linked = { ...entry, amount: 101, memo: "여행 · 제주 가족 여행" };
  const onAction = vi.fn<DiaryAction>().mockRejectedValue(failure);
  render(
    <DiaryLedger
      state={{ ...state, ledgerEntries: [linked] }}
      date="2026-01-15"
      busy={false}
      onAction={onAction}
    />,
  );
  const savedRow = screen.getByRole("button", { name: "점심 편집" }).parentElement!;
  fireEvent.click(screen.getByRole("button", { name: "점심 편집" }));
  change("기록 금액 (원)", "202");
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe(failure),
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.getByLabelText("기록 금액 (원)")).toHaveProperty("value", "202");
  expect(within(savedRow).getByText("101원")).toBeTruthy();
  expect(within(savedRow).queryByText("202원")).toBeNull();
  expect(onAction).toHaveBeenCalledExactlyOnceWith(
    "ledger-entry-update",
    expect.objectContaining({ id: linked.id, expected: linked, amount: 202 }),
  );
  expect(screen.getByRole("button", { name: "저장" })).toHaveProperty("disabled", false);
});

it("shows a supplied action error only after a failed save and clears it on successful retry", async () => {
  const failure = "다른 화면에서 내용이 바뀌었어요.";
  const onAction = vi.fn<DiaryAction>().mockResolvedValueOnce(false).mockResolvedValue(true);
  render(
    <DiaryLedger
      state={{ ...state, ledgerEntries: [entry] }}
      date="2026-01-15"
      busy={false}
      onAction={onAction}
      actionError={failure}
    />,
  );
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "점심 편집" }));
  expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull();
  change("기록 금액 (원)", "10000");
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(within(screen.getByRole("dialog")).getByRole("alert").textContent).toBe(failure),
  );
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "점심 편집" }));
  expect(within(screen.getByRole("dialog")).queryByRole("alert")).toBeNull();
});

it("persists selected months, weekend adjustment and manual recording then generates only the displayed period", async () => {
  const onAction = vi.fn<DiaryAction>().mockResolvedValue(true);
  render(<DiaryLedger state={state} date="2026-01-15" busy={false} onAction={onAction} />);
  fireEvent.click(screen.getByRole("radio", { name: "고정비" }));
  fireEvent.click(screen.getByRole("button", { name: "고정비 추가" }));
  change("기록 이름", "자동차 보험");
  change("기록 금액 (원)", "600,000");
  fireEvent.click(screen.getByRole("radio", { name: "특정 달" }));
  fireEvent.click(screen.getByRole("button", { name: "3월" }));
  change("주말 처리", "before");
  change("고정비 기록 방식", "manual");
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "추가" }));
  await waitFor(() =>
    expect(onAction).toHaveBeenCalledWith(
      "ledger-recurring-create",
      expect.objectContaining({
        amount: 600000,
        frequency: "months",
        months: [1, 3],
        weekend: "before",
        autoRecord: false,
      }),
    ),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "이번 달 기록하기" }));
  await waitFor(() =>
    expect(onAction).toHaveBeenCalledWith("ledger-generate", {
      fromDate: "2026-01-01",
      throughDate: "2026-01-31",
      includeManual: true,
    }),
  );
});

it("keeps recurring drafts editable when automatic recording only changes recorded dates", async () => {
  const onAction = vi.fn<DiaryAction>().mockResolvedValue(true);
  const view = render(
    <DiaryLedger
      state={{ ...state, ledgerRecurring: [recurring] }}
      date="2026-01-15"
      busy={false}
      onAction={onAction}
    />,
  );
  fireEvent.click(screen.getByRole("radio", { name: "고정비" }));
  fireEvent.click(screen.getByRole("button", { name: "월세 고정비 편집" }));
  change("기록 금액 (원)", "600,000");
  view.rerender(
    <DiaryLedger
      state={{
        ...state,
        ledgerRecurring: [{ ...recurring, recordedDates: ["2026-01-15"] }],
      }}
      date="2026-01-15"
      busy={false}
      onAction={onAction}
    />,
  );
  expect(screen.queryByRole("button", { name: "최신 내용 다시 불러오기" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(onAction).toHaveBeenCalledWith(
      "ledger-recurring-update",
      expect.objectContaining({ id: recurring.id, expected: recurring, amount: 600000 }),
    ),
  );
});

it("protects recurring definition changes while keeping the edited draft", () => {
  const onAction = vi.fn<DiaryAction>().mockResolvedValue(true);
  const view = render(
    <DiaryLedger
      state={{ ...state, ledgerRecurring: [recurring] }}
      date="2026-01-15"
      busy={false}
      onAction={onAction}
    />,
  );
  fireEvent.click(screen.getByRole("radio", { name: "고정비" }));
  fireEvent.click(screen.getByRole("button", { name: "월세 고정비 편집" }));
  change("기록 이름", "내 수정");
  view.rerender(
    <DiaryLedger
      state={{
        ...state,
        ledgerRecurring: [{ ...recurring, amount: 600000, recordedDates: ["2026-01-15"] }],
      }}
      date="2026-01-15"
      busy={false}
      onAction={onAction}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(onAction).not.toHaveBeenCalled();
  expect(screen.getByLabelText("기록 이름")).toHaveProperty("value", "내 수정");
  expect(screen.getByRole("alert").textContent).toContain("최신 내용을 다시 불러온 뒤");
});

it("changes the monthly budget with a settings snapshot and protects categories in use", async () => {
  const onAction = vi.fn<DiaryAction>().mockResolvedValue(true);
  render(
    <DiaryLedger
      state={{ ...state, ledgerEntries: [entry] }}
      date="2026-01-15"
      busy={false}
      onAction={onAction}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "설정하기" }));
  expect(screen.getByRole("button", { name: "식비 분류 삭제" })).toHaveProperty("disabled", true);
  change("월 예산 (원)", "500,000");
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(onAction).toHaveBeenCalledWith("ledger-settings-update", {
      expected: DEFAULT_LEDGER_SETTINGS,
      settings: { ...DEFAULT_LEDGER_SETTINGS, monthlyBudget: 500000 },
    }),
  );
});
