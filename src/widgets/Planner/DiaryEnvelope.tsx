import {
  Button,
  Checkbox,
  DateField,
  Dialog,
  FormField,
  Select,
  TextField,
} from "@fleetia/lagrange";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { localDay, rows, text, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import { useConnectionCommand } from "../useConnectionCommand";
import { DiaryNoteCollection } from "./DiaryNotes";
import type { DiaryAction, DiaryNote, DiaryPage } from "./diaryTypes";
import { dueLabel, eventTime, frequencyRecords, plannedDay, ruleOf } from "./plannerData";
import { TaskReadOnlyDetails } from "./TodoEditor";
import * as s from "./diaryEnvelope.css";

export function envelopeTitle(envelope: DataRecord): string {
  return text(envelope.title) || text(envelope.eventLabel) || "준비 봉투";
}

export function DiaryEnvelope({
  envelope,
  preparation,
  items,
  events,
  notes,
  pages,
  busy,
  act,
  diaryAction,
  onPlanTask,
  onToggleTask,
  onEditTask,
  onFocusTask,
  onCreateTask,
  onOpenPage,
  onDirtyChange,
  onReturnToDay,
}: {
  envelope: DataRecord;
  preparation: WidgetView;
  items: DataRecord[];
  events: DataRecord[];
  notes: DiaryNote[];
  pages: DiaryPage[];
  busy: boolean;
  act: ToolAction;
  diaryAction: DiaryAction;
  onPlanTask: (item: DataRecord) => Promise<boolean>;
  onToggleTask: (item: DataRecord) => Promise<boolean>;
  onEditTask?: (item: DataRecord) => void;
  onFocusTask?: (item: DataRecord) => void;
  onCreateTask: (title: string) => Promise<string | null>;
  onOpenPage: (page: DiaryPage) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onReturnToDay?: () => void;
}): ReactElement {
  const id = text(envelope.id);
  const [titleDraft, setTitleDraft] = useState<{ value: string; base: string } | null>(null);
  const [eventId, setEventId] = useState("");
  const [check, setCheck] = useState("");
  const [task, setTask] = useState("");
  const [selectedTask, setSelectedTask] = useState("");
  const [selectedCheck, setSelectedCheck] = useState("");
  const [pendingTodo, setPendingTodo] = useState<string | null>(null);
  const [todoId, setTodoId] = useState("");
  const [noteId, setNoteId] = useState("");
  const [linkTitle, setLinkTitle] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [notesDirty, setNotesDirty] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dateEditor, setDateEditor] = useState(false);
  const [dateDraft, setDateDraft] = useState(text(envelope.date));
  const [planning, setPlanning] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const report = useRef(onDirtyChange);
  report.current = onDirtyChange;
  const dirty =
    Boolean(titleDraft && titleDraft.value !== titleDraft.base) ||
    Boolean(check || task || linkTitle || linkUrl || pendingTodo || notesDirty);
  useEffect(() => {
    report.current?.(dirty);
  }, [dirty]);
  useEffect(
    () => () => {
      report.current?.(false);
    },
    [],
  );
  const { run: openLink, error: linkError, busy: openingLink } = useConnectionCommand();
  const disabled = busy || saving;
  const linkedIds = Array.isArray(envelope.todoIds)
    ? envelope.todoIds.filter((value): value is string => typeof value === "string")
    : [];
  const relatedPages = pages.filter((page) =>
    page.entries.some(
      (entry) =>
        (entry.kind === "envelope" && entry.refId === id) ||
        (entry.kind === "todo" && linkedIds.includes(entry.refId ?? "")),
    ),
  );
  const connected = events.find((event) => event.id === envelope.eventId && !event.cancelled);
  const eventOptions = events.filter((event) => !event.cancelled);
  const scheduledDay =
    text(connected?.startDate) ||
    (typeof connected?.startAt === "number"
      ? localDay(new Date(connected.startAt))
      : text(envelope.date));
  const dateLabel = scheduledDay
    ? new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", weekday: "long" }).format(
        new Date(`${scheduledDay}T12:00:00`),
      )
    : text(envelope.eventId)
      ? "연결한 일정"
      : "날짜 없이 준비 중";
  const checks = rows(envelope.checks);
  const linkedItems = items.filter((item) => linkedIds.includes(text(item.id)));
  function isDone(item: DataRecord): boolean {
    return ruleOf(item).mode === "frequency"
      ? frequencyRecords(item, localDay()).some((entry) => entry.date === localDay())
      : typeof item.completedAt === "number";
  }
  const availableItems = linkedItems.filter(
    (item) => !isDone(item) && plannedDay(item) !== localDay(),
  );
  const availableChecks = checks.filter((check) => check.done !== true);
  const completedCount =
    linkedItems.filter(isDone).length + checks.filter((check) => check.done === true).length;
  async function perform(operation: () => Promise<boolean>): Promise<boolean> {
    if (pending.current || busy) return false;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      const ok = await operation();
      if (!ok) setError("저장하지 못했어요. 입력한 내용은 남아 있어요. 다시 시도해 주세요.");
      return ok;
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }
  const save: ToolAction = (action, input) => act(action, input, preparation);
  return (
    <article className={s.page} aria-label={`${envelopeTitle(envelope)} 준비 봉투`}>
      <header className={s.form}>
        {titleDraft ? (
          <form
            className={s.form}
            onSubmit={async (event) => {
              event.preventDefault();
              if (titleDraft.base !== envelopeTitle(envelope)) {
                setError(
                  "다른 곳에서 봉투 이름이 바뀌었어요. 편집을 취소하고 최신 이름을 확인해 주세요.",
                );
                return;
              }
              if (
                titleDraft.value.trim() &&
                (await perform(() => save("update", { id, title: titleDraft.value.trim() })))
              )
                setTitleDraft(null);
            }}
          >
            <FormField label="준비 봉투 이름" required>
              <TextField
                maxLength={500}
                disabled={disabled}
                value={titleDraft.value}
                onChange={(event) => setTitleDraft({ ...titleDraft, value: event.target.value })}
              />
            </FormField>
            <div className={s.actions}>
              <Button
                variant="quiet"
                size="compact"
                disabled={disabled}
                onClick={() => setTitleDraft(null)}
              >
                취소
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="compact"
                disabled={disabled || !titleDraft.value.trim()}
              >
                이름 저장
              </Button>
            </div>
          </form>
        ) : (
          <div className={s.row}>
            <h1 className={`${s.heading} ${s.grow}`}>{envelopeTitle(envelope)}</h1>
            <Button
              variant="quiet"
              size="compact"
              disabled={disabled}
              aria-label="준비 봉투 메뉴"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(!menuOpen)}
            >
              ···
            </Button>
          </div>
        )}
        {menuOpen && (
          <div className={s.actions}>
            <Button
              variant="quiet"
              size="compact"
              disabled={disabled}
              onClick={() => {
                setTitleDraft({ value: envelopeTitle(envelope), base: envelopeTitle(envelope) });
                setMenuOpen(false);
              }}
            >
              이름 편집
            </Button>
            <Button
              variant="quiet"
              size="compact"
              disabled={disabled}
              onClick={() => {
                setDeleting(true);
                setMenuOpen(false);
              }}
            >
              봉투 삭제
            </Button>
          </div>
        )}
        <p className={s.caption}>
          준비 봉투 ·{" "}
          {envelope.archived === true ? "준비를 마치고 보관했어요" : "날짜가 오기 전부터 차곡차곡"}
        </p>
      </header>
      <div className={s.dateBanner}>
        <strong>
          {dateLabel}
          {connected && !connected.allDay ? ` · ${eventTime(connected)}` : ""}
        </strong>
        <span className={`${s.caption} ${s.grow}`}>
          {text(connected?.title) ||
            (text(envelope.eventId) ? `${text(envelope.eventLabel)} · 현재 조회할 수 없음` : "")}
        </span>
        <Button
          variant="quiet"
          size="compact"
          disabled={disabled}
          onClick={() => {
            setDateDraft(text(envelope.date));
            setDateEditor(true);
          }}
        >
          {scheduledDay || text(envelope.eventId) ? "날짜 바꾸기" : "날짜 정하기"}
        </Button>
      </div>
      {(error || linkError) && (
        <p className={s.error} role="alert">
          {error || linkError}
        </p>
      )}
      <div className={s.columns}>
        <div className={s.column}>
          <section className={s.section} aria-label="봉투 할 일">
            <div className={s.row}>
              <h2 className={`${s.subheading} ${s.grow}`}>준비할 일</h2>
              <span className={s.caption}>
                {completedCount} / {linkedIds.length + checks.length}
              </span>
            </div>
            <div className={s.checklist}>
              {linkedIds.map((linkedId) => {
                const item = items.find((value) => value.id === linkedId);
                if (!item)
                  return (
                    <div className={s.checkRow} key={linkedId}>
                      <span className={`${s.caption} ${s.grow}`}>현재 조회할 수 없는 할 일</span>
                      <Button
                        variant="quiet"
                        size="compact"
                        disabled={disabled}
                        onClick={() =>
                          void perform(() => save("todo-unlink", { id, todoId: linkedId }))
                        }
                      >
                        연결 해제
                      </Button>
                    </div>
                  );
                const done = isDone(item);
                return (
                  <div key={linkedId}>
                    <div className={s.checkRow}>
                      <Checkbox
                        aria-label={text(item.title)}
                        title="완료 상태 바꾸기"
                        children={null}
                        aria-labelledby={undefined}
                        checked={done}
                        disabled={disabled}
                        onChange={() => void perform(() => onToggleTask(item))}
                      />
                      <button
                        type="button"
                        className={s.itemTitle}
                        aria-label={`${text(item.title)} 상세 보기`}
                        aria-expanded={selectedTask === linkedId}
                        onClick={() => setSelectedTask(selectedTask === linkedId ? "" : linkedId)}
                      >
                        {text(item.title)}
                      </button>
                      {plannedDay(item) === localDay() && <span className={s.caption}>오늘</span>}
                    </div>
                    <p className={s.caption}>
                      계획 · {plannedDay(item) || "미지정"}　{dueLabel(item) || "기한 없음"}
                    </p>
                    {!!text(item.memo) && (
                      <p className={s.memoPreview}>
                        메모 · {text(item.memo).split(/\r?\n/)[0]} · 상세 보기
                      </p>
                    )}
                    {selectedTask === linkedId && (
                      <>
                        <TaskReadOnlyDetails item={item} />
                        <div className={s.row}>
                          {onEditTask && (
                            <Button
                              variant="quiet"
                              size="compact"
                              disabled={disabled}
                              onClick={() => onEditTask(item)}
                            >
                              할 일 편집
                            </Button>
                          )}
                          {onFocusTask && !done && (
                            <Button
                              variant="secondary"
                              size="compact"
                              disabled={disabled}
                              onClick={() => onFocusTask(item)}
                            >
                              25분 집중 시작
                            </Button>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            {checks.map((item) => (
              <div key={text(item.id)}>
                <div className={s.checkRow}>
                  <Checkbox
                    aria-label={text(item.text)}
                    title="완료 상태 바꾸기"
                    children={null}
                    aria-labelledby={undefined}
                    checked={item.done === true}
                    disabled={disabled}
                    onChange={() =>
                      void perform(() => save("check-toggle", { id, checkId: text(item.id) }))
                    }
                  />
                  <button
                    type="button"
                    className={s.itemTitle}
                    aria-expanded={selectedCheck === item.id}
                    onClick={() => setSelectedCheck(selectedCheck === item.id ? "" : text(item.id))}
                  >
                    {text(item.text)}
                  </button>
                </div>
                {selectedCheck === item.id && (
                  <p className={s.noteBody}>{text(item.text)} · 준비 체크리스트</p>
                )}
              </div>
            ))}
            <div>
              <Button
                variant="primary"
                size="compact"
                disabled={disabled || (!availableItems.length && !availableChecks.length)}
                onClick={() => setPlanning(true)}
              >
                오늘 할 일로 꺼내기
              </Button>
            </div>
            <p className={s.caption}>다이어리와 봉투에서 같은 할 일을 봐요.</p>
            <details className={s.disclosure}>
              <summary>+ 준비할 일 추가</summary>
              <form
                className={s.row}
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!task.trim() && !pendingTodo) return;
                  await perform(async () => {
                    const createdId = pendingTodo ?? (await onCreateTask(task.trim()));
                    if (!createdId) return false;
                    setPendingTodo(createdId);
                    if (!(await save("todo-link", { id, todoId: createdId }))) return false;
                    setTask("");
                    setPendingTodo(null);
                    return true;
                  });
                }}
              >
                <FormField className={s.grow} label="봉투에 추가할 할 일">
                  <TextField
                    placeholder="준비할 일을 적어보세요"
                    value={task}
                    disabled={disabled || pendingTodo !== null}
                    maxLength={1000}
                    onChange={(event) => setTask(event.target.value)}
                  />
                </FormField>
                <Button
                  type="submit"
                  variant="secondary"
                  size="compact"
                  disabled={disabled || (!task.trim() && !pendingTodo)}
                >
                  {pendingTodo ? "봉투 연결 다시 시도" : "할 일 추가"}
                </Button>
              </form>
              {pendingTodo && (
                <p className={s.caption}>할 일은 만들어졌어요. 봉투 연결을 다시 시도해 주세요.</p>
              )}
            </details>
            {items.some((item) => !linkedIds.includes(text(item.id))) && (
              <details className={s.disclosure}>
                <summary>기존 할 일 가져오기</summary>
                <form
                  className={s.row}
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (todoId && (await perform(() => save("todo-link", { id, todoId }))))
                      setTodoId("");
                  }}
                >
                  <FormField className={s.grow} label="기존 할 일">
                    <Select
                      disabled={disabled}
                      value={todoId}
                      onChange={(event) => setTodoId(event.target.value)}
                    >
                      <option value="">할 일 선택</option>
                      {items
                        .filter((item) => !linkedIds.includes(text(item.id)))
                        .map((item) => (
                          <option key={text(item.id)} value={text(item.id)}>
                            {text(item.title)}
                          </option>
                        ))}
                    </Select>
                  </FormField>
                  <Button
                    type="submit"
                    variant="secondary"
                    size="compact"
                    disabled={disabled || !todoId}
                  >
                    봉투에 연결
                  </Button>
                </form>
              </details>
            )}
          </section>
          <details className={s.disclosure}>
            <summary>체크 항목과 연결 관리</summary>
            {linkedItems.map((item) => (
              <div className={s.row} key={text(item.id)}>
                <span className={s.grow}>{text(item.title)}</span>
                <Button
                  variant="quiet"
                  size="compact"
                  disabled={disabled}
                  onClick={() =>
                    void perform(() => save("todo-unlink", { id, todoId: text(item.id) }))
                  }
                >
                  연결 해제
                </Button>
              </div>
            ))}
            {checks.map((item) => (
              <div key={text(item.id)} className={s.checkRow}>
                <span className={s.grow}>{text(item.text)}</span>
                <Button
                  variant="quiet"
                  size="compact"
                  disabled={disabled}
                  aria-label={`${text(item.text)} 체크 삭제`}
                  onClick={() =>
                    void perform(() => save("check-delete", { id, checkId: text(item.id) }))
                  }
                >
                  삭제
                </Button>
              </div>
            ))}
            <form
              className={s.row}
              onSubmit={async (event) => {
                event.preventDefault();
                if (
                  check.trim() &&
                  (await perform(() => save("check-add", { id, text: check.trim() })))
                )
                  setCheck("");
              }}
            >
              <FormField className={s.grow} label="체크할 준비물">
                <TextField
                  value={check}
                  disabled={disabled}
                  maxLength={1000}
                  onChange={(event) => setCheck(event.target.value)}
                />
              </FormField>
              <Button
                type="submit"
                variant="quiet"
                size="compact"
                disabled={disabled || !check.trim()}
              >
                체크 추가
              </Button>
            </form>
          </details>
        </div>
        <div className={s.column}>
          <section className={s.section} aria-label="봉투 메모">
            <h2 className={s.subheading}>함께 볼 메모</h2>
            <DiaryNoteCollection
              notes={notes.filter((note) => note.envelopeId === id)}
              diaryAction={diaryAction}
              busy={disabled}
              envelopeId={id}
              onDirtyChange={setNotesDirty}
            />
            {notes.some((note) => !note.envelopeId) && (
              <details className={s.disclosure}>
                <summary>기존 메모 함께 보기</summary>
                <form
                  className={s.form}
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (
                      noteId &&
                      (await perform(() =>
                        diaryAction("note-update", { id: noteId, envelopeId: id }),
                      ))
                    )
                      setNoteId("");
                  }}
                >
                  <FormField label="함께 볼 기존 메모">
                    <Select
                      value={noteId}
                      disabled={disabled}
                      onChange={(event) => setNoteId(event.target.value)}
                    >
                      <option value="">메모 선택</option>
                      {notes
                        .filter((note) => !note.envelopeId)
                        .map((note) => (
                          <option key={note.id} value={note.id}>
                            {note.title}
                          </option>
                        ))}
                    </Select>
                  </FormField>
                  <Button
                    type="submit"
                    variant="secondary"
                    size="compact"
                    disabled={disabled || !noteId}
                  >
                    이 메모 함께 보기
                  </Button>
                </form>
              </details>
            )}
          </section>
          <section className={s.section} aria-label="봉투 자료">
            <h2 className={s.subheading}>자료와 링크</h2>
            <ul className={s.linkList}>
              {rows(envelope.links).map((link) => (
                <li key={text(link.id)} className={s.row}>
                  <Button
                    className={s.grow}
                    variant="quiet"
                    size="compact"
                    disabled={disabled || openingLink}
                    onClick={() =>
                      void openLink("open_widget_link", { id: preparation.id, url: text(link.url) })
                    }
                  >
                    {text(link.title)} ↗
                  </Button>
                  <Button
                    variant="quiet"
                    size="compact"
                    disabled={disabled}
                    aria-label={`${text(link.title)} 자료 삭제`}
                    onClick={() =>
                      void perform(() => save("link-delete", { id, linkId: text(link.id) }))
                    }
                  >
                    삭제
                  </Button>
                </li>
              ))}
            </ul>
            <details className={s.disclosure}>
              <summary>자료 링크 추가</summary>
              <form
                className={s.form}
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (
                    linkTitle.trim() &&
                    linkUrl.trim() &&
                    (await perform(() =>
                      save("link-add", { id, title: linkTitle.trim(), url: linkUrl.trim() }),
                    ))
                  ) {
                    setLinkTitle("");
                    setLinkUrl("");
                  }
                }}
              >
                <FormField label="자료 이름" required>
                  <TextField
                    value={linkTitle}
                    disabled={disabled}
                    maxLength={500}
                    onChange={(event) => setLinkTitle(event.target.value)}
                  />
                </FormField>
                <FormField label="자료 주소" required>
                  <TextField
                    type="url"
                    value={linkUrl}
                    disabled={disabled}
                    onChange={(event) => setLinkUrl(event.target.value)}
                  />
                </FormField>
                <Button
                  type="submit"
                  variant="secondary"
                  size="compact"
                  disabled={disabled || !linkTitle.trim() || !linkUrl.trim()}
                >
                  자료 저장
                </Button>
              </form>
            </details>
          </section>
        </div>
      </div>
      <section className={s.related} aria-label="봉투와 연결한 기록">
        <h2 className={s.subheading}>관련 기록</h2>
        {relatedPages.length ? (
          relatedPages.map((page) => (
            <Button
              key={page.id}
              variant="quiet"
              size="compact"
              disabled={disabled}
              onClick={() => onOpenPage(page)}
            >
              {page.date ? `${page.date} · ` : ""}
              {page.title || "하루 기록"} ↗
            </Button>
          ))
        ) : (
          <p className={s.caption}>이 봉투나 할 일을 담은 다이어리 페이지가 여기에 모여요.</p>
        )}
      </section>
      <footer className={s.footer}>
        {onReturnToDay && (
          <Button variant="quiet" size="compact" disabled={disabled} onClick={onReturnToDay}>
            오늘 페이지로 돌아가기
          </Button>
        )}
        <Button
          variant="secondary"
          size="compact"
          disabled={disabled}
          onClick={() =>
            void perform(() => save("update", { id, archived: envelope.archived !== true }))
          }
        >
          {envelope.archived === true ? "다시 꺼내기" : "준비를 마치고 보관"}
        </Button>
      </footer>
      <Dialog
        isOpen={planning}
        onOpenChange={setPlanning}
        title="오늘 할 일로 꺼내기"
        closeLabel="닫기"
        size="small"
      >
        <div className={s.form}>
          <p className={s.caption}>
            오늘 할 일을 골라주세요. 봉투에서도 같은 완료 상태를 볼 수 있어요.
          </p>
          {availableItems.map((item) => (
            <div className={s.row} key={text(item.id)}>
              <span className={s.grow}>{text(item.title)}</span>
              <Button
                variant="secondary"
                size="compact"
                disabled={disabled}
                aria-label={`${text(item.title)} 꺼내기`}
                onClick={async () => {
                  if (await perform(() => onPlanTask(item))) setPlanning(false);
                }}
              >
                꺼내기
              </Button>
            </div>
          ))}
          {availableChecks.map((item) => (
            <div className={s.row} key={text(item.id)}>
              <span className={s.grow}>{text(item.text)}</span>
              <Button
                variant="secondary"
                size="compact"
                disabled={disabled}
                aria-label={`${text(item.text)} 꺼내기`}
                onClick={async () => {
                  if (
                    await perform(() =>
                      save("check-promote", {
                        id,
                        checkId: text(item.id),
                        plannedDate: localDay(),
                      }),
                    )
                  )
                    setPlanning(false);
                }}
              >
                꺼내기
              </Button>
            </div>
          ))}
        </div>
      </Dialog>
      <Dialog
        isOpen={dateEditor}
        onOpenChange={setDateEditor}
        title="봉투 날짜와 일정"
        closeLabel="닫기"
        size="small"
      >
        <div className={s.form}>
          <form
            className={s.form}
            onSubmit={async (event) => {
              event.preventDefault();
              if (
                await perform(() =>
                  save("update", { id, date: dateDraft || null, eventId: null, eventLabel: null }),
                )
              )
                setDateEditor(false);
            }}
          >
            <FormField label="봉투 날짜">
              <DateField
                value={dateDraft}
                disabled={disabled}
                onChange={(event) => setDateDraft(event.target.value)}
              />
            </FormField>
            <p className={s.caption}>날짜를 직접 정하면 외부 일정과의 연결은 해제돼요.</p>
            <div className={s.actions}>
              <Button
                variant="quiet"
                size="compact"
                disabled={disabled}
                onClick={async () => {
                  if (
                    await perform(() =>
                      save("update", { id, date: null, eventId: null, eventLabel: null }),
                    )
                  ) {
                    setDateDraft("");
                    setDateEditor(false);
                  }
                }}
              >
                날짜 없이 두기
              </Button>
              <Button
                type="submit"
                variant="primary"
                size="compact"
                disabled={disabled || !dateDraft}
              >
                날짜 저장
              </Button>
            </div>
          </form>
          {eventOptions.length > 0 && (
            <form
              className={s.form}
              onSubmit={async (event) => {
                event.preventDefault();
                const chosen = eventOptions.find((event) => event.id === eventId);
                if (
                  chosen &&
                  (await perform(() =>
                    save("update", { id, date: null, eventId, eventLabel: text(chosen.title) }),
                  ))
                ) {
                  setEventId("");
                  setDateEditor(false);
                }
              }}
            >
              <FormField label="연결할 일정">
                <Select
                  disabled={disabled}
                  value={eventId}
                  onChange={(event) => setEventId(event.target.value)}
                >
                  <option value="">일정 선택</option>
                  {eventOptions.map((event) => (
                    <option key={text(event.id)} value={text(event.id)}>
                      {text(event.title)} {text(event.startDate)}
                    </option>
                  ))}
                </Select>
              </FormField>
              <Button
                type="submit"
                variant="secondary"
                size="compact"
                disabled={disabled || !eventId}
              >
                이 일정 연결
              </Button>
            </form>
          )}
          {error && (
            <p className={s.error} role="alert">
              {error}
            </p>
          )}
        </div>
      </Dialog>
      <Dialog
        isOpen={deleting}
        onOpenChange={setDeleting}
        title="준비 봉투를 삭제할까요?"
        closeLabel="취소"
        size="small"
      >
        <p>
          봉투의 준비물 체크와 자료 링크가 삭제돼요. 연결된 할 일과 다이어리 기록은 남아요. 다시
          펼칠 봉투라면 보관하기를 사용하세요.
        </p>
        <div className={s.actions}>
          <Button variant="secondary" disabled={disabled} onClick={() => setDeleting(false)}>
            취소
          </Button>
          <Button
            variant="critical"
            disabled={disabled}
            onClick={async () => {
              if (await perform(() => save("delete", { id }))) setDeleting(false);
            }}
          >
            준비 봉투 삭제
          </Button>
        </div>
      </Dialog>
    </article>
  );
}
