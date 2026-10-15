import { useEffect, useRef, useState, type JSX } from "react";
import {
  Button,
  CalendarDayRing,
  CategoryChoice,
  Select,
  Surface,
  TextInput,
  type CalendarRingSegment,
} from "@comet/ui";
import { localDay, type DataRecord } from "../toolData";
import type { DiaryAction, DiaryState } from "./diaryTypes";
import type { DiaryTimeCategory, DiaryTimeColor, DiaryTimeRecord } from "./diaryTimeTypes";
import {
  diaryTimeCategories,
  diaryTimeRecords,
  manualTimeSegments,
  parseTimeInput,
  recordedTimeMinutes,
  timeDuration,
  timeInput,
} from "./diaryTime";
import * as s from "./diaryTime.css";

type Draft = {
  record?: DiaryTimeRecord;
  start: string;
  end: string;
  title: string;
  categoryId: string;
  direct: boolean;
};
type CategoryDraft = {
  category?: DiaryTimeCategory;
  name: string;
  color: DiaryTimeColor;
  reassignTo: string;
};
const colors: { value: DiaryTimeColor; label: string }[] = [
  { value: "work", label: "파랑" },
  { value: "record", label: "노랑" },
  { value: "life", label: "주황" },
  { value: "exercise", label: "초록" },
  { value: "rest", label: "보라" },
  { value: "focus", label: "민트" },
];

export function DiaryTimeEditor({
  state,
  date,
  onAction,
  busy,
  onDirtyChange,
  additionalSegments = [],
  onAdditionalSegmentClick,
  currentMinute,
  className,
}: {
  state: DiaryState;
  date: string;
  onAction: DiaryAction;
  busy: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  additionalSegments?: readonly CalendarRingSegment[];
  onAdditionalSegmentClick?: (segment: CalendarRingSegment) => void;
  currentMinute?: number;
  className?: string;
}): JSX.Element {
  const categories = diaryTimeCategories(state);
  const records = diaryTimeRecords(state, date);
  const [selected, setSelected] = useState(categories[0]?.id ?? "work");
  const [draft, setDraft] = useState<Draft>();
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft>();
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const pending = useRef(false);
  const report = useRef(onDirtyChange);
  report.current = onDirtyChange;
  const disabled = busy || working;
  const hasDraft = Boolean(draft || categoryDraft);
  useEffect(() => {
    report.current?.(hasDraft);
  }, [hasDraft]);
  useEffect(
    () => () => {
      report.current?.(false);
    },
    [],
  );
  const today = localDay(new Date());
  const elapsed =
    date < today
      ? 1440
      : date > today
        ? 0
        : (currentMinute ?? new Date().getHours() * 60 + new Date().getMinutes());
  const manual = manualTimeSegments(state, date, elapsed);
  const segments = [
    ...manual.map((segment) => ({ ...segment, interactive: false })),
    ...additionalSegments,
  ];
  const start = draft ? parseTimeInput(draft.start) : null;
  const end = draft ? parseTimeInput(draft.end, true) : null;
  const validRange = start !== null && end !== null && end > start;
  const overlap =
    validRange &&
    records.some(
      (record) =>
        record.id !== draft?.record?.id && record.startMinute < end && record.endMinute > start,
    );

  function close(): void {
    setDraft(undefined);
    setCategoryDraft(undefined);
    setError("");
    setConfirmDiscard(false);
    setConfirmDelete(false);
  }
  function openRange(range: { startMinute: number; endMinute: number }, direct = false): void {
    if (disabled || hasDraft) {
      return;
    }
    setDraft({
      start: timeInput(range.startMinute),
      end: timeInput(range.endMinute),
      title: "",
      categoryId: categories.some((category) => category.id === selected)
        ? selected
        : categories[0].id,
      direct,
    });
    setError("");
  }
  function edit(record: DiaryTimeRecord): void {
    if (disabled || hasDraft) {
      return;
    }
    setDraft({
      record,
      start: timeInput(record.startMinute),
      end: timeInput(record.endMinute),
      title: record.title,
      categoryId: record.categoryId,
      direct: true,
    });
    setError("");
  }
  async function persist(action: string, input: DataRecord): Promise<void> {
    if (disabled || pending.current) {
      return;
    }
    pending.current = true;
    setWorking(true);
    setError("");
    try {
      if (await onAction(action, input)) {
        close();
      } else {
        setError("저장하지 못했어요. 입력을 유지했으니 다시 시도해 주세요.");
      }
    } catch {
      setError("저장하지 못했어요. 입력을 유지했으니 다시 시도해 주세요.");
    } finally {
      pending.current = false;
      setWorking(false);
    }
  }
  function saveTime(): void {
    if (!draft) {
      return;
    }
    if (!validRange) {
      setError(
        "시작과 종료를 10분 단위로 입력해 주세요. 24:00은 종료에만 쓰며, 자정을 넘으면 날짜별로 나누어 칠해 주세요.",
      );
      return;
    }
    void persist("time-record-save", {
      ...(draft.record ? { id: draft.record.id, expectedRecord: draft.record } : {}),
      date,
      startMinute: start,
      endMinute: end,
      categoryId: draft.categoryId,
      title: draft.title,
    });
  }
  const toolbar = (
    <div className={s.toolbar}>
      <span>칠할 분류</span>
      {categories.map((category) => (
        <CategoryChoice
          key={category.id}
          category={category.color}
          selected={selected === category.id}
          disabled={disabled || hasDraft}
          onClick={() => setSelected(category.id)}
        >
          {category.name}
        </CategoryChoice>
      ))}
      <Button
        size="small"
        variant="link"
        disabled={disabled || hasDraft}
        onClick={() => openRange({ startMinute: 540, endMinute: 600 }, true)}
      >
        시간 입력
      </Button>
      <Button
        size="small"
        variant="link"
        disabled={disabled || hasDraft}
        onClick={() =>
          setCategoryDraft({
            category: categories[0],
            name: categories[0].name,
            color: categories[0].color,
            reassignTo: categories[1]?.id ?? "",
          })
        }
      >
        분류 관리
      </Button>
      <span className={s.hint}>한 칸 = 10분 · 원을 따라 끌어서 칠해요</span>
    </div>
  );
  const overlay = hasDraft ? (
    <Surface
      variant="popover"
      className={s.popup}
      role="dialog"
      aria-label={draft ? "시간 칠하기" : "시간 분류 관리"}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !disabled) {
          event.stopPropagation();
          setConfirmDiscard(true);
        }
      }}
    >
      {draft && (
        <>
          <div>
            <h3 className={s.heading}>
              {draft.start} – {draft.end}
            </h3>
            <p className={s.meta}>
              {validRange ? timeDuration(end - start) : "시간을 확인해 주세요"}
              {validRange && start >= elapsed ? " · 예정으로 칠해요" : ""}
            </p>
          </div>
          <div className={s.choices}>
            {categories.map((category) => (
              <CategoryChoice
                key={category.id}
                category={category.color}
                size="compact"
                selected={draft.categoryId === category.id}
                disabled={disabled}
                onClick={() => setDraft({ ...draft, categoryId: category.id })}
              >
                {category.name}
              </CategoryChoice>
            ))}
          </div>
          <TextInput
            aria-label="시간 기록 제목"
            placeholder="어떤 시간이었나요? (선택)"
            maxLength={500}
            value={draft.title}
            autoFocus
            disabled={disabled}
            className={s.input}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
          />
          <details open={draft.direct}>
            <summary className={s.meta}>시간 수정</summary>
            <div className={s.timeFields}>
              <TextInput
                label="시작"
                aria-label="시작 시각"
                value={draft.start}
                inputMode="numeric"
                placeholder="09:00"
                disabled={disabled}
                className={s.input}
                onChange={(event) =>
                  setDraft({ ...draft, start: event.target.value, direct: true })
                }
              />
              <TextInput
                label="종료"
                aria-label="종료 시각"
                value={draft.end}
                inputMode="numeric"
                placeholder="10:00"
                disabled={disabled}
                className={s.input}
                onChange={(event) => setDraft({ ...draft, end: event.target.value, direct: true })}
              />
            </div>
          </details>
          {overlap && (
            <p className={s.meta}>겹치는 시간은 새 분류로 칠하고, 나머지 기록은 유지해요.</p>
          )}
          <div className={s.actions}>
            <Button
              size="small"
              variant="ghost"
              disabled={disabled}
              onClick={() => setConfirmDiscard(true)}
            >
              취소
            </Button>
            <Button size="small" disabled={disabled} onClick={saveTime}>
              {draft.record ? "수정" : "칠하기"}
            </Button>
            {draft.record && (
              <Button
                size="small"
                variant="danger"
                disabled={disabled}
                onClick={() => setConfirmDelete(true)}
              >
                삭제
              </Button>
            )}
          </div>
        </>
      )}
      {categoryDraft && (
        <>
          <h3 className={s.heading}>시간 분류</h3>
          <Select
            label="수정할 분류"
            value={categoryDraft.category?.id ?? "new"}
            disabled={disabled}
            onChange={(event) => {
              if (
                categoryDraft.name !== (categoryDraft.category?.name ?? "") ||
                categoryDraft.color !== (categoryDraft.category?.color ?? "work")
              ) {
                setError("바꾼 분류를 먼저 저장하거나 닫은 뒤 다른 분류를 선택해 주세요.");
                return;
              }
              const category = categories.find((item) => item.id === event.target.value);
              setCategoryDraft({
                category,
                name: category?.name ?? "",
                color: category?.color ?? "work",
                reassignTo: categories.find((item) => item.id !== category?.id)?.id ?? "",
              });
            }}
          >
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
            <option value="new">+ 새 분류</option>
          </Select>
          <TextInput
            label="분류 이름"
            value={categoryDraft.name}
            maxLength={40}
            disabled={disabled}
            onChange={(event) => setCategoryDraft({ ...categoryDraft, name: event.target.value })}
          />
          <div className={s.choices}>
            {colors.map((color) => (
              <CategoryChoice
                key={color.value}
                category={color.value}
                size="compact"
                selected={categoryDraft.color === color.value}
                aria-label={`${color.label} 색상`}
                disabled={disabled}
                onClick={() => setCategoryDraft({ ...categoryDraft, color: color.value })}
              >
                {color.label}
              </CategoryChoice>
            ))}
          </div>
          {categoryDraft.category &&
            (state.timeRecords ?? []).some(
              (record) => record.categoryId === categoryDraft.category?.id,
            ) && (
              <Select
                label="삭제할 때 기존 기록 이동"
                value={categoryDraft.reassignTo}
                disabled={disabled}
                onChange={(event) =>
                  setCategoryDraft({ ...categoryDraft, reassignTo: event.target.value })
                }
              >
                {categories
                  .filter((category) => category.id !== categoryDraft.category?.id)
                  .map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
              </Select>
            )}
          <div className={s.actions}>
            <Button
              size="small"
              variant="ghost"
              disabled={disabled}
              onClick={() => setConfirmDiscard(true)}
            >
              닫기
            </Button>
            <Button
              size="small"
              disabled={disabled || !categoryDraft.name.trim()}
              onClick={() =>
                void persist("time-category-save", {
                  ...(categoryDraft.category
                    ? { id: categoryDraft.category.id, expectedCategory: categoryDraft.category }
                    : {}),
                  name: categoryDraft.name,
                  color: categoryDraft.color,
                })
              }
            >
              저장
            </Button>
            {categoryDraft.category && (
              <Button
                size="small"
                variant="danger"
                disabled={disabled || categories.length < 2}
                onClick={() => setConfirmDelete(true)}
              >
                삭제
              </Button>
            )}
          </div>
        </>
      )}
      {confirmDiscard && (
        <div>
          <p className={s.meta}>입력한 내용을 버리고 닫을까요?</p>
          <div className={s.actions}>
            <Button
              size="small"
              variant="ghost"
              disabled={disabled}
              onClick={() => setConfirmDiscard(false)}
            >
              계속 입력
            </Button>
            <Button size="small" variant="danger" disabled={disabled} onClick={close}>
              버리고 닫기
            </Button>
          </div>
        </div>
      )}
      {confirmDelete && (
        <div>
          <p className={s.meta}>
            {draft
              ? "이 시간 기록을 삭제할까요?"
              : "이 분류를 삭제하고 기록을 선택한 분류로 옮길까요?"}
          </p>
          <div className={s.actions}>
            <Button
              size="small"
              variant="ghost"
              disabled={disabled}
              onClick={() => setConfirmDelete(false)}
            >
              유지
            </Button>
            <Button
              size="small"
              variant="danger"
              disabled={disabled}
              onClick={() => {
                if (draft?.record) {
                  void persist("time-record-delete", {
                    id: draft.record.id,
                    expectedRecord: draft.record,
                  });
                } else if (categoryDraft?.category) {
                  void persist("time-category-delete", {
                    id: categoryDraft.category.id,
                    reassignTo: categoryDraft.reassignTo,
                    expectedCategory: categoryDraft.category,
                  });
                }
              }}
            >
              삭제 확인
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className={s.error}>
          {error}
        </p>
      )}
    </Surface>
  ) : undefined;
  return (
    <div className={[s.editor, className].filter(Boolean).join(" ")}>
      <CalendarDayRing
        layout="fill"
        segments={segments}
        value={timeDuration(recordedTimeMinutes(segments))}
        centerLabel="오늘 칠한 시간"
        caption="수동 기록과 실제 집중 시간 · 일정은 안쪽 링"
        toolbar={toolbar}
        overlay={overlay}
        selection={validRange ? { startMinute: start, endMinute: end } : undefined}
        onRangeSelect={openRange}
        onSegmentClick={onAdditionalSegmentClick}
        interactionDisabled={disabled || hasDraft}
        currentMinute={currentMinute}
        showSegmentLabels
      />
      {records.length > 0 && (
        <details className={s.records}>
          <summary>시간 기록 {records.length}개 수정</summary>
          <div className={s.list}>
            {records.map((record) => (
              <Button
                key={record.id}
                size="small"
                variant="link"
                disabled={disabled || hasDraft}
                onClick={() => edit(record)}
              >
                {timeInput(record.startMinute)}–{timeInput(record.endMinute)} ·{" "}
                {record.title ||
                  categories.find((category) => category.id === record.categoryId)?.name}
              </Button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
