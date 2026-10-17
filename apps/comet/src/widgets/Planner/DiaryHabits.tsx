import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  Button,
  HabitMonthCalendar,
  HabitWeekTable,
  IconButton,
  SegmentedControl,
  Select,
  Switch,
  TextInput,
  Textarea,
  type HabitDayData,
  Dialog,
} from "@comet/ui";
import { errorText } from "../../hooks/useSnapshot";
import habitFeedbackBody from "../../assets/habit-feedback-body.svg";
import habitFeedbackSpark from "../../assets/habit-feedback-spark.svg";
import { localDay, type DataRecord } from "../toolData";
import type { DiaryAction, DiaryState } from "./diaryTypes";
import type { DiaryHabit, DiaryHabitCheck } from "./diaryHabitTypes";
import {
  habitDayState,
  habitMonthDates,
  habitRepeatLabel,
  habitScheduled,
  habitStatistics,
} from "./diaryHabitData";
import { dayDate, moveDay, movePeriod } from "./plannerData";
import * as s from "./diaryHabits.css";

const COLORS = [
  { value: "record", label: "노랑" },
  { value: "rest", label: "보라" },
  { value: "comet", label: "분홍" },
  { value: "exercise", label: "민트" },
  { value: "google", label: "파랑" },
  { value: "life", label: "코랄" },
] as const;

function blankHabit(): DiaryHabit {
  return {
    id: "",
    title: "",
    description: "",
    color: "record",
    weekdays: [0, 1, 2, 3, 4, 5, 6],
    weeklyGoal: 7,
    mode: "check",
    target: 1,
    startDate: localDay(),
    reminderTime: null,
    archived: false,
  };
}

export function DiaryHabits({
  state,
  date,
  onDateChange,
  onAction,
  busy,
  onDirtyChange,
}: {
  state: DiaryState;
  date: string;
  onDateChange?: (date: string) => void;
  onAction: DiaryAction;
  busy: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}): ReactElement {
  const [period, setPeriod] = useState("week");
  const [selectedId, setSelectedId] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [recordDate, setRecordDate] = useState(date);
  const [draft, setDraft] = useState<DiaryHabit | null>(null);
  const [original, setOriginal] = useState<DiaryHabit | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<DiaryHabit | null>(null);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");
  const pending = useRef(false);
  const disabled = busy || saving;
  const habits = state.habits ?? [];
  const checks = state.habitChecks ?? [];
  const visible = habits.filter((habit) => habit.archived === showArchived);
  const selected = visible.find((habit) => habit.id === selectedId) ?? visible[0];
  const stats = selected ? habitStatistics(selected, checks, date) : null;
  const dates =
    period === "week"
      ? Array.from({ length: 7 }, (_, index) => moveDay(date, index - 6))
      : habitMonthDates(date).filter((day): day is string => day !== null);
  const editorDirty = Boolean(
    draft && JSON.stringify(draft) !== JSON.stringify(original ?? blankHabit()),
  );
  const report = useRef(onDirtyChange);
  report.current = onDirtyChange;
  useEffect(() => {
    report.current?.(Boolean(draft || confirmDelete || saving));
  }, [draft, confirmDelete, saving]);
  useEffect(() => () => report.current?.(false), []);
  useEffect(() => setRecordDate(date), [date]);

  function checkFor(habit: DiaryHabit, day: string): DiaryHabitCheck | undefined {
    return checks.find((check) => check.habitId === habit.id && check.date === day);
  }
  async function run(action: string, input: DataRecord): Promise<boolean> {
    if (disabled || pending.current) return false;
    pending.current = true;
    setSaving(true);
    setFailure("");
    try {
      const result = await onAction(action, input);
      if (!result) setFailure("저장하지 못했어요. 입력한 내용은 유지했으니 다시 확인해 주세요.");
      return result;
    } catch (cause) {
      setFailure(errorText(cause));
      return false;
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  function edit(habit?: DiaryHabit): void {
    setOriginal(habit ?? null);
    setDraft(habit ? structuredClone(habit) : blankHabit());
    setFailure("");
  }
  function closeEditor(): void {
    if (disabled) return;
    if (editorDirty) setConfirmDiscard(true);
    else setDraft(null);
  }
  function dayData(habit: DiaryHabit, day: string): HabitDayData {
    const check = checkFor(habit, day);
    return {
      id: day,
      label: `${habit.title} ${day}`,
      state: habitDayState(habit, check),
      count: habit.mode === "count" && check ? check.count : undefined,
      today: day === localDay(),
      disabled:
        disabled || habit.archived || day > localDay() || (!check && !habitScheduled(habit, day)),
    };
  }
  async function record(
    habit: DiaryHabit,
    day: string,
    clear = false,
    count?: number,
  ): Promise<void> {
    const current = checkFor(habit, day);
    const data = dayData(habit, day);
    if (data.disabled) return;
    setSelectedId(habit.id);
    setRecordDate(day);
    let status = clear
      ? "clear"
      : habit.mode === "count"
        ? "done"
        : !current
          ? "done"
          : current.status === "done"
            ? "missed"
            : "clear";
    const nextCount = count ?? (current?.count ?? 0) + 1;
    if (habit.mode === "count" && nextCount <= 0) status = "clear";
    await run("habit-check", {
      habitId: habit.id,
      date: day,
      status,
      ...(habit.mode === "count" ? { count: nextCount } : {}),
      expectedCheck: current ?? null,
    });
  }
  const dateLabel =
    period === "week"
      ? `${dayDate(dates[0]).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })} – ${dayDate(date).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })}`
      : dayDate(date).toLocaleDateString("ko-KR", { year: "numeric", month: "long" });
  return (
    <section className={s.root} aria-label="습관 기록">
      <div className={s.toolbar}>
        <IconButton
          icon="chevleft"
          variant="surface"
          aria-label="이전 습관 기간"
          disabled={disabled || !onDateChange}
          onClick={() =>
            onDateChange?.(period === "week" ? moveDay(date, -7) : movePeriod(date, "month", -1))
          }
        />
        <Button
          variant="ghost"
          size="small"
          disabled={disabled || !onDateChange}
          onClick={() => onDateChange?.(localDay())}
        >
          오늘
        </Button>
        <IconButton
          icon="chev"
          variant="surface"
          aria-label="다음 습관 기간"
          disabled={disabled || !onDateChange}
          onClick={() =>
            onDateChange?.(period === "week" ? moveDay(date, 7) : movePeriod(date, "month", 1))
          }
        />
        <h1 className={s.range}>습관 · {dateLabel}</h1>
        <div className={s.spacer} />
        <SegmentedControl
          appearance="contained"
          label="습관 기간"
          value={period}
          options={[
            { value: "week", label: "7일" },
            { value: "month", label: "월" },
          ]}
          onValueChange={setPeriod}
        />
        <IconButton
          icon="plus"
          variant="primary"
          aria-label="새 습관"
          disabled={disabled}
          onClick={() => edit()}
        />
      </div>
      {failure && (
        <p role="alert" className={s.error}>
          {failure}
        </p>
      )}
      <div className={s.layout}>
        <div className={s.main}>
          <HabitWeekTable
            aria-label={showArchived ? "보관한 습관" : "습관 목록"}
            days={dates.map((day) => ({
              id: day,
              weekday: "일월화수목금토"[dayDate(day).getDay()],
              date: String(dayDate(day).getDate()),
              today: day === localDay(),
            }))}
            habits={visible.map((habit) => {
              const summary = habitStatistics(habit, checks, date);
              return {
                id: habit.id,
                title: (
                  <button
                    type="button"
                    className={s.titleButton}
                    aria-pressed={habit.id === selected?.id}
                    onClick={() => setSelectedId(habit.id)}
                  >
                    {habit.title}
                  </button>
                ),
                description:
                  habit.description ||
                  (habit.mode === "count"
                    ? `하루 ${habit.target}회 · 누를 때마다 1회`
                    : habitRepeatLabel(habit)),
                color: habit.color,
                selected: habit.id === selected?.id,
                kind:
                  habit.mode === "count"
                    ? "count"
                    : habit.weeklyGoal < habit.weekdays.length
                      ? "weekly"
                      : "daily",
                days: dates.map((day) => dayData(habit, day)),
                summary:
                  period === "week"
                    ? `${summary.recent}/${habit.weeklyGoal}`
                    : `${summary.month}일`,
                detail:
                  habit.mode === "count"
                    ? `오늘 ${checkFor(habit, localDay())?.count ?? 0}회`
                    : `연속 ${summary.streak}일`,
              };
            })}
            summaryLabel={period === "week" ? "최근 7일" : `${Number(date.slice(5, 7))}월`}
            onHabitDayChange={(id, day) => {
              const habit = habits.find((value) => value.id === id);
              if (habit) void record(habit, day.id);
            }}
            onAdd={() => edit()}
            disabled={disabled}
          />
          {!visible.length && (
            <p className={s.empty}>
              {showArchived
                ? "보관한 습관이 없어요."
                : "작게 시작하고 싶은 일을 새 습관으로 적어 보세요."}
            </p>
          )}
          <div className={s.feedback}>
            <span className={s.feedbackIcon} aria-hidden>
              <span className={s.feedbackCharacter}>
                <img className={s.feedbackBody} src={habitFeedbackBody} alt="" />
                <img className={s.feedbackSpark} src={habitFeedbackSpark} alt="" />
              </span>
            </span>
            <div className={s.spacer}>
              <strong>오늘 습관을 다 채우면 친구가 알아봐 줘요</strong>
              <p className={s.caption}>하루에 한 번만 말해요. 못 한 날은 말하지 않아요.</p>
            </div>
            <Switch
              aria-label="습관 완료하면 친구가 알려주기"
              checked={state.habitFeedbackEnabled ?? false}
              disabled={disabled}
              onChange={(event) =>
                void run("habit-settings", { feedbackEnabled: event.target.checked })
              }
            />
          </div>
          <Button variant="link" onClick={() => setShowArchived((value) => !value)}>
            {showArchived
              ? "진행 중인 습관 보기"
              : `보관한 습관 ${habits.filter((habit) => habit.archived).length}개 보기`}
          </Button>
        </div>
        {selected && stats && (
          <aside className={s.details} aria-label={`${selected.title} 습관 상세`}>
            <div className={s.toolbar}>
              <h2 className={s.detailTitle}>{selected.title}</h2>
              <Button
                variant="ghost"
                size="small"
                disabled={disabled}
                onClick={() => edit(selected)}
              >
                편집
              </Button>
            </div>
            <div className={s.statistics}>
              <div className={s.stat}>
                <strong className={s.statValue}>
                  {stats.recent}/{selected.weeklyGoal}
                </strong>
                <span>최근 7일</span>
              </div>
              <div className={s.stat}>
                <strong className={s.statValue}>{stats.month}일</strong>
                <span>{Number(date.slice(5, 7))}월</span>
              </div>
              <div className={s.stat}>
                <strong className={s.statValue}>{stats.longest}일</strong>
                <span>최장 연속</span>
              </div>
            </div>
            <HabitMonthCalendar
              aria-label={`${selected.title} 월별 기록`}
              label={`${Number(date.slice(5, 7))}월`}
              color={selected.color}
              days={habitMonthDates(date).map((day) =>
                day
                  ? {
                      ...dayData(selected, day),
                      day: dayDate(day).getDate(),
                      selected: day === recordDate,
                    }
                  : null,
              )}
              onDayChange={(day) => void record(selected, day.id)}
            />
            <div className={s.settings}>
              <div className={s.setting}>
                <span>목표</span>
                <Button
                  variant="ghost"
                  size="small"
                  disabled={disabled}
                  onClick={() => edit(selected)}
                >
                  {habitRepeatLabel(selected)}
                </Button>
              </div>
              <div className={s.setting}>
                <span>기록 방식</span>
                <Button
                  variant="ghost"
                  size="small"
                  disabled={disabled}
                  onClick={() => edit(selected)}
                >
                  {selected.mode === "count" ? `하루 ${selected.target}회` : "했어요 · 못 했어요"}
                </Button>
              </div>
              <div className={s.setting}>
                <span>알림</span>
                <Button
                  variant="ghost"
                  size="small"
                  disabled={disabled}
                  onClick={() => edit(selected)}
                >
                  {selected.reminderTime || "사용 안 함"}
                </Button>
              </div>
            </div>
            {checkFor(selected, recordDate) && !selected.archived && (
              <div className={s.recordControls}>
                <span className={s.caption}>{recordDate} 기록</span>
                {selected.mode === "count" && (
                  <Button
                    variant="ghost"
                    size="small"
                    disabled={disabled}
                    onClick={() =>
                      void record(
                        selected,
                        recordDate,
                        false,
                        (checkFor(selected, recordDate)?.count ?? 0) - 1,
                      )
                    }
                  >
                    1회 빼기
                  </Button>
                )}
                <Button
                  variant="link"
                  disabled={disabled}
                  onClick={() => void record(selected, recordDate, true)}
                >
                  기록 지우기
                </Button>
              </div>
            )}
            <Button
              variant="link"
              disabled={disabled}
              onClick={() =>
                void run("habit-archive", {
                  id: selected.id,
                  archived: !selected.archived,
                  expectedHabit: selected,
                })
              }
            >
              {selected.archived ? "습관 다시 시작하기" : "습관 보관하기…"}
            </Button>
            {selected.archived && (
              <Button
                variant="danger"
                size="small"
                disabled={disabled}
                onClick={() => setConfirmDelete(selected)}
              >
                습관 영구 삭제
              </Button>
            )}
          </aside>
        )}
      </div>
      {draft && (
        <Dialog
          isOpen
          title={draft.id ? "습관 편집" : "새 습관"}
          closeLabel="습관 편집 닫기"
          onOpenChange={(open) => {
            if (!open) closeEditor();
          }}
        >
          <form
            className={s.form}
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                await run(draft.id ? "habit-update" : "habit-create", {
                  ...draft,
                  ...(original ? { expectedHabit: original } : {}),
                })
              ) {
                setDraft(null);
                setOriginal(null);
              }
            }}
          >
            <TextInput
              label="습관 이름"
              value={draft.title}
              maxLength={200}
              required
              disabled={disabled}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
            <Textarea
              label="습관 설명"
              value={draft.description}
              maxLength={1000}
              disabled={disabled}
              onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            />
            <Select
              label="습관 색상"
              className={s.formSelect}
              value={draft.color}
              disabled={disabled}
              onChange={(event) =>
                setDraft({ ...draft, color: event.target.value as DiaryHabit["color"] })
              }
            >
              {COLORS.map((color) => (
                <option key={color.value} value={color.value}>
                  {color.label}
                </option>
              ))}
            </Select>
            <fieldset className={s.weekdays} disabled={disabled}>
              <legend>반복 요일</legend>
              {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                <label key={day} className={s.weekday}>
                  <input
                    className={s.weekdayCheckbox}
                    type="checkbox"
                    checked={draft.weekdays.includes(day)}
                    onChange={(event) => {
                      const weekdays = event.target.checked
                        ? [...draft.weekdays, day]
                        : draft.weekdays.filter((value) => value !== day);
                      setDraft({
                        ...draft,
                        weekdays,
                        weeklyGoal: Math.min(draft.weeklyGoal, Math.max(1, weekdays.length)),
                      });
                    }}
                  />
                  {"일월화수목금토"[day]}
                </label>
              ))}
            </fieldset>
            <TextInput
              label="일주일 목표 횟수"
              type="number"
              min={1}
              max={Math.max(1, draft.weekdays.length)}
              required
              value={draft.weeklyGoal}
              disabled={disabled}
              onChange={(event) => setDraft({ ...draft, weeklyGoal: Number(event.target.value) })}
            />
            <Select
              label="기록 방식"
              className={s.formSelect}
              value={draft.mode}
              disabled={disabled}
              onChange={(event) =>
                setDraft({ ...draft, mode: event.target.value as DiaryHabit["mode"], target: 1 })
              }
            >
              <option value="check">했어요 · 못 했어요</option>
              <option value="count">횟수 세기</option>
            </Select>
            {draft.mode === "count" && (
              <TextInput
                label="하루 목표 횟수"
                type="number"
                min={1}
                max={10000}
                required
                value={draft.target}
                disabled={disabled}
                onChange={(event) => setDraft({ ...draft, target: Number(event.target.value) })}
              />
            )}
            <TextInput
              label="시작일"
              type="date"
              required
              value={draft.startDate}
              disabled={disabled}
              onChange={(event) => setDraft({ ...draft, startDate: event.target.value })}
            />
            <TextInput
              label="알림 시각"
              type="time"
              value={draft.reminderTime ?? ""}
              disabled={disabled}
              onChange={(event) => setDraft({ ...draft, reminderTime: event.target.value || null })}
            />
            <p className={s.caption}>
              알림 시각을 비우면 알림을 끕니다. 집중 중이거나 자동 대화를 꺼 둔 동안에는 말을 걸지
              않아요.
            </p>
            {failure && (
              <p role="alert" className={s.error}>
                {failure}
              </p>
            )}
            <div className={s.toolbar}>
              <Button variant="ghost" disabled={disabled} onClick={closeEditor}>
                취소
              </Button>
              <Button type="submit" disabled={disabled || !draft.weekdays.length}>
                저장
              </Button>
            </div>
          </form>
        </Dialog>
      )}
      <Dialog
        variant="confirm"
        isOpen={confirmDiscard}
        title="습관 변경 내용을 버릴까요?"
        onOpenChange={setConfirmDiscard}
      >
        <div className={s.toolbar}>
          <Button variant="ghost" onClick={() => setConfirmDiscard(false)}>
            계속 편집
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              setConfirmDiscard(false);
              setDraft(null);
              setOriginal(null);
            }}
          >
            변경 버리기
          </Button>
        </div>
      </Dialog>
      <Dialog
        variant="confirm"
        isOpen={Boolean(confirmDelete)}
        title="습관과 기록을 영구 삭제할까요?"
        onOpenChange={(open) => {
          if (!open && !disabled) setConfirmDelete(null);
        }}
      >
        <p>이 습관에 남긴 날짜별 기록도 삭제돼요.</p>
        <div className={s.toolbar}>
          <Button variant="ghost" disabled={disabled} onClick={() => setConfirmDelete(null)}>
            취소
          </Button>
          <Button
            variant="danger"
            disabled={disabled}
            onClick={async () => {
              if (
                confirmDelete &&
                (await run("habit-delete", { id: confirmDelete.id, expectedHabit: confirmDelete }))
              )
                setConfirmDelete(null);
            }}
          >
            영구 삭제
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
