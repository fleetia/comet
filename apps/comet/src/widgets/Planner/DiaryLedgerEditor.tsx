import { useState, type ReactElement, type ReactNode } from "react";
import {
  Button,
  Checkbox,
  IconButton,
  SegmentedControl,
  Select,
  TextInput,
  Textarea,
  Dialog,
} from "@comet/ui";
import type { DataRecord } from "../toolData";
import {
  LEDGER_CATEGORIES,
  type DiaryLedgerCategory,
  type LedgerEntry,
  type LedgerSettings,
  type RecurringExpense,
} from "./diaryLedgerTypes";
import { FREQUENCIES, ledgerAmount, ledgerOccurrences, won, yearThrough } from "./diaryLedgerData";
import { dayDate } from "./plannerData";
import * as s from "./diaryLedger.css";

export type LedgerEditorTarget =
  | { kind: "entry"; value?: LedgerEntry }
  | { kind: "recurring"; value?: RecurringExpense }
  | { kind: "settings" };

const DAYS = ["월", "화", "수", "목", "금", "토", "일"];

function FormRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.formRow}>
      <span className={s.label}>{label}</span>
      <div className={s.column}>{children}</div>
    </div>
  );
}

export function LedgerEditor({
  editor,
  date,
  settings,
  entries,
  recurring,
  busy,
  failure,
  run,
  onReload,
  onClose,
}: {
  editor: LedgerEditorTarget;
  date: string;
  settings: LedgerSettings;
  entries: LedgerEntry[];
  recurring: RecurringExpense[];
  busy: boolean;
  failure: string;
  run: (action: string, input: DataRecord) => Promise<boolean>;
  onReload: () => void;
  onClose: () => void;
}): ReactElement {
  const [originalSettings] = useState(settings);
  const [original] = useState(editor.kind === "settings" ? undefined : editor.value);
  const [kind, setKind] = useState(
    editor.kind === "entry" ? (editor.value?.kind ?? "expense") : "expense",
  );
  const [title, setTitle] = useState(original?.title ?? "");
  const [amount, setAmount] = useState(String(original?.amount ?? ""));
  const [category, setCategory] = useState(
    original?.category ?? settings.categories[0]?.id ?? "other",
  );
  const [entryDate, setEntryDate] = useState(
    editor.kind === "entry" ? (editor.value?.date ?? date) : date,
  );
  const [memo, setMemo] = useState(editor.kind === "entry" ? (editor.value?.memo ?? "") : "");
  const initialRule = editor.kind === "recurring" ? editor.value : undefined;
  const [rule, setRule] = useState<
    Omit<RecurringExpense, "id" | "title" | "amount" | "category" | "recordedDates">
  >({
    estimated: initialRule?.estimated ?? false,
    frequency: initialRule?.frequency ?? "monthly",
    interval: initialRule?.interval ?? 2,
    day: initialRule?.day ?? Number(date.slice(8)),
    weekday: initialRule?.weekday ?? (dayDate(date).getDay() + 6) % 7,
    months: initialRule?.months ?? [Number(date.slice(5, 7))],
    startDate: initialRule?.startDate ?? date,
    endDate: initialRule?.endDate ?? null,
    weekend: initialRule?.weekend ?? "keep",
    autoRecord: initialRule?.autoRecord ?? true,
    enabled: initialRule?.enabled ?? true,
  });
  const [budget, setBudget] = useState(String(settings.monthlyBudget || ""));
  const [categories, setCategories] = useState(settings.categories);
  const [changed, setChanged] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [reload, setReload] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [validation, setValidation] = useState("");
  const previewRule: RecurringExpense = {
    ...rule,
    id: "preview",
    title,
    amount: ledgerAmount(amount) ?? 0,
    category,
    recordedDates: [],
  };
  const preview = ledgerOccurrences([previewRule], rule.startDate, yearThrough(rule.startDate));
  const latest =
    editor.kind === "entry"
      ? entries.find((value) => value.id === original?.id)
      : recurring.find((value) => value.id === original?.id);
  const stale =
    editor.kind === "settings"
      ? JSON.stringify(originalSettings) !== JSON.stringify(settings)
      : Boolean(
          original &&
          (editor.kind === "recurring"
            ? JSON.stringify({ ...original, recordedDates: [] }) !==
              JSON.stringify(latest && { ...latest, recordedDates: [] })
            : JSON.stringify(original) !== JSON.stringify(latest)),
        );
  const caption =
    editor.kind === "settings"
      ? "가계부 설정"
      : editor.kind === "recurring"
        ? `고정비 ${original ? "편집" : "추가"}`
        : `수입·지출 ${original ? "편집" : "추가"}`;
  function close() {
    if (!busy) {
      if (changed) {
        setReload(false);
        setDiscard(true);
      } else onClose();
    }
  }
  async function save() {
    setValidation("");
    if (stale) {
      setValidation("다른 화면에서 내용이 바뀌었어요. 최신 내용을 다시 불러온 뒤 저장해 주세요.");
      return;
    }
    if (editor.kind === "settings") {
      const nextBudget = budget.trim() === "" || budget.trim() === "0" ? 0 : ledgerAmount(budget);
      if (nextBudget === null || categories.some((value) => !value.name.trim())) {
        setValidation("원 단위 예산과 분류 이름을 확인해 주세요.");
        return;
      }
      if (
        await run("ledger-settings-update", {
          expected: originalSettings,
          settings: { ...originalSettings, monthlyBudget: nextBudget, categories },
        })
      )
        onClose();
      return;
    }
    const value = ledgerAmount(amount);
    if (!value || !title.trim()) {
      setValidation("이름과 원 단위 금액을 입력해 주세요.");
      return;
    }
    if (editor.kind === "recurring" && rule.frequency === "months" && !rule.months.length) {
      setValidation("반복할 달을 하나 이상 선택해 주세요.");
      return;
    }
    const input: DataRecord = {
      title,
      amount: value,
      category,
      ...(original ? { id: original.id, expected: original } : {}),
      ...(editor.kind === "entry" ? { kind, date: entryDate, memo } : rule),
    };
    if (await run(`ledger-${editor.kind}-${original ? "update" : "create"}`, input)) onClose();
  }
  return (
    <>
      <Dialog
        isOpen
        className={s.editorDialog}
        title={caption}
        closeLabel={`${caption} 닫기`}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <form
          className={s.form}
          onChange={() => setChanged(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && event.nativeEvent.isComposing) event.preventDefault();
          }}
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {editor.kind === "settings" ? (
            <>
              <FormRow label="월 예산">
                <TextInput
                  aria-label="월 예산 (원)"
                  inputMode="numeric"
                  value={budget}
                  maxLength={16}
                  onChange={(event) => setBudget(event.target.value)}
                  disabled={busy}
                  placeholder="0 · 예산 없음"
                />
              </FormRow>
              <FormRow label="분류">
                {categories.map((value) => {
                  const used =
                    entries.some((entry) => entry.category === value.id) ||
                    recurring.some((entry) => entry.category === value.id);
                  return (
                    <div key={value.id} className={s.row}>
                      <TextInput
                        className={s.spread}
                        aria-label={`${value.name || "새 분류"} 이름`}
                        value={value.name}
                        required
                        maxLength={30}
                        disabled={busy}
                        onChange={(event) =>
                          setCategories((current) =>
                            current.map((item) =>
                              item.id === value.id ? { ...item, name: event.target.value } : item,
                            ),
                          )
                        }
                      />
                      <Select
                        aria-label={`${value.name || "새 분류"} 색상`}
                        value={value.color}
                        disabled={busy}
                        onChange={(event) =>
                          setCategories((current) =>
                            current.map((item) =>
                              item.id === value.id
                                ? {
                                    ...item,
                                    color: event.target.value as DiaryLedgerCategory["color"],
                                  }
                                : item,
                            ),
                          )
                        }
                      >
                        {LEDGER_CATEGORIES.filter((item) => item.id !== "other").map((item) => (
                          <option key={item.id} value={item.color}>
                            {item.name}
                          </option>
                        ))}
                      </Select>
                      <IconButton
                        icon="remove"
                        variant="ghost"
                        aria-label={`${value.name} 분류 삭제`}
                        disabled={busy || used || categories.length <= 1}
                        title={used ? "사용 중인 분류예요" : undefined}
                        onClick={() => {
                          setChanged(true);
                          setCategories((current) =>
                            current.filter((item) => item.id !== value.id),
                          );
                        }}
                      />
                    </div>
                  );
                })}
                <Button
                  variant="ghost"
                  disabled={busy || categories.length >= 50}
                  onClick={() => {
                    setChanged(true);
                    setCategories((current) => [
                      ...current,
                      { id: crypto.randomUUID(), name: "", color: "living" },
                    ]);
                  }}
                >
                  분류 추가
                </Button>
                <p className={s.caption}>기록이나 고정비에 사용 중인 분류는 삭제할 수 없어요.</p>
              </FormRow>
            </>
          ) : (
            <>
              {editor.kind === "entry" && (
                <FormRow label="종류">
                  <SegmentedControl
                    label="수입 또는 지출"
                    disabled={busy}
                    value={kind}
                    onValueChange={(value) => {
                      setChanged(true);
                      setKind(value as "expense" | "income");
                    }}
                    options={[
                      { value: "expense", label: "지출" },
                      { value: "income", label: "수입" },
                    ]}
                  />
                </FormRow>
              )}
              <FormRow label="이름">
                <TextInput
                  aria-label="기록 이름"
                  value={title}
                  required
                  maxLength={500}
                  disabled={busy}
                  placeholder={
                    editor.kind === "recurring" ? "예: 월세, 휴대폰 요금" : "어디에 썼나요?"
                  }
                  onChange={(event) => setTitle(event.target.value)}
                />
              </FormRow>
              <FormRow label="금액">
                <div className={s.row}>
                  <TextInput
                    className={s.spread}
                    aria-label="기록 금액 (원)"
                    inputMode="numeric"
                    value={amount}
                    maxLength={16}
                    required
                    disabled={busy}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                  <span>원</span>
                </div>
                {editor.kind === "recurring" && (
                  <Checkbox
                    label="매번 달라요 · 예상 금액으로 기록"
                    checked={rule.estimated}
                    disabled={busy}
                    onChange={(event) =>
                      setRule((value) => ({ ...value, estimated: event.target.checked }))
                    }
                  />
                )}
              </FormRow>
              <FormRow label="분류">
                <Select
                  aria-label="기록 분류"
                  value={category}
                  disabled={busy}
                  onChange={(event) => setCategory(event.target.value)}
                >
                  {settings.categories.map((value) => (
                    <option key={value.id} value={value.id}>
                      {value.name}
                    </option>
                  ))}
                </Select>
              </FormRow>
              {editor.kind === "entry" ? (
                <>
                  <FormRow label="날짜">
                    <TextInput
                      type="date"
                      aria-label="기록 날짜"
                      required
                      value={entryDate}
                      disabled={busy}
                      onChange={(event) => setEntryDate(event.target.value)}
                    />
                  </FormRow>
                  <FormRow label="메모">
                    <Textarea
                      aria-label="기록 메모"
                      value={memo}
                      maxLength={20000}
                      disabled={busy}
                      onChange={(event) => setMemo(event.target.value)}
                    />
                  </FormRow>
                </>
              ) : (
                <>
                  <FormRow label="반복">
                    <SegmentedControl
                      label="고정비 반복 주기"
                      disabled={busy}
                      value={rule.frequency}
                      options={FREQUENCIES}
                      onValueChange={(value) => {
                        setChanged(true);
                        setRule((current) => ({
                          ...current,
                          frequency: value as RecurringExpense["frequency"],
                        }));
                      }}
                    />
                    {rule.frequency === "interval" && (
                      <div className={s.row}>
                        <TextInput
                          aria-label="반복 간격"
                          type="number"
                          min={1}
                          max={120}
                          value={rule.interval}
                          disabled={busy}
                          onChange={(event) =>
                            setRule((value) => ({ ...value, interval: Number(event.target.value) }))
                          }
                        />
                        <span>개월마다</span>
                      </div>
                    )}
                    {rule.frequency === "months" && (
                      <div className={s.months}>
                        {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                          <Button
                            key={month}
                            size="small"
                            variant={rule.months.includes(month) ? "selected" : "ghost"}
                            aria-pressed={rule.months.includes(month)}
                            disabled={busy}
                            onClick={() => {
                              setChanged(true);
                              setRule((value) => ({
                                ...value,
                                months: value.months.includes(month)
                                  ? value.months.filter((item) => item !== month)
                                  : [...value.months, month].sort((a, b) => a - b),
                              }));
                            }}
                          >
                            {month}월
                          </Button>
                        ))}
                      </div>
                    )}
                  </FormRow>
                  <FormRow label="날짜">
                    <div className={s.row}>
                      {rule.frequency === "weekly" ? (
                        <Select
                          aria-label="고정비 요일"
                          value={rule.weekday}
                          disabled={busy}
                          onChange={(event) =>
                            setRule((value) => ({ ...value, weekday: Number(event.target.value) }))
                          }
                        >
                          {DAYS.map((day, index) => (
                            <option key={day} value={index}>
                              {day}요일
                            </option>
                          ))}
                        </Select>
                      ) : (
                        <Select
                          aria-label="고정비 날짜"
                          value={rule.day}
                          disabled={busy}
                          onChange={(event) =>
                            setRule((value) => ({ ...value, day: Number(event.target.value) }))
                          }
                        >
                          {Array.from({ length: 31 }, (_, index) => (
                            <option key={index + 1} value={index + 1}>
                              {index + 1}일
                            </option>
                          ))}
                        </Select>
                      )}
                      <Select
                        aria-label="주말 처리"
                        value={rule.weekend}
                        disabled={busy}
                        onChange={(event) =>
                          setRule((value) => ({
                            ...value,
                            weekend: event.target.value as RecurringExpense["weekend"],
                          }))
                        }
                      >
                        <option value="keep">주말에도 그대로</option>
                        <option value="before">주말이면 전 금요일</option>
                        <option value="after">주말이면 다음 월요일</option>
                      </Select>
                    </div>
                    <p className={s.caption}>
                      {rule.frequency === "yearly" ? "시작 날짜의 달에 매년 반복해요. " : ""}선택한
                      날짜가 없는 달에는 마지막 날에 기록해요.
                    </p>
                  </FormRow>
                  <FormRow label="기간">
                    <div className={s.row}>
                      <TextInput
                        aria-label="고정비 시작 날짜"
                        type="date"
                        value={rule.startDate}
                        required
                        disabled={busy}
                        onChange={(event) =>
                          setRule((value) => ({ ...value, startDate: event.target.value }))
                        }
                      />
                      <span>~</span>
                      <TextInput
                        aria-label="고정비 종료 날짜"
                        type="date"
                        value={rule.endDate ?? ""}
                        min={rule.startDate}
                        disabled={busy}
                        onChange={(event) =>
                          setRule((value) => ({ ...value, endDate: event.target.value || null }))
                        }
                      />
                    </div>
                    <p className={s.caption}>종료 날짜를 비우면 계속 반복해요.</p>
                  </FormRow>
                  <FormRow label="기록">
                    <Select
                      aria-label="고정비 기록 방식"
                      value={rule.autoRecord ? "auto" : "manual"}
                      disabled={busy}
                      onChange={(event) =>
                        setRule((value) => ({
                          ...value,
                          autoRecord: event.target.value === "auto",
                        }))
                      }
                    >
                      <option value="auto">날짜가 되면 바로 기록</option>
                      <option value="manual">알림 후 확인하고 기록</option>
                    </Select>
                    {original && (
                      <Checkbox
                        label="고정비 활성화"
                        checked={rule.enabled}
                        disabled={busy}
                        onChange={(event) =>
                          setRule((value) => ({ ...value, enabled: event.target.checked }))
                        }
                      />
                    )}
                  </FormRow>
                  <section className={s.card} aria-label="고정비 미리보기">
                    <h3 className={s.heading}>앞으로 이렇게 기록돼요</h3>
                    <p className={s.caption}>
                      {preview.length
                        ? preview
                            .slice(0, 4)
                            .map((value) => value.date)
                            .join(" · ")
                        : "다음 1년 동안 예정된 기록이 없어요."}
                    </p>
                    <strong>
                      앞으로 1년{" "}
                      {won(preview.reduce((total, value) => total + value.rule.amount, 0))}
                    </strong>
                    <p className={s.caption}>매번 달라지는 금액은 기록에서 수정할 수 있어요.</p>
                  </section>
                </>
              )}
            </>
          )}
          {stale && (
            <div className={s.card}>
              <p className={s.caption}>
                다른 화면에서 내용이 바뀌었어요. 입력 내용은 아직 남아 있어요.
              </p>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  if (changed) {
                    setReload(true);
                    setDiscard(true);
                  } else onReload();
                }}
              >
                최신 내용 다시 불러오기
              </Button>
            </div>
          )}
          {(validation || failure) && (
            <p role="alert" className={s.error}>
              {validation || failure}
            </p>
          )}
          <div className={s.actions}>
            {original && (
              <Button variant="danger" disabled={busy} onClick={() => setDeleting(true)}>
                삭제
              </Button>
            )}
            <span className={s.spread} />
            <Button variant="ghost" disabled={busy} onClick={close}>
              취소
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "저장 중…" : original || editor.kind === "settings" ? "저장" : "추가"}
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog variant="confirm" isOpen={discard} title="변경 내용을 버릴까요?" onOpenChange={setDiscard}>
        <p>아직 저장하지 않은 입력 내용이 있어요.</p>
        <div className={s.actions}>
          <Button variant="ghost" onClick={() => setDiscard(false)}>
            계속 편집
          </Button>
          <Button variant="danger" onClick={reload ? onReload : onClose}>
            변경 버리기
          </Button>
        </div>
      </Dialog>
      <Dialog
        variant="confirm"
        isOpen={deleting}
        title={editor.kind === "recurring" ? "고정비를 삭제할까요?" : "기록을 삭제할까요?"}
        onOpenChange={(open) => {
          if (!busy) setDeleting(open);
        }}
      >
        <p>
          {editor.kind === "recurring"
            ? "이미 가계부에 남긴 지출 기록은 유지돼요."
            : "삭제한 기록은 되돌릴 수 없어요."}
        </p>
        <div className={s.actions}>
          <Button variant="ghost" disabled={busy} onClick={() => setDeleting(false)}>
            취소
          </Button>
          <Button
            variant="danger"
            disabled={busy}
            onClick={async () => {
              if (
                original &&
                (await run(`ledger-${editor.kind}-delete`, { id: original.id, expected: original }))
              )
                onClose();
            }}
          >
            삭제하기
          </Button>
        </div>
      </Dialog>
    </>
  );
}
