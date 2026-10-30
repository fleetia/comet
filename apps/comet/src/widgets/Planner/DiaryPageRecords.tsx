import { Button, TextInput } from "@comet/ui";
import type { ReactElement } from "react";
import { text } from "../toolData";
import type { DiaryPageProps } from "./DiaryPage";
import type { DiaryEntry } from "./diaryTypes";
import { DiaryPageComposer } from "./DiaryPageComposer";
import { DiaryPageTaskLine as TaskLine } from "./DiaryPageTaskLine";
import { DiaryPageWritingArea as WritingArea } from "./DiaryPageWritingArea";
import {
  envelopeTitle,
  getDiaryEntryData,
  getDiaryWidgetEntryData,
  isComposing,
  movedDate,
  shouldSaveOnBlur,
  type DiaryPageData,
} from "./diaryPageData";
import { plannedDay } from "./plannerData";
import type { DiaryPageDraft } from "./useDiaryPageDraft";
import * as s from "./diaryPage.css";

export function DiaryPageRecords({
  source: {
    date,
    items,
    envelopes,
    widgets = [],
    onToggleTask,
    onEditTask,
    onFocusTask,
    onQueueTask,
    onMoveTask,
    onOpenEnvelope,
    onOpenWidgetEntry,
  },
  data,
  draft,
}: {
  source: DiaryPageProps;
  data: DiaryPageData;
  draft: DiaryPageDraft;
}): ReactElement {
  const { day, referencedTasks, scheduledTasks, dayEvents, dayMoves, displayEntries } = data;
  const {
    drafts,
    errors,
    entries,
    disabled,
    savingId,
    changeEntry,
    discardEntry,
    saveEntry,
    removeEntry,
  } = draft;

  function renderEntry(entry: DiaryEntry): ReactElement {
    if (entry.kind === "widget") {
      const { note, available, title } = getDiaryWidgetEntryData(entry, widgets);
      return (
        <li key={entry.id} className={s.line}>
          <span className={s.bullet} aria-hidden="true">
            ↗
          </span>
          <div className={s.content}>
            <div className={s.row}>
              <Button
                variant="ghost"
                size="small"
                disabled={!available || disabled}
                onClick={() => onOpenWidgetEntry?.(entry)}
              >
                {title} 열기 ↗
              </Button>
              <Button
                variant="ghost"
                size="small"
                disabled={disabled}
                aria-label={`${title} 연결 해제`}
                onClick={() => void removeEntry(entry)}
              >
                연결 해제
              </Button>
            </div>
            {note && (
              <p className={s.meta} style={{ whiteSpace: "pre-wrap" }}>
                {text(note.body)}
              </p>
            )}
            {!available && <p className={s.meta}>{entry.text} · 원본을 찾을 수 없어요.</p>}
            {errors[entry.id] && (
              <p role="alert" className={s.error}>
                {errors[entry.id]}
              </p>
            )}
          </div>
        </li>
      );
    }
    const { draft, latest, conflict, item, envelope, moved } = getDiaryEntryData(entry, {
      drafts,
      entries,
      items,
      envelopes,
      dayMoves,
    });
    if (entry.kind === "todo" && moved && (!item || plannedDay(item) !== day)) {
      return (
        <li key={entry.id} className={s.line}>
          <span className={s.bullet} aria-hidden="true">
            →
          </span>
          <div className={s.moved}>
            <span className={s.meta}>{moved.title}</span>
            <span className={s.title}>{movedDate(moved.toDate, date)}로 옮김</span>
          </div>
        </li>
      );
    }
    if (entry.kind === "todo" && item) {
      return (
        <li key={entry.id} className={s.line}>
          <div className={s.content}>
            <TaskLine
              item={item}
              date={date}
              busy={disabled}
              onToggle={onToggleTask}
              onEdit={onEditTask}
              onFocus={onFocusTask}
              onQueue={onQueueTask}
              onMove={onMoveTask}
              onRemove={() => void removeEntry(entry)}
            />
            {errors[entry.id] && (
              <p role="alert" className={s.error}>
                {errors[entry.id]}
              </p>
            )}
          </div>
        </li>
      );
    }
    return (
      <li key={entry.id} className={s.line}>
        <span className={s.bullet} aria-hidden="true">
          {entry.kind === "event" ? "○" : entry.kind === "envelope" ? "↗" : "–"}
        </span>
        <div className={s.content}>
          {entry.kind === "todo" ? (
            <>
              <p className={s.title}>{entry.text}</p>
              <p className={s.meta}>연결된 할 일을 찾을 수 없어요. 이 기록은 남겨 두었어요.</p>
            </>
          ) : (
            <>
              {entry.kind === "event" && (
                <TextInput
                  fill
                  type="time"
                  aria-label={`${entry.text} 시간`}
                  className={s.time}
                  value={draft?.time ?? entry.time ?? ""}
                  onChange={(event) => changeEntry(entry, { time: event.target.value })}
                  onBlur={(event) => {
                    if (shouldSaveOnBlur(event)) void saveEntry(entry);
                  }}
                />
              )}
              <div className={s.entryText}>
                <WritingArea
                  aria-label={`${entry.kind === "event" ? "일정" : entry.kind === "envelope" ? "준비 봉투" : "메모"} 내용`}
                  value={draft?.text ?? entry.text}
                  maxLength={20000}
                  onChange={(event) => changeEntry(entry, { text: event.target.value })}
                  onBlur={(event) => {
                    if (shouldSaveOnBlur(event)) void saveEntry(entry);
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      (event.ctrlKey || event.metaKey) &&
                      !isComposing(event)
                    ) {
                      event.preventDefault();
                      void saveEntry(entry);
                    }
                  }}
                />
                {entry.kind === "envelope" && envelope && (
                  <Button
                    className={s.envelope}
                    variant="ghost"
                    size="small"
                    onClick={() => onOpenEnvelope(text(envelope.id))}
                    aria-label={`${envelopeTitle(envelope)} 열기`}
                  >
                    열기 ↗
                  </Button>
                )}
                {latest && (
                  <Button
                    data-diary-action
                    className={s.rowActions}
                    size="small"
                    variant="ghost"
                    disabled={disabled}
                    onClick={() => void removeEntry(entry)}
                    aria-label={`${entry.text} 기록 지우기`}
                  >
                    지우기
                  </Button>
                )}
              </div>
              {entry.kind === "envelope" && !envelope && (
                <p className={s.meta}>연결된 준비 봉투를 찾을 수 없어요.</p>
              )}
            </>
          )}
          {draft && (
            <div className={s.controls}>
              <>
                <span className={s.meta} role="status">
                  {savingId === entry.id ? "저장 중…" : "저장하지 않은 내용"}
                </span>
                <Button
                  data-diary-action
                  size="small"
                  disabled={disabled || conflict}
                  onClick={() => void saveEntry(entry)}
                >
                  저장
                </Button>
                <Button
                  data-diary-action
                  size="small"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => discardEntry(entry.id)}
                >
                  {conflict ? "최신 내용 보기" : "수정 취소"}
                </Button>
              </>
            </div>
          )}
          {entry.kind === "todo" && latest && (
            <Button
              data-diary-action
              className={s.rowActions}
              size="small"
              variant="ghost"
              disabled={disabled}
              onClick={() => void removeEntry(entry)}
              aria-label={`${entry.text} 기록 지우기`}
            >
              기록 지우기
            </Button>
          )}
          {(errors[entry.id] || conflict) && (
            <p role="alert" className={s.error}>
              {errors[entry.id] ||
                "다른 곳에서 기록이 바뀌었어요. 작성 중인 내용은 그대로 남아 있어요."}
            </p>
          )}
        </div>
      </li>
    );
  }

  return (
    <div className={s.records}>
      <h3 className={s.heading}>{day ? "오늘의 기록" : "이 페이지의 기록"}</h3>
      <ul className={s.log} aria-label="이 페이지의 기록">
        {scheduledTasks.map((item) => (
          <li key={`todo:${text(item.id)}`} className={s.line}>
            <div className={s.content}>
              <TaskLine
                item={item}
                date={date}
                busy={disabled}
                onToggle={onToggleTask}
                onEdit={onEditTask}
                onFocus={onFocusTask}
                onQueue={onQueueTask}
                onMove={onMoveTask}
              />
            </div>
          </li>
        ))}
        {displayEntries.map(renderEntry)}
        {dayMoves
          .filter((move) => !referencedTasks.has(move.todoId))
          .map((move) => (
            <li key={`move:${move.id}`} className={s.line}>
              <span className={s.bullet} aria-hidden="true">
                →
              </span>
              <div className={s.moved}>
                <span className={s.meta}>{move.title}</span>
                <span className={s.title}>{movedDate(move.toDate, date)}로 옮김</span>
              </div>
            </li>
          ))}
      </ul>
      {!dayEvents.length &&
        !scheduledTasks.length &&
        !displayEntries.length &&
        !dayMoves.length && (
          <p className={s.empty}>할 일도, 떠오른 생각도 이 페이지에 이어서 적어 보세요.</p>
        )}
      <DiaryPageComposer draft={draft.composer} envelopes={envelopes} />
    </div>
  );
}
