import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  Button,
  IconButton,
  Ledger12MonthForecast,
  LedgerCategorySummary,
  LedgerDayHeader,
  LedgerMonthlyBudget,
  LedgerQuickAdd,
  LedgerRecurringRow,
  LedgerRow,
  SegmentedControl,
  Select,
  Switch,
} from "@comet/ui";
import { errorText } from "../../hooks/useSnapshot";
import { localDay, type DataRecord } from "../toolData";
import type { DiaryAction, DiaryState } from "./diaryTypes";
import {
  DEFAULT_LEDGER_SETTINGS,
  LEDGER_CATEGORIES,
  LEDGER_ICONS,
  type DiaryLedgerCategory,
} from "./diaryLedgerTypes";
import {
  FREQUENCIES,
  ledgerAmount,
  ledgerOccurrences,
  monthEnd,
  recurringDescription,
  won,
} from "./diaryLedgerData";
import { dayDate, moveDay, movePeriod, periodAnchor } from "./plannerData";
import { LedgerEditor, type LedgerEditorTarget as Editor } from "./DiaryLedgerEditor";
import * as s from "./diaryLedger.css";

const sum = (values: { amount: number }[]) =>
  values.reduce((total, value) => total + value.amount, 0);
const monthStart = (date: string) => `${date.slice(0, 7)}-01`;
const monthTitle = (date: string) => `${date.slice(0, 4)}년 ${Number(date.slice(5, 7))}월`;
const dayTitle = (date: string) =>
  `${Number(date.slice(5, 7))}월 ${Number(date.slice(8))}일 · ${"일월화수목금토"[dayDate(date).getDay()]}`;

function categoryProps(categories: DiaryLedgerCategory[], id: string) {
  const category = categories.find((value) => value.id === id) ?? LEDGER_CATEGORIES[9];
  return { category: category.color, icon: LEDGER_ICONS[category.color] };
}

export function DiaryLedger({
  state,
  date,
  onDateChange,
  onAction,
  actionError,
  busy,
  onDirtyChange,
}: {
  state: DiaryState;
  date: string;
  onDateChange?: (date: string) => void;
  onAction: DiaryAction;
  actionError?: string | null;
  busy: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}): ReactElement {
  const [mode, setMode] = useState("month");
  const [filter, setFilter] = useState("all");
  const [entryKind, setEntryKind] = useState("all");
  const [quickAmount, setQuickAmount] = useState("");
  const [quickTitle, setQuickTitle] = useState("");
  const [quickCategory, setQuickCategory] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [editorEpoch, setEditorEpoch] = useState(0);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");
  const [actionFailed, setActionFailed] = useState(false);
  const visibleFailure = actionFailed && actionError ? actionError : failure;
  const [showTable, setShowTable] = useState(false);
  const pending = useRef(false);
  const settings = state.ledgerSettings ?? DEFAULT_LEDGER_SETTINGS;
  const categories = settings.categories;
  const entries = state.ledgerEntries ?? [];
  const recurring = state.ledgerRecurring ?? [];
  const disabled = busy || saving;
  const report = useRef(onDirtyChange);
  report.current = onDirtyChange;
  useEffect(() => {
    report.current?.(Boolean(editor || quickAmount || quickTitle || saving));
  }, [editor, quickAmount, quickTitle, saving]);
  useEffect(() => () => report.current?.(false), []);

  const from = mode === "week" ? periodAnchor("week", date) : monthStart(date);
  const through = mode === "week" ? moveDay(from, 6) : monthEnd(date);
  const visible = entries.filter(
    (entry) =>
      entry.date >= from &&
      entry.date <= through &&
      (filter === "all" || entry.category === filter) &&
      (entryKind === "all" || entry.kind === entryKind),
  );
  const dates = [...new Set(visible.map((entry) => entry.date))].sort().reverse();
  const monthly = entries.filter((entry) => entry.date.slice(0, 7) === date.slice(0, 7));
  const expenses = monthly.filter((entry) => entry.kind === "expense");
  const budgetExpenses = expenses.filter(
    (entry) => settings.includeRecurring || !entry.recurringId,
  );
  const spent = sum(budgetExpenses);
  const monthlyOccurrences = useMemo(
    () => ledgerOccurrences(recurring, monthStart(date), monthEnd(date)),
    [recurring, date],
  );
  const planned = monthlyOccurrences.reduce((total, value) => total + value.rule.amount, 0);
  const upcoming = useMemo(
    () => ledgerOccurrences(recurring, localDay(), moveDay(localDay(), 366)),
    [recurring],
  );
  const forecasts = useMemo(
    () =>
      Array.from({ length: 12 }, (_, index) => {
        const start = movePeriod(monthStart(date), "month", index);
        const values = ledgerOccurrences(recurring, start, monthEnd(start));
        const regular = values.filter((value) =>
          ["weekly", "monthly"].includes(value.rule.frequency),
        );
        const occasional = values.filter(
          (value) => !["weekly", "monthly"].includes(value.rule.frequency),
        );
        return {
          id: start,
          label: `${Number(start.slice(5, 7))}월`,
          recurring: sum(regular.map((value) => value.rule)),
          occasional: sum(occasional.map((value) => value.rule)),
          valueLabel: won(sum(values.map((value) => value.rule))),
        };
      }),
    [recurring, date],
  );
  async function run(action: string, input: DataRecord): Promise<boolean> {
    if (pending.current || busy) return false;
    pending.current = true;
    setSaving(true);
    setFailure("");
    setActionFailed(false);
    try {
      const saved = await onAction(action, input);
      setActionFailed(!saved);
      if (!saved) setFailure("저장하지 못했어요. 입력 내용을 유지했으니 다시 시도해 주세요.");
      return saved;
    } catch (error) {
      setFailure(errorText(error));
      return false;
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  function openEditor(value: Editor) {
    setFailure("");
    setActionFailed(false);
    setEditorEpoch((epoch) => epoch + 1);
    setEditor(value);
  }
  function changeMode(value: string) {
    setMode(value);
    setFilter("all");
  }

  return (
    <section className={s.page} aria-label="가계부">
      <div className={s.toolbar}>
        <IconButton
          icon="chevleft"
          variant="surface"
          aria-label={mode === "week" ? "이전 주" : "이전 달"}
          onClick={() => onDateChange?.(movePeriod(date, mode === "week" ? "week" : "month", -1))}
        />
        <Button variant="ghost" size="small" onClick={() => onDateChange?.(localDay())}>
          {mode === "week" ? "이번 주" : "이번 달"}
        </Button>
        <IconButton
          icon="chev"
          variant="surface"
          aria-label={mode === "week" ? "다음 주" : "다음 달"}
          onClick={() => onDateChange?.(movePeriod(date, mode === "week" ? "week" : "month", 1))}
        />
        <h1 className={s.title}>
          가계부 ·{" "}
          {mode === "recurring"
            ? "고정비"
            : mode === "week"
              ? `${from.slice(0, 4)}.${Number(from.slice(5, 7))}.${Number(from.slice(8))}–${from.slice(0, 4) !== through.slice(0, 4) ? `${through.slice(0, 4)}.` : ""}${Number(through.slice(5, 7))}.${Number(through.slice(8))}`
              : monthTitle(date)}
        </h1>
        <SegmentedControl
          label="가계부 보기"
          appearance="contained"
          value={mode}
          onValueChange={changeMode}
          options={[
            { value: "week", label: "주" },
            { value: "month", label: "월" },
            { value: "recurring", label: "고정비" },
          ]}
        />
        <IconButton
          icon="plus"
          variant="primary"
          aria-label={mode === "recurring" ? "고정비 추가" : "수입·지출 추가"}
          disabled={disabled}
          onClick={() => openEditor({ kind: mode === "recurring" ? "recurring" : "entry" })}
        />
      </div>
      {visibleFailure && (
        <p className={s.error} role="alert">
          {visibleFailure}
        </p>
      )}
      <div className={s.columns}>
        <div className={s.column}>
          {mode !== "recurring" ? (
            <>
              <LedgerQuickAdd
                className={s.fullWidth}
                categories={categories.map((value) => ({ value: value.id, label: value.name }))}
                amount={quickAmount}
                category={quickCategory || categories[0]?.id}
                memo={quickTitle}
                onAmountChange={setQuickAmount}
                onCategoryChange={setQuickCategory}
                onMemoChange={setQuickTitle}
                disabled={disabled}
                onAdd={async () => {
                  const amount = ledgerAmount(quickAmount);
                  if (!amount || !quickTitle.trim()) {
                    setActionFailed(false);
                    setFailure("원 단위 금액과 어디에 썼는지 입력해 주세요.");
                    return;
                  }
                  if (
                    await run("ledger-entry-create", {
                      date,
                      kind: "expense",
                      amount,
                      category: quickCategory || categories[0]?.id,
                      title: quickTitle,
                      memo: "",
                    })
                  ) {
                    setQuickAmount("");
                    setQuickTitle("");
                  }
                }}
              />
              <div className={s.row}>
                <span className={`${s.caption} ${s.spread}`}>
                  {dayTitle(date)}에 기록해요 · 수입과 자세한 기록은 + 버튼
                </span>
                <Select
                  aria-label="기록 종류"
                  value={entryKind}
                  onChange={(event) => setEntryKind(event.target.value)}
                >
                  <option value="all">수입·지출</option>
                  <option value="expense">지출</option>
                  <option value="income">수입</option>
                </Select>
                <Select
                  aria-label="분류 필터"
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                >
                  <option value="all">모든 분류</option>
                  {categories.map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.name}
                    </option>
                  ))}
                </Select>
              </div>
              {dates.map((day) => {
                const dayEntries = visible.filter((entry) => entry.date === day);
                const dailyExpense = sum(dayEntries.filter((entry) => entry.kind === "expense"));
                const dailyIncome = sum(dayEntries.filter((entry) => entry.kind === "income"));
                return (
                  <section className={s.group} key={day} aria-label={dayTitle(day)}>
                    <LedgerDayHeader
                      title={dayTitle(day)}
                      amount={`${dailyIncome ? `수입 ${won(dailyIncome)} · ` : ""}${won(dailyExpense)}`}
                    />
                    <div className={s.rows}>
                      {dayEntries.map((entry) => (
                        <div className={s.entryRow} key={entry.id}>
                          <LedgerRow
                            {...categoryProps(categories, entry.category)}
                            className={s.entry}
                            title={entry.title}
                            description={[
                              categories.find((value) => value.id === entry.category)?.name,
                              entry.recurringId && "고정비",
                              entry.memo,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                            amount={
                              <span className={entry.kind === "income" ? s.income : undefined}>
                                {entry.kind === "income" && "+"}
                                {won(entry.amount)}
                              </span>
                            }
                          />
                          <IconButton
                            icon="edit"
                            variant="ghost"
                            aria-label={`${entry.title} 편집`}
                            disabled={disabled}
                            onClick={() => openEditor({ kind: "entry", value: entry })}
                          />
                        </div>
                      ))}
                    </div>
                  </section>
                );
              })}
              {!visible.length && <p className={s.card}>이 기간에 기록한 수입·지출이 없어요.</p>}
            </>
          ) : (
            <>
              <div className={s.row}>
                <p className={`${s.caption} ${s.spread}`}>
                  반복되는 지출을 미리 적어 두세요. 날짜가 되면 기록해요.
                </p>
                <Button
                  variant="ghost"
                  size="small"
                  disabled={disabled || monthStart(date) > localDay()}
                  onClick={() =>
                    void run("ledger-generate", {
                      fromDate: monthStart(date),
                      throughDate: monthEnd(date) < localDay() ? monthEnd(date) : localDay(),
                      includeManual: true,
                    })
                  }
                >
                  이번 달 기록하기
                </Button>
              </div>
              {FREQUENCIES.map((frequency) => {
                const values = recurring.filter((rule) => rule.frequency === frequency.value);
                if (!values.length) return null;
                return (
                  <section
                    className={s.group}
                    key={frequency.value}
                    aria-label={`${frequency.label} 고정비`}
                  >
                    <LedgerDayHeader
                      title={`${frequency.label} ${values.length}`}
                      amount={won(sum(values.filter((value) => value.enabled)))}
                    />
                    <div className={s.rows}>
                      {values.map((rule) => {
                        const next = upcoming.find((value) => value.rule.id === rule.id);
                        return (
                          <div className={s.entryRow} key={rule.id}>
                            <LedgerRecurringRow
                              {...categoryProps(categories, rule.category)}
                              className={s.entry}
                              title={rule.title}
                              description={`${recurringDescription(rule)} · ${rule.enabled ? (rule.autoRecord ? "자동 기록" : "확인 후 기록") : "일시 정지"}`}
                              amount={won(rule.amount)}
                              estimated={rule.estimated}
                              date={
                                next
                                  ? `${Number(next.date.slice(5, 7))}/${Number(next.date.slice(8))}`
                                  : "—"
                              }
                              dateDetail={next ? "다음 지출" : "예정 없음"}
                            />
                            <IconButton
                              icon="edit"
                              variant="ghost"
                              aria-label={`${rule.title} 고정비 편집`}
                              disabled={disabled}
                              onClick={() => openEditor({ kind: "recurring", value: rule })}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
              {!recurring.length && (
                <p className={s.card}>
                  아직 고정비가 없어요. 월세·통신비·구독처럼 반복되는 지출을 추가하세요.
                </p>
              )}
            </>
          )}
        </div>
        <aside className={s.sidebar} aria-label="가계부 요약">
          {mode === "recurring" ? (
            <>
              <section className={s.card}>
                <h2 className={s.heading}>{Number(date.slice(5, 7))}월 고정비</h2>
                <strong className={s.amount}>{won(planned)}</strong>
                <p className={s.caption}>
                  {monthlyOccurrences.length}건 예정 · 금액이 달라지는 항목은 예상 금액이에요.
                </p>
              </section>
              <Ledger12MonthForecast className={s.fullWidth} months={forecasts} />
              <Button variant="link" onClick={() => setShowTable((value) => !value)}>
                {showTable ? "표 접기" : "표로 보기"}
              </Button>
              {showTable && (
                <table className={s.forecastTable}>
                  <caption>앞으로 12달 고정비 예상</caption>
                  <thead>
                    <tr>
                      <th>월</th>
                      <th>예상 금액</th>
                    </tr>
                  </thead>
                  <tbody>
                    {forecasts.map((value) => (
                      <tr key={value.id}>
                        <td>{monthTitle(value.id)}</td>
                        <td>{value.valueLabel}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className={s.rows}>
                <div className={s.settingsRow}>
                  <span className={s.spread}>지출 전날 알림</span>
                  <Switch
                    aria-label="고정비 지출 전날 알림"
                    checked={settings.reminderEnabled}
                    disabled={disabled}
                    onChange={(event) =>
                      void run("ledger-settings-update", {
                        expected: settings,
                        settings: { ...settings, reminderEnabled: event.target.checked },
                      })
                    }
                  />
                </div>
                <div className={s.settingsRow}>
                  <span className={s.spread}>월 예산에 고정비 포함</span>
                  <Switch
                    aria-label="월 예산에 고정비 포함"
                    checked={settings.includeRecurring}
                    disabled={disabled}
                    onChange={(event) =>
                      void run("ledger-settings-update", {
                        expected: settings,
                        settings: { ...settings, includeRecurring: event.target.checked },
                      })
                    }
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <LedgerMonthlyBudget
                className={s.fullWidth}
                title={`${Number(date.slice(5, 7))}월 지출`}
                spent={spent}
                budget={settings.monthlyBudget}
                amountLabel={won(spent)}
                budgetLabel={
                  settings.monthlyBudget
                    ? `예산 ${won(settings.monthlyBudget)}`
                    : "예산을 설정해 보세요"
                }
                remainingLabel={
                  settings.monthlyBudget
                    ? `${won(Math.abs(settings.monthlyBudget - spent))} ${spent > settings.monthlyBudget ? "초과" : "남음"}`
                    : undefined
                }
                detail={`수입 ${won(sum(monthly.filter((entry) => entry.kind === "income")))} · 고정비 ${settings.includeRecurring ? "포함" : "제외"}`}
              />
              <section className={s.card}>
                <div className={s.row}>
                  <h2 className={`${s.heading} ${s.spread}`}>이번 달 고정비</h2>
                  <Button variant="link" size="small" onClick={() => changeMode("recurring")}>
                    모두 보기
                  </Button>
                </div>
                <strong className={s.amount}>{won(planned)}</strong>
                {monthlyOccurrences.slice(0, 4).map((value) => (
                  <div className={s.row} key={`${value.rule.id}-${value.occurrenceDate}`}>
                    <span className={s.caption}>{Number(value.date.slice(8))}일</span>
                    <span className={s.spread}>{value.rule.title}</span>
                    <span>
                      {value.rule.estimated && "약 "}
                      {won(value.rule.amount)}
                    </span>
                  </div>
                ))}
                {!monthlyOccurrences.length && (
                  <p className={s.caption}>이번 달 예정된 고정비가 없어요.</p>
                )}
              </section>
              <LedgerCategorySummary
                className={s.fullWidth}
                items={categories
                  .map((category) => ({
                    id: category.id,
                    label: category.name,
                    category: category.color,
                    amount: sum(expenses.filter((entry) => entry.category === category.id)),
                    amountLabel: won(
                      sum(expenses.filter((entry) => entry.category === category.id)),
                    ),
                  }))
                  .filter((value) => value.amount > 0)}
              />
              <div className={s.rows}>
                <div className={s.settingsRow}>
                  <span className={s.spread}>월 예산</span>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => openEditor({ kind: "settings" })}
                  >
                    {settings.monthlyBudget ? won(settings.monthlyBudget) : "설정하기"}
                  </Button>
                </div>
                <div className={s.settingsRow}>
                  <span className={s.spread}>분류 관리</span>
                  <Button
                    variant="ghost"
                    size="small"
                    onClick={() => openEditor({ kind: "settings" })}
                  >
                    편집
                  </Button>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
      {editor && (
        <LedgerEditor
          key={editorEpoch}
          editor={editor}
          date={date}
          settings={settings}
          entries={entries}
          recurring={recurring}
          busy={disabled}
          failure={visibleFailure}
          run={run}
          onReload={() => {
            if (editor.kind === "settings") openEditor(editor);
            else if (editor.kind === "entry")
              openEditor({
                kind: "entry",
                value: entries.find((value) => value.id === editor.value?.id),
              });
            else
              openEditor({
                kind: "recurring",
                value: recurring.find((value) => value.id === editor.value?.id),
              });
          }}
          onClose={() => setEditor(null)}
        />
      )}
    </section>
  );
}
