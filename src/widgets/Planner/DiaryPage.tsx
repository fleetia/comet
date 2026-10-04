import { Button, Checkbox, DateField, Select, Surface, TextField } from "@fleetia/lagrange";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type FocusEvent,
  type KeyboardEvent,
  type ReactElement,
} from "react";
import { record, rows, text, type DataRecord } from "../toolData";
import type { WidgetView } from "../types";
import {
  dueLabel,
  deviceTimeZone,
  eventsOn,
  eventTime,
  frequencyRecords,
  moveDay,
  plannedDay,
  ruleOf,
} from "./plannerData";
import type {
  DiaryAction,
  DiaryEntry,
  DiaryEntryKind,
  DiaryMove,
  DiaryPage as Page,
} from "./diaryTypes";
import { TaskReadOnlyDetails } from "./TodoEditor";
import * as s from "./diaryPage.css";

export type DiaryPageProps = {
  page?: Page;
  date: string;
  items: DataRecord[];
  events: DataRecord[];
  envelopes: DataRecord[];
  moves: DiaryMove[];
  busy: boolean;
  onDiaryAction: DiaryAction;
  onAddTask: (title: string) => Promise<string | null>;
  onToggleTask: (item: DataRecord) => void;
  onEditTask: (item: DataRecord) => void;
  onFocusTask?: (item: DataRecord) => void;
  onMoveTask: (item: DataRecord, toDate: string) => Promise<boolean>;
  onOpenEnvelope: (id: string) => void;
  onCreatePage: () => Promise<string | null>;
  onDirtyChange?: (dirty: boolean) => void;
  widgets?: WidgetView[];
  onOpenWidgetEntry?: (entry: DiaryEntry) => void;
  onOpenEvent?: (event: DataRecord) => void;
};

type Draft = { source: DiaryEntry; text: string; time: string };
type StoredDraft = {
  drafts: Record<string, Draft>;
  kind: DiaryEntryKind;
  body: string;
  time: string;
  envelopeId: string;
  createdTask: { id: string; title: string } | null;
};

const KINDS: [DiaryEntryKind, string][] = [
  ["note", "메모"],
  ["todo", "할 일"],
  ["event", "일정"],
  ["envelope", "준비 봉투"],
];

function draftKey(page: Page | undefined, date: string): string {
  return `comet:diary-draft:${page?.date === null ? `page:${page.id}` : `day:${date}`}`;
}

export function discardDiaryPageDraft(page: Page | undefined, date: string): void {
  window.localStorage.removeItem(draftKey(page, date));
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function entryKind(value: unknown): value is DiaryEntryKind {
  return (
    value === "note" ||
    value === "todo" ||
    value === "event" ||
    value === "envelope" ||
    value === "widget"
  );
}

function restoreDraft(key: string): StoredDraft {
  const empty: StoredDraft = {
    drafts: {},
    kind: "note",
    body: "",
    time: "",
    envelopeId: "",
    createdTask: null,
  };
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(key) || "null");
    if (!object(value)) return empty;
    const drafts: Record<string, Draft> = {};
    if (object(value.drafts)) {
      for (const [id, candidate] of Object.entries(value.drafts)) {
        if (!object(candidate) || !object(candidate.source)) continue;
        const source = candidate.source;
        if (
          source.id !== id ||
          !entryKind(source.kind) ||
          typeof source.text !== "string" ||
          typeof candidate.text !== "string" ||
          typeof candidate.time !== "string"
        )
          continue;
        drafts[id] = {
          source: {
            id,
            kind: source.kind,
            text: source.text,
            ...(typeof source.refId === "string" ? { refId: source.refId } : {}),
            ...(typeof source.itemId === "string" ? { itemId: source.itemId } : {}),
            ...(typeof source.time === "string" ? { time: source.time } : {}),
          },
          text: candidate.text,
          time: candidate.time,
        };
      }
    }
    const task = value.createdTask;
    return {
      drafts,
      kind: entryKind(value.kind) ? value.kind : "note",
      body: typeof value.body === "string" ? value.body : "",
      time: typeof value.time === "string" ? value.time : "",
      envelopeId: typeof value.envelopeId === "string" ? value.envelopeId : "",
      createdTask:
        value.kind === "todo" &&
        object(task) &&
        typeof task.id === "string" &&
        typeof task.title === "string"
          ? { id: task.id, title: task.title }
          : null,
    };
  } catch {
    return empty;
  }
}

function envelopeTitle(envelope: DataRecord | undefined): string {
  return text(envelope?.title) || text(envelope?.name) || text(envelope?.eventLabel) || "준비 봉투";
}

function sameEntry(a: DiaryEntry, b: DiaryEntry): boolean {
  return (
    a.kind === b.kind &&
    a.text === b.text &&
    (a.time || "") === (b.time || "") &&
    a.refId === b.refId &&
    a.itemId === b.itemId
  );
}

function movedDate(value: string, from: string): string {
  return new Date(`${value}T12:00:00`).toLocaleDateString("ko-KR", {
    ...(value.slice(0, 4) !== from.slice(0, 4) ? { year: "numeric" } : {}),
    month: "long",
    day: "numeric",
  });
}

function isComposing(event: KeyboardEvent<HTMLTextAreaElement>): boolean {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}

function shouldSaveOnBlur(event: FocusEvent<HTMLElement>): boolean {
  return !(
    event.relatedTarget instanceof HTMLElement && event.relatedTarget.closest("[data-diary-action]")
  );
}

function WritingArea({ value, ...props }: ComponentPropsWithoutRef<"textarea">): ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    ref.current.style.height = "auto";
    ref.current.style.height = `${Math.max(32, ref.current.scrollHeight)}px`;
  }, [value]);
  return <textarea {...props} ref={ref} value={value} rows={1} className={s.writing} />;
}

export function DiaryPage({
  page,
  date,
  items,
  events,
  envelopes,
  moves,
  busy,
  onDiaryAction,
  onAddTask,
  onToggleTask,
  onEditTask,
  onFocusTask,
  onMoveTask,
  onOpenEnvelope,
  onCreatePage,
  onDirtyChange,
  widgets = [],
  onOpenWidgetEntry,
  onOpenEvent,
}: DiaryPageProps): ReactElement {
  const storageKey = draftKey(page, date);
  const [restored] = useState(() => restoreDraft(storageKey));
  const [drafts, setDrafts] = useState<Record<string, Draft>>(restored.drafts);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [kind, setKind] = useState<DiaryEntryKind>(restored.kind);
  const [body, setBody] = useState(restored.body);
  const [time, setTime] = useState(restored.time);
  const [envelopeId, setEnvelopeId] = useState(restored.envelopeId);
  const [createdTask, setCreatedTask] = useState(restored.createdTask);
  const [composerOpen, setComposerOpen] = useState(
    !!restored.body || !!restored.time || !!restored.envelopeId || !!restored.createdTask,
  );
  const [storageFailure, setStorageFailure] = useState(false);
  const [failure, setFailure] = useState("");
  const [working, setWorking] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const pending = useRef(false);
  const mounted = useRef(true);
  const createdPageId = useRef<string | null>(null);
  const dirtyCallback = useRef(onDirtyChange);
  dirtyCallback.current = onDirtyChange;
  const dirty =
    working || Object.keys(drafts).length > 0 || !!body || !!time || !!envelopeId || !!createdTask;

  useLayoutEffect(() => {
    try {
      if (Object.keys(drafts).length || body || time || envelopeId || createdTask) {
        window.localStorage.setItem(
          storageKey,
          JSON.stringify({
            drafts,
            kind,
            body,
            time,
            envelopeId,
            createdTask,
          } satisfies StoredDraft),
        );
      } else {
        window.localStorage.removeItem(storageKey);
      }
      setStorageFailure(false);
    } catch {
      setStorageFailure(true);
    }
  }, [storageKey, drafts, kind, body, time, envelopeId, createdTask]);

  useEffect(() => {
    dirtyCallback.current?.(dirty);
  }, [dirty]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      dirtyCallback.current?.(false);
    };
  }, []);

  const day = page?.date === null ? null : date;
  const entries = page?.entries ?? [];
  const referencedTasks = new Set<string>();
  const uniqueEntries = entries.filter((entry) => {
    if (entry.kind !== "todo" || !entry.refId) return true;
    if (referencedTasks.has(entry.refId)) return false;
    referencedTasks.add(entry.refId);
    return true;
  });
  const scheduledTasks = day
    ? items.filter((item) => plannedDay(item) === day && !referencedTasks.has(text(item.id)))
    : [];
  const dayEvents = day ? eventsOn(events, day) : [];
  const dayEnvelopes = day
    ? envelopes.filter(
        (envelope) =>
          envelope.date === day && !text(envelope.eventId) && envelope.archived !== true,
      )
    : [];
  const dayMoves = moves.filter((move) => move.fromDate === day);
  const orphanDrafts = Object.values(drafts).filter(
    (draft) => !entries.some((entry) => entry.id === draft.source.id),
  );
  const displayEntries = [...uniqueEntries, ...orphanDrafts.map((draft) => draft.source)];
  const disabled = busy || working;

  function changeEntry(entry: DiaryEntry, changes: Partial<Pick<Draft, "text" | "time">>): void {
    setDrafts((current) => {
      const previous = current[entry.id] ?? {
        source: entry,
        text: entry.text,
        time: entry.time || "",
      };
      const next = { ...previous, ...changes };
      if (
        !pending.current &&
        next.text === next.source.text &&
        next.time === (next.source.time || "")
      ) {
        const remaining = { ...current };
        delete remaining[entry.id];
        return remaining;
      }
      return { ...current, [entry.id]: next };
    });
    setErrors((current) => ({ ...current, [entry.id]: "" }));
  }

  function discardEntry(id: string): void {
    setDrafts((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    setErrors((current) => ({ ...current, [id]: "" }));
  }

  async function mutate(operation: () => Promise<void>): Promise<void> {
    if (pending.current || busy) return;
    pending.current = true;
    setWorking(true);
    setFailure("");
    try {
      await operation();
    } catch {
      if (mounted.current)
        setFailure("저장하지 못했어요. 작성한 내용은 그대로 두었으니 다시 시도해 주세요.");
    } finally {
      pending.current = false;
      if (mounted.current) {
        setWorking(false);
        setSavingId(null);
      }
    }
  }

  async function saveEntry(entry: DiaryEntry): Promise<void> {
    const draft = drafts[entry.id];
    if (!draft || !page || pending.current || busy) return;
    const latest = entries.find((value) => value.id === entry.id);
    if (!latest || !sameEntry(latest, draft.source)) {
      setErrors((current) => ({
        ...current,
        [entry.id]:
          "다른 곳에서 이 기록이 바뀌었어요. 작성 중인 내용을 확인한 뒤 최신 내용을 불러와 주세요.",
      }));
      return;
    }
    if (!draft.text.trim()) {
      setErrors((current) => ({
        ...current,
        [entry.id]: "내용을 적거나 기록 지우기를 눌러 주세요.",
      }));
      return;
    }
    await mutate(async () => {
      setSavingId(entry.id);
      const ok = await onDiaryAction("entry-update", {
        pageId: page.id,
        id: entry.id,
        text: draft.text,
        expectedText: draft.source.text,
        expectedTime: draft.source.time ?? null,
        expectedRefId: draft.source.refId ?? null,
        ...(entry.kind === "event" ? { time: draft.time } : {}),
      });
      if (!mounted.current) return;
      if (!ok) {
        setErrors((current) => ({
          ...current,
          [entry.id]: "저장하지 못했어요. 작성한 내용은 남아 있어요.",
        }));
        return;
      }
      setErrors((current) => ({ ...current, [entry.id]: "" }));
      setDrafts((current) => {
        const next = { ...current };
        const now = next[entry.id];
        if (!now) return current;
        if (now.text === draft.text && now.time === draft.time) delete next[entry.id];
        else
          next[entry.id] = {
            ...now,
            source: { ...draft.source, text: draft.text, time: draft.time },
          };
        return next;
      });
    });
  }

  async function removeEntry(entry: DiaryEntry): Promise<void> {
    if (!page) return;
    await mutate(async () => {
      if (await onDiaryAction("entry-delete", { pageId: page.id, id: entry.id })) {
        if (mounted.current) discardEntry(entry.id);
      } else if (mounted.current) {
        setErrors((current) => ({
          ...current,
          [entry.id]: "기록을 지우지 못했어요. 다시 시도해 주세요.",
        }));
      }
    });
  }

  async function addEntry(): Promise<void> {
    if (kind === "envelope" ? !envelopeId : !body.trim()) return;
    if (kind === "envelope" && !envelopes.some((envelope) => envelope.id === envelopeId)) {
      setFailure("이 준비 봉투를 찾을 수 없어요. 연결할 봉투를 다시 골라 주세요.");
      return;
    }
    await mutate(async () => {
      const pageId = page?.id ?? createdPageId.current ?? (await onCreatePage());
      if (!mounted.current) return;
      if (!pageId) {
        setFailure("페이지를 저장하지 못했어요. 작성한 내용은 그대로 남아 있어요.");
        return;
      }
      createdPageId.current = pageId;
      let refId = kind === "envelope" ? envelopeId : "";
      let value = body;
      if (kind === "todo") {
        const id = createdTask?.id ?? (await onAddTask(body));
        if (!mounted.current) return;
        if (!id) {
          setFailure("할 일을 저장하지 못했어요. 다시 시도해 주세요.");
          return;
        }
        value = createdTask?.title ?? body;
        setCreatedTask({ id, title: value });
        refId = id;
      }
      if (kind === "envelope" && !value.trim()) {
        value = envelopeTitle(envelopes.find((envelope) => envelope.id === envelopeId));
      }
      const ok = await onDiaryAction("entry-add", {
        pageId,
        kind,
        text: value,
        ...(refId ? { refId } : {}),
        ...(kind === "event" ? { time } : {}),
      });
      if (!mounted.current) return;
      if (!ok) {
        setFailure(
          kind === "todo"
            ? "할 일은 저장됐어요. 페이지 연결을 다시 시도해 주세요."
            : "기록을 저장하지 못했어요. 작성한 내용은 그대로 남아 있어요.",
        );
        return;
      }
      setBody("");
      setTime("");
      setEnvelopeId("");
      setCreatedTask(null);
    });
  }

  function composerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || isComposing(event)) return;
    if (kind === "note" ? !(event.ctrlKey || event.metaKey) : event.shiftKey) return;
    event.preventDefault();
    void addEntry();
  }

  function renderEntry(entry: DiaryEntry): ReactElement {
    if (entry.kind === "widget") {
      const widget = widgets.find((value) => value.id === entry.refId && value.installed);
      const note = entry.itemId
        ? rows(record(widget?.data).notes).find((value) => value.id === entry.itemId)
        : null;
      const available = !!widget && (!entry.itemId || !!note);
      const title = note ? text(note.title) || "메모" : entry.text;
      return (
        <li key={entry.id} className={s.line}>
          <span className={s.bullet} aria-hidden="true">
            ↗
          </span>
          <div className={s.content}>
            <div className={s.row}>
              <Button
                variant="quiet"
                size="compact"
                disabled={!available || !widget?.enabled || disabled}
                onClick={() => onOpenWidgetEntry?.(entry)}
              >
                {title} 열기 ↗
              </Button>
              <Button
                variant="quiet"
                size="compact"
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
            {available && !widget?.enabled && (
              <p className={s.meta}>위젯 설정에서 이 도구를 켜 주세요.</p>
            )}
            {errors[entry.id] && (
              <p role="alert" className={s.error}>
                {errors[entry.id]}
              </p>
            )}
          </div>
        </li>
      );
    }
    const draft = drafts[entry.id];
    const latest = entries.find((value) => value.id === entry.id);
    const conflict = !!draft && (!latest || !sameEntry(latest, draft.source));
    const item = items.find((value) => value.id === entry.refId);
    const envelope = envelopes.find((value) => value.id === entry.refId);
    const moved = dayMoves.filter((move) => move.todoId === entry.refId).at(-1);
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
                <TextField
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
                    variant="quiet"
                    size="compact"
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
                    size="compact"
                    variant="quiet"
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
                  size="compact"
                  disabled={disabled || conflict}
                  onClick={() => void saveEntry(entry)}
                >
                  저장
                </Button>
                <Button
                  data-diary-action
                  size="compact"
                  variant="quiet"
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
              size="compact"
              variant="quiet"
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
    <section className={s.page} aria-label="다이어리 본문">
      {storageFailure && (
        <p role="alert" className={s.error}>
          이 기기에 초안을 임시 저장하지 못했어요. 앱을 닫기 전에 내용을 저장해 주세요.
        </p>
      )}
      {(dayEvents.length > 0 || dayEnvelopes.length > 0) && (
        <div className={s.appointments} role="region" aria-label="오늘의 약속">
          {dayEvents.map((event) => (
            <Surface
              tone="inset"
              padding="compact"
              key={`event:${text(event.id)}`}
              className={s.appointment}
              aria-label={`${event.connectionId === "local" ? "Comet 일정" : "연결 일정"}: ${text(event.title)}`}
            >
              <div className={s.content}>
                <p className={s.title}>
                  {eventTime(event)} · {text(event.title)}
                </p>
                <span className={s.meta}>
                  {event.connectionId === "local" ? "Comet 일정" : "연결 일정 · 읽기 전용"}
                </span>
              </div>
              <div className={s.row}>
                {onOpenEvent && (
                  <Button variant="quiet" size="compact" onClick={() => onOpenEvent(event)}>
                    일정 보기
                  </Button>
                )}
                {envelopes
                  .filter((envelope) => envelope.eventId === event.id && envelope.archived !== true)
                  .map((envelope) => (
                    <Button
                      key={text(envelope.id)}
                      variant="secondary"
                      size="compact"
                      onClick={() => onOpenEnvelope(text(envelope.id))}
                    >
                      {envelopeTitle(envelope)} 열기 ↗
                    </Button>
                  ))}
              </div>
            </Surface>
          ))}
          {dayEnvelopes.map((envelope) => (
            <Surface
              tone="inset"
              padding="compact"
              key={`envelope:${text(envelope.id)}`}
              className={s.appointment}
              aria-label={`준비 봉투: ${envelopeTitle(envelope)}`}
            >
              <div className={s.content}>
                <p className={s.title}>{envelopeTitle(envelope)}</p>
                <span className={s.meta}>이날 준비할 봉투</span>
              </div>
              <Button
                variant="secondary"
                size="compact"
                disabled={disabled}
                onClick={() => onOpenEnvelope(text(envelope.id))}
              >
                {envelopeTitle(envelope)} 열기 ↗
              </Button>
            </Surface>
          ))}
        </div>
      )}
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
        {!composerOpen && (
          <button
            type="button"
            className={s.addLine}
            aria-expanded="false"
            onClick={() => setComposerOpen(true)}
          >
            <span aria-hidden="true">＋</span>할 일, 떠오른 생각, 오늘의 일을 한 줄로…
          </button>
        )}
        {composerOpen && (
          <form
            className={s.composer}
            aria-label="새 기록"
            onSubmit={(event) => {
              event.preventDefault();
              void addEntry();
            }}
          >
            <div className={s.kinds} role="group" aria-label="기록 종류">
              {KINDS.map(([value, label]) => (
                <Button
                  key={value}
                  type="button"
                  size="compact"
                  variant={kind === value ? "primary" : "secondary"}
                  aria-pressed={kind === value}
                  disabled={disabled || !!createdTask}
                  onClick={() => {
                    setKind(value);
                    if (value !== "event") setTime("");
                    if (value !== "envelope") setEnvelopeId("");
                    setFailure("");
                  }}
                >
                  {label}
                </Button>
              ))}
            </div>
            {kind === "event" && (
              <div className={s.row}>
                <TextField
                  type="time"
                  className={s.time}
                  aria-label="새 일정 시간"
                  value={time}
                  disabled={disabled}
                  onChange={(event) => setTime(event.target.value)}
                />
                <span className={s.meta}>시간 없이 적으면 종일 일정</span>
              </div>
            )}
            {kind === "envelope" && (
              <>
                <Select
                  aria-label="연결할 준비 봉투"
                  value={envelopeId}
                  disabled={disabled}
                  onChange={(event) => setEnvelopeId(event.target.value)}
                >
                  <option value="">준비 봉투 고르기</option>
                  {envelopes.map((envelope) => (
                    <option key={text(envelope.id)} value={text(envelope.id)}>
                      {envelopeTitle(envelope)}
                    </option>
                  ))}
                </Select>
                {!envelopes.length && (
                  <p className={s.meta}>
                    내 다이어리에서 준비 봉투를 만든 뒤 이 페이지에 연결할 수 있어요.
                  </p>
                )}
              </>
            )}
            <p className={s.meta} id="diary-composer-mode">
              {kind === "todo"
                ? "할 일 작성 · 체크할 수 있는 새 할 일을 만듭니다."
                : kind === "note"
                  ? "메모 작성 · 생각과 기록을 자유롭게 남겨요."
                  : kind === "event"
                    ? `일정 기록 작성 · 이 페이지에 남기는 기록 · 기기 시간대 ${deviceTimeZone()}`
                    : "준비 봉투 연결 · 기존 봉투를 이 페이지에서 열어요."}
            </p>
            <div className={s.composerBody}>
              <WritingArea
                aria-label="새 기록 내용"
                aria-describedby="diary-composer-mode diary-composer-shortcut"
                value={body}
                autoFocus
                maxLength={kind === "todo" ? 500 : 20000}
                disabled={disabled || !!createdTask}
                placeholder={
                  kind === "note"
                    ? "지금 떠오른 생각을 적어 보세요…"
                    : kind === "todo"
                      ? "해야 할 일을 적어 보세요…"
                      : kind === "event"
                        ? "어떤 일정인가요?"
                        : "함께 남길 말이 있나요? (선택)"
                }
                onChange={(event) => setBody(event.target.value)}
                onKeyDown={composerKeyDown}
              />
            </div>
            {failure && (
              <p role="alert" className={s.error}>
                {failure}
              </p>
            )}
            <div className={s.row}>
              <span className={s.meta} id="diary-composer-shortcut">
                {kind === "note"
                  ? "줄바꿈은 Enter · 추가는 ⌘/Ctrl+Enter"
                  : "Enter로 추가 · Shift+Enter로 줄바꿈"}
              </span>
              <span className={s.spacer} />
              {!body && !time && !envelopeId && !createdTask && (
                <Button
                  type="button"
                  variant="quiet"
                  size="compact"
                  disabled={disabled}
                  onClick={() => setComposerOpen(false)}
                >
                  접기
                </Button>
              )}
              <Button
                type="submit"
                disabled={disabled || (kind === "envelope" ? !envelopeId : !body.trim())}
              >
                {createdTask
                  ? "페이지에 연결"
                  : kind === "todo"
                    ? "할 일 추가"
                    : kind === "note"
                      ? "메모 추가"
                      : kind === "event"
                        ? "일정 기록 추가"
                        : "봉투 연결"}
              </Button>
            </div>
          </form>
        )}
      </div>
      <footer className={s.footer}>
        <span role="status">
          {working ? "저장 중…" : dirty ? "저장하지 않은 내용이 있어요" : "모든 기록이 저장됐어요"}
        </span>
        <span>• 할 일　○ 일정　— 메모　→ 옮김</span>
      </footer>
    </section>
  );
}

function TaskLine({
  item,
  date,
  busy,
  onToggle,
  onEdit,
  onFocus,
  onMove,
  onRemove,
}: {
  item: DataRecord;
  date: string;
  busy: boolean;
  onToggle: (item: DataRecord) => void;
  onEdit: (item: DataRecord) => void;
  onFocus?: (item: DataRecord) => void;
  onMove: (item: DataRecord, toDate: string) => Promise<boolean>;
  onRemove?: () => void;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [moving, setMoving] = useState(false);
  const [destination, setDestination] = useState(moveDay(date, 1));
  const [failure, setFailure] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const done =
    ruleOf(item).mode === "frequency"
      ? frequencyRecords(item, date).some((entry) => entry.date === date)
      : typeof item.completedAt === "number";
  return (
    <>
      <div className={s.row}>
        <Checkbox
          aria-label={text(item.title)}
          title="완료 상태 바꾸기"
          children={null}
          aria-labelledby={undefined}
          checked={done}
          disabled={busy || saving}
          onChange={() => onToggle(item)}
        />
        <button
          type="button"
          className={`${s.taskTitle} ${done ? s.completed : ""}`}
          aria-label={`${text(item.title)} 상세 보기`}
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {text(item.title)}
        </button>
        <div className={s.rowActions}>
          <Button
            size="compact"
            variant="quiet"
            disabled={busy || saving}
            onClick={() => onEdit(item)}
            aria-label={`${text(item.title)} 편집`}
          >
            편집
          </Button>
          {!done && (
            <Button
              size="compact"
              variant="quiet"
              disabled={busy || saving}
              onClick={() => setMoving((value) => !value)}
              aria-label={`${text(item.title)} 날짜 옮기기`}
            >
              옮기기
            </Button>
          )}
          {onRemove && (
            <Button
              variant="quiet"
              size="compact"
              disabled={busy || saving}
              onClick={onRemove}
              aria-label={`${text(item.title)} 페이지에서 빼기`}
              title="할 일은 남고 이 페이지의 연결만 지웁니다."
            >
              연결 빼기
            </Button>
          )}
        </div>
      </div>
      <p className={s.meta}>
        계획 · {plannedDay(item) || "미지정"}　{dueLabel(item) || "기한 없음"}
      </p>
      {!!text(item.memo) && (
        <p className={s.memoPreview}>메모 · {text(item.memo).split(/\r?\n/)[0]} · 상세 보기</p>
      )}
      {expanded && (
        <>
          <TaskReadOnlyDetails item={item} />
          {onFocus && !done && (
            <Button
              variant="secondary"
              size="compact"
              disabled={busy || saving}
              onClick={() => onFocus(item)}
            >
              25분 집중 시작
            </Button>
          )}
        </>
      )}
      {moving && (
        <form
          className={s.controls}
          onSubmit={async (event) => {
            event.preventDefault();
            if (pending.current || busy || !destination || destination === date) return;
            pending.current = true;
            setSaving(true);
            setFailure("");
            try {
              if (await onMove(item, destination)) setMoving(false);
              else setFailure("옮기지 못했어요. 다시 시도해 주세요.");
            } catch {
              setFailure("옮기지 못했어요. 다시 시도해 주세요.");
            } finally {
              pending.current = false;
              setSaving(false);
            }
          }}
        >
          <DateField
            className={s.date}
            aria-label={`${text(item.title)} 옮길 날짜`}
            required
            value={destination}
            disabled={busy || saving}
            onChange={(event) => setDestination(event.target.value)}
          />
          <Button
            type="submit"
            size="compact"
            disabled={busy || saving || !destination || destination === date}
          >
            이 날짜로 옮기기
          </Button>
          <Button
            type="button"
            variant="quiet"
            size="compact"
            disabled={busy || saving}
            onClick={() => setMoving(false)}
          >
            취소
          </Button>
        </form>
      )}
      {failure && (
        <p role="alert" className={s.error}>
          {failure}
        </p>
      )}
    </>
  );
}
