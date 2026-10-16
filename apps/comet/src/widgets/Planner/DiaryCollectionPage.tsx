import { useEffect, useRef, useState, type ReactElement } from "react";
import {
  Button,
  RecordPageEntry,
  RecordQuickAdd,
  RecordSourceLink,
  Select,
  Surface,
  Textarea,
  TextInput,
} from "@comet/ui";
import type { DiaryEntry, DiaryEntryKind, DiaryPage as Page } from "./diaryTypes";
import { DiaryPage, type DiaryPageProps } from "./DiaryPage";
import { localDay, text, type DataRecord } from "../toolData";
import { dayDate } from "./plannerData";
import * as s from "./diaryCollection.css";

type EntryDraft = {
  source: DiaryEntry;
  body: string;
  date: string;
  rating: string;
  review: string;
  sourcePageId: string;
  sourceEntryId: string;
};
type PageDraft = { source: Page; title: string; goalId: string };
type SavedDraft = { body: string; date: string; entry?: EntryDraft; page?: PageDraft };
export function discardDiaryCollectionDraft(pageId: string): void {
  window.localStorage.removeItem(`comet:diary-collection-draft:${pageId}`);
}
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isEntryKind(value: unknown): value is DiaryEntryKind {
  return (
    value === "note" ||
    value === "todo" ||
    value === "event" ||
    value === "envelope" ||
    value === "widget"
  );
}
function restoreEntry(value: unknown): DiaryEntry | undefined {
  if (
    !isObject(value) ||
    typeof value.id !== "string" ||
    typeof value.text !== "string" ||
    !isEntryKind(value.kind)
  ) {
    return undefined;
  }
  const entry: DiaryEntry = { id: value.id, text: value.text, kind: value.kind };
  for (const key of [
    "refId",
    "itemId",
    "time",
    "recordDate",
    "review",
    "sourcePageId",
    "sourceEntryId",
  ] as const) {
    if (typeof value[key] === "string") entry[key] = value[key];
  }
  if (typeof value.rating === "number") entry.rating = value.rating;
  return entry;
}
function restore(pageId: string, date: string): SavedDraft {
  const empty = { body: "", date };
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(`comet:diary-collection-draft:${pageId}`) ?? "null",
    );
    if (!isObject(value) || typeof value.body !== "string" || typeof value.date !== "string") {
      return empty;
    }
    const saved: SavedDraft = { body: value.body, date: value.date };
    const page = value.page;
    if (
      isObject(page) &&
      isObject(page.source) &&
      page.source.id === pageId &&
      typeof page.source.title === "string" &&
      page.source.date === null &&
      Array.isArray(page.source.entries) &&
      typeof page.title === "string" &&
      typeof page.goalId === "string"
    ) {
      const entries = page.source.entries.map(restoreEntry);
      if (entries.every((entry): entry is DiaryEntry => Boolean(entry))) {
        saved.page = {
          source: {
            id: pageId,
            title: page.source.title,
            date: null,
            entries,
            ...(typeof page.source.goalId === "string" ? { goalId: page.source.goalId } : {}),
          },
          title: page.title,
          goalId: page.goalId,
        };
      }
    }
    const draft = value.entry;
    if (!isObject(draft) || !isObject(draft.source)) {
      return saved;
    }
    const source = restoreEntry(draft.source);
    if (
      !source ||
      typeof draft.body !== "string" ||
      typeof draft.date !== "string" ||
      typeof draft.rating !== "string" ||
      typeof draft.review !== "string" ||
      typeof draft.sourcePageId !== "string" ||
      typeof draft.sourceEntryId !== "string"
    ) {
      return saved;
    }
    saved.entry = {
      source,
      body: draft.body,
      date: draft.date,
      rating: draft.rating,
      review: draft.review,
      sourcePageId: draft.sourcePageId,
      sourceEntryId: draft.sourceEntryId,
    };
    return saved;
  } catch {
    return empty;
  }
}
function dateLabel(date: string): string {
  return dayDate(date).toLocaleDateString("ko-KR", { month: "long", day: "numeric" });
}
function sameEntry(current: DiaryEntry | undefined, expected: DiaryEntry): boolean {
  return Boolean(
    current &&
    (
      [
        "id",
        "kind",
        "text",
        "refId",
        "itemId",
        "time",
        "recordDate",
        "rating",
        "review",
        "sourcePageId",
        "sourceEntryId",
      ] as const
    ).every((key) => current[key] === expected[key]),
  );
}
function samePage(current: Page, expected: Page): boolean {
  return (
    current.id === expected.id &&
    current.title === expected.title &&
    current.date === expected.date &&
    current.goalId === expected.goalId &&
    current.entries.length === expected.entries.length &&
    current.entries.every((entry, index) => sameEntry(entry, expected.entries[index]))
  );
}

export function DiaryCollectionPage(
  props: DiaryPageProps & {
    page: Page;
    pages?: readonly Page[];
    onOpenSourcePage?: (page: Page) => void;
    onDeleted?: () => void;
  },
): ReactElement {
  const {
    page,
    pages = [],
    busy,
    onDiaryAction,
    onDirtyChange,
    onDeleted,
    onOpenSourcePage,
  } = props;
  const [initial] = useState(() => restore(page.id, props.date));
  const [body, setBody] = useState(initial.body);
  const [date, setDate] = useState(initial.date);
  const [entryDraft, setEntryDraft] = useState(initial.entry);
  const [legacy, setLegacy] = useState(() => {
    try {
      return Boolean(window.localStorage.getItem(`comet:diary-draft:page:${page.id}`));
    } catch {
      return false;
    }
  });
  const [legacyDirty, setLegacyDirty] = useState(false);
  const [title, setTitle] = useState(initial.page?.title ?? page.title);
  const [goalId, setGoalId] = useState(initial.page?.goalId ?? page.goalId ?? "");
  const [editingPage, setEditingPage] = useState(Boolean(initial.page));
  const [pageBaseline, setPageBaseline] = useState(initial.page?.source ?? page);
  const [deleteBaseline, setDeleteBaseline] = useState(page);
  const [confirm, setConfirm] = useState<"page" | "entry" | "discard" | "discard-page" | null>(
    null,
  );
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [storageFailed, setStorageFailed] = useState(false);
  const pending = useRef(false);
  const report = useRef(onDirtyChange);
  report.current = onDirtyChange;
  const dirty = Boolean(
    body ||
    entryDraft ||
    legacyDirty ||
    (editingPage && (title !== pageBaseline.title || goalId !== (pageBaseline.goalId ?? ""))),
  );
  const disabled = busy || working;
  useEffect(() => {
    report.current?.(dirty);
  }, [dirty]);
  useEffect(
    () => () => {
      report.current?.(false);
    },
    [],
  );
  useEffect(() => {
    try {
      if (body || entryDraft || editingPage) {
        window.localStorage.setItem(
          `comet:diary-collection-draft:${page.id}`,
          JSON.stringify({
            body,
            date,
            entry: entryDraft,
            page: editingPage ? { source: pageBaseline, title, goalId } : undefined,
          }),
        );
      } else {
        discardDiaryCollectionDraft(page.id);
      }
      setStorageFailed(false);
    } catch {
      setStorageFailed(true);
    }
  }, [body, date, entryDraft, page.id, editingPage, pageBaseline, title, goalId]);
  const groups = new Map<string, DiaryEntry[]>();
  for (const entry of [...page.entries].sort((a, b) =>
    (b.recordDate ?? "").localeCompare(a.recordDate ?? ""),
  )) {
    const month = entry.recordDate?.slice(0, 7) ?? "";
    groups.set(month, [...(groups.get(month) ?? []), entry]);
  }
  const goals = props.items.filter((item) =>
    ["week", "month", "year", "someday"].includes(text(item.planPeriod)),
  );
  const goal = props.items.find((item) => text(item.id) === page.goalId);
  const currentEntry = entryDraft
    ? page.entries.find((entry) => entry.id === entryDraft.source.id)
    : undefined;
  const entryConflict = Boolean(entryDraft && !sameEntry(currentEntry, entryDraft.source));
  const pageConflict = editingPage && !samePage(page, pageBaseline);
  const currentSourcePage = pages.find((candidate) => candidate.id === currentEntry?.sourcePageId);
  const currentSourceEntry = currentSourcePage?.entries.find(
    (entry) => entry.id === currentEntry?.sourceEntryId,
  );
  async function persist(action: string, input: DataRecord, success: () => void): Promise<void> {
    if (disabled || pending.current) {
      return;
    }
    pending.current = true;
    setWorking(true);
    setError("");
    try {
      if (await onDiaryAction(action, input)) {
        success();
        setConfirm(null);
      } else {
        setError("저장하지 못했어요. 입력한 내용은 남아 있어요.");
      }
    } catch {
      setError("저장하지 못했어요. 입력한 내용은 남아 있어요.");
    } finally {
      pending.current = false;
      setWorking(false);
    }
  }
  function add(): void {
    if (!body.trim()) {
      return;
    }
    if (date && localDay(dayDate(date)) !== date) {
      setError("기록 날짜를 확인해 주세요.");
      return;
    }
    void persist(
      "entry-add",
      { pageId: page.id, kind: "note", text: body, recordDate: date || null },
      () => setBody(""),
    );
  }
  function openEntry(entry: DiaryEntry): void {
    if (disabled || entryDraft || editingPage) {
      return;
    }
    setEntryDraft({
      source: entry,
      body: entry.text,
      date: entry.recordDate ?? "",
      rating: entry.rating === undefined ? "" : String(entry.rating),
      review: entry.review ?? "",
      sourcePageId: entry.sourcePageId ?? "",
      sourceEntryId: entry.sourceEntryId ?? "",
    });
    setError("");
  }
  function saveEntry(): void {
    if (!entryDraft || !entryDraft.body.trim()) {
      return;
    }
    if (entryDraft.date && localDay(dayDate(entryDraft.date)) !== entryDraft.date) {
      setError("기록 날짜를 확인해 주세요.");
      return;
    }
    if (entryConflict) {
      setError("다른 곳에서 기록이 바뀌었어요. 최신 내용을 확인한 뒤 계속 수정해 주세요.");
      return;
    }
    void persist(
      "entry-update",
      {
        pageId: page.id,
        id: entryDraft.source.id,
        text: entryDraft.body,
        recordDate: entryDraft.date || null,
        rating: entryDraft.rating ? Number(entryDraft.rating) : null,
        review: entryDraft.review,
        sourcePageId: entryDraft.sourcePageId || null,
        sourceEntryId: entryDraft.sourceEntryId || null,
        expectedEntry: entryDraft.source,
      },
      () => setEntryDraft(undefined),
    );
  }
  function source(entry: DiaryEntry): ReactElement | undefined {
    const original = pages.find((item) => item.id === entry.sourcePageId);
    if (entry.sourcePageId) {
      return original && onOpenSourcePage ? (
        <RecordSourceLink
          href="#"
          onClick={(event) => {
            event.preventDefault();
            onOpenSourcePage(original);
          }}
        >
          {original.date ? `${dateLabel(original.date)} 한 줄 기록에서` : `${original.title}에서`}
        </RecordSourceLink>
      ) : (
        <span className={s.label}>원본 페이지를 찾을 수 없어요.</span>
      );
    }
    if (!entry.refId) {
      return undefined;
    }
    const item = props.items.find((item) => text(item.id) === entry.refId);
    if (entry.kind === "todo" && item) {
      return (
        <Button size="small" variant="link" onClick={() => props.onEditTask(item)}>
          연결한 할 일 열기
        </Button>
      );
    }
    if (entry.kind === "envelope") {
      return (
        <Button size="small" variant="link" onClick={() => props.onOpenEnvelope(entry.refId ?? "")}>
          준비 봉투 열기
        </Button>
      );
    }
    if (entry.kind === "widget" && props.onOpenWidgetEntry) {
      return (
        <Button size="small" variant="link" onClick={() => props.onOpenWidgetEntry?.(entry)}>
          연결한 위젯 열기
        </Button>
      );
    }
    const event = props.events.find((item) => text(item.id) === entry.refId);
    if (entry.kind === "event" && event && props.onOpenEvent) {
      return (
        <Button size="small" variant="link" onClick={() => props.onOpenEvent?.(event)}>
          연결한 일정 열기
        </Button>
      );
    }
    return <span className={s.label}>연결한 항목을 찾을 수 없어요.</span>;
  }
  if (legacy) {
    return (
      <div className={s.main}>
        <Button
          variant="link"
          size="small"
          disabled={legacyDirty || disabled}
          onClick={() => setLegacy(false)}
        >
          월별 페이지로 돌아가기
        </Button>
        <DiaryPage {...props} onDirtyChange={setLegacyDirty} />
      </div>
    );
  }
  return (
    <div className={s.layout}>
      <main className={s.main}>
        <RecordQuickAdd
          layout="page"
          value={body}
          onValueChange={setBody}
          kind="note"
          kinds={[{ value: "note", label: "메모" }]}
          onKindChange={() => {}}
          onAdd={add}
          label="페이지에 기록할 내용"
          placeholder="제목이나 한 줄 감상 · Enter로 기록"
          disabled={disabled || Boolean(entryDraft) || editingPage}
          trailing={
            <TextInput
              type="date"
              aria-label="기록 날짜"
              value={date}
              className={s.date}
              disabled={disabled || Boolean(entryDraft) || editingPage}
              onChange={(event) => setDate(event.target.value)}
            />
          }
        />
        {groups.size === 0 && <p className={s.caption}>첫 기록을 남겨 보세요.</p>}
        {[...groups].map(([month, entries]) => (
          <section className={s.main} key={month || "undated"} aria-label={month || "날짜 없음"}>
            <h3 className={s.month}>
              {month ? `${month.slice(0, 4)}년 ${Number(month.slice(5))}월` : "날짜 없음"}
            </h3>
            <div className={s.group}>
              {entries.map((entry, index) => (
                <RecordPageEntry
                  key={entry.id}
                  layout="fill"
                  divided={index > 0}
                  date={entry.recordDate ? dateLabel(entry.recordDate) : "날짜 없음"}
                  title={<span className={s.title}>{entry.text}</span>}
                  review={entry.review}
                  rating={entry.rating}
                  source={source(entry)}
                  onMenu={() => openEntry(entry)}
                  menuLabel={`${entry.text} 기록 수정`}
                />
              ))}
            </div>
          </section>
        ))}
        {entryDraft && (
          <Surface variant="sheet" className={s.editor} role="dialog" aria-label="페이지 기록 수정">
            <form
              className={s.form}
              onSubmit={(event) => {
                event.preventDefault();
                saveEntry();
              }}
            >
              {entryConflict && (
                <div className={s.form} role="status">
                  <p className={s.caption}>
                    {currentEntry
                      ? "다른 곳에서 저장한 최신 기록이에요. 작성 중인 입력은 그대로 남아 있어요."
                      : "이 기록이 다른 곳에서 삭제되었어요. 작성 중인 입력은 그대로 남아 있어요."}
                  </p>
                  {currentEntry && (
                    <>
                      <p className={s.caption}>{currentEntry.text}</p>
                      <p className={s.caption}>
                        날짜: {currentEntry.recordDate || "날짜 없음"} · 별점:{" "}
                        {currentEntry.rating === undefined
                          ? "선택 안 함"
                          : `${currentEntry.rating}점`}
                      </p>
                      <p className={s.caption}>한 줄 평: {currentEntry.review || "없음"}</p>
                      <p className={s.caption}>
                        원본:{" "}
                        {currentEntry.sourcePageId
                          ? currentSourcePage?.title ||
                            currentSourcePage?.date ||
                            "원본 페이지를 찾을 수 없어요."
                          : "연결 없음"}
                        {currentEntry.sourceEntryId
                          ? ` · ${currentSourceEntry?.text || "원본 기록을 찾을 수 없어요."}`
                          : ""}
                      </p>
                      <Button
                        size="small"
                        variant="ghost"
                        disabled={disabled}
                        onClick={() => {
                          setEntryDraft({ ...entryDraft, source: currentEntry });
                          setError("");
                        }}
                      >
                        최신 기록을 기준으로 계속 수정
                      </Button>
                    </>
                  )}
                </div>
              )}
              <TextInput
                className={s.input}
                label="기록 날짜"
                type="date"
                value={entryDraft.date}
                disabled={disabled}
                onChange={(event) => setEntryDraft({ ...entryDraft, date: event.target.value })}
              />
              <Textarea
                className={s.input}
                label="기록 내용"
                value={entryDraft.body}
                disabled={disabled}
                onChange={(event) => setEntryDraft({ ...entryDraft, body: event.target.value })}
              />
              <Select
                className={s.select}
                label="별점"
                value={entryDraft.rating}
                disabled={disabled}
                onChange={(event) => setEntryDraft({ ...entryDraft, rating: event.target.value })}
              >
                <option value="">선택 안 함</option>
                {[0, 1, 2, 3, 4, 5].map((rating) => (
                  <option key={rating} value={rating}>
                    {rating}점
                  </option>
                ))}
              </Select>
              <Textarea
                className={s.input}
                label="한 줄 평"
                value={entryDraft.review}
                disabled={disabled}
                onChange={(event) => setEntryDraft({ ...entryDraft, review: event.target.value })}
              />
              <Select
                className={s.select}
                label="원본 페이지"
                value={entryDraft.sourcePageId}
                disabled={disabled}
                onChange={(event) =>
                  setEntryDraft({
                    ...entryDraft,
                    sourcePageId: event.target.value,
                    sourceEntryId: "",
                  })
                }
              >
                <option value="">연결 없음</option>
                {pages
                  .filter((candidate) => candidate.id !== page.id)
                  .map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.date ?? candidate.title}
                    </option>
                  ))}
              </Select>
              {entryDraft.sourcePageId && (
                <Select
                  className={s.select}
                  label="원본 기록"
                  value={entryDraft.sourceEntryId}
                  disabled={disabled}
                  onChange={(event) =>
                    setEntryDraft({ ...entryDraft, sourceEntryId: event.target.value })
                  }
                >
                  <option value="">페이지 전체</option>
                  {pages
                    .find((candidate) => candidate.id === entryDraft.sourcePageId)
                    ?.entries.map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.text}
                      </option>
                    ))}
                </Select>
              )}
              <div className={s.row}>
                <Button
                  type="submit"
                  size="small"
                  disabled={disabled || entryConflict || !entryDraft.body.trim()}
                >
                  기록 저장
                </Button>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => setConfirm("discard")}
                >
                  닫기
                </Button>
                <Button
                  size="small"
                  variant="danger"
                  disabled={disabled}
                  onClick={() => setConfirm("entry")}
                >
                  기록 삭제…
                </Button>
              </div>
            </form>
          </Surface>
        )}
        {(error || storageFailed) && (
          <p role="alert" className={s.error}>
            {error || "이 기기에 초안을 보관하지 못했어요. 닫기 전에 기록을 저장해 주세요."}
          </p>
        )}
      </main>
      <aside className={s.info} aria-label="페이지 정보">
        <p className={s.label}>이 페이지</p>
        <p className={s.caption}>
          날짜와 상관없이 이어 쓰는 나의 페이지예요. 기록에 날짜와 별점, 한 줄 평을 붙이고 원본
          페이지로 이어 볼 수 있어요.
        </p>
        <div className={s.metrics}>
          <div className={s.metric}>
            <span className={s.label}>기록</span>
            <span className={s.value}>{page.entries.length}개</span>
          </div>
          <div className={s.metric}>
            <span className={s.label}>연결한 목표</span>
            <span className={s.value}>
              {goal ? (typeof goal.completedAt === "number" ? "완료" : "진행 중") : "없음"}
            </span>
          </div>
        </div>
        {goal && (
          <Button size="small" variant="link" onClick={() => props.onEditTask(goal)}>
            {text(goal.title)} · 기간 계획 열기
          </Button>
        )}
        <div className={s.row}>
          <Button
            size="small"
            variant="ghost"
            disabled={disabled || Boolean(entryDraft) || editingPage}
            onClick={() => {
              setTitle(page.title);
              setGoalId(page.goalId ?? "");
              setPageBaseline(page);
              setEditingPage(true);
            }}
          >
            이름·목표 바꾸기
          </Button>
          <Button
            size="small"
            variant="danger"
            disabled={disabled}
            onClick={() => {
              setDeleteBaseline(page);
              setConfirm("page");
            }}
          >
            페이지 지우기…
          </Button>
        </div>
        {editingPage && (
          <form
            className={s.form}
            onSubmit={(event) => {
              event.preventDefault();
              if (pageConflict) return;
              void persist(
                "page-update",
                { id: page.id, title, goalId: goalId || null, expectedPage: pageBaseline },
                () => setEditingPage(false),
              );
            }}
          >
            {pageConflict && (
              <div className={s.form} role="status">
                <p className={s.caption}>
                  다른 곳에서 페이지가 바뀌었어요. 작성 중인 이름과 목표는 그대로 남아 있어요.
                </p>
                <p className={s.caption}>
                  최신 이름: {page.title} · 기록 {page.entries.length}개
                </p>
                <p className={s.caption}>
                  최신 목표:{" "}
                  {goal
                    ? text(goal.title)
                    : page.goalId
                      ? "연결한 목표를 찾을 수 없어요."
                      : "연결 없음"}
                </p>
                <Button
                  size="small"
                  variant="ghost"
                  disabled={disabled}
                  onClick={() => {
                    setPageBaseline(page);
                    setError("");
                  }}
                >
                  최신 페이지를 기준으로 계속 수정
                </Button>
              </div>
            )}
            <TextInput
              label="페이지 이름"
              value={title}
              disabled={disabled}
              onChange={(event) => setTitle(event.target.value)}
            />
            <Select
              className={s.select}
              label="이어 볼 기간 목표"
              value={goalId}
              disabled={disabled}
              onChange={(event) => setGoalId(event.target.value)}
            >
              <option value="">연결 안 함</option>
              {goals.map((item) => (
                <option key={text(item.id)} value={text(item.id)}>
                  {text(item.title)}
                </option>
              ))}
            </Select>
            <Button type="submit" size="small" disabled={disabled || pageConflict || !title.trim()}>
              페이지 정보 저장
            </Button>
            <Button
              size="small"
              variant="ghost"
              disabled={disabled}
              onClick={() => setConfirm("discard-page")}
            >
              정보 수정 취소
            </Button>
          </form>
        )}
        <Button
          size="small"
          variant="link"
          disabled={disabled || Boolean(body || entryDraft || editingPage)}
          onClick={() => setLegacy(true)}
        >
          할 일·위젯 연결과 기존 기록 편집
        </Button>
      </aside>
      {confirm && (
        <Surface
          variant="sheet"
          className={s.editor}
          role="dialog"
          aria-label={
            confirm === "page"
              ? "페이지 삭제 확인"
              : confirm === "entry"
                ? "기록 삭제 확인"
                : "입력 버리기 확인"
          }
        >
          <div className={s.form}>
            <p className={s.caption}>
              {confirm === "page"
                ? "이 페이지와 기록을 삭제해요. 연결한 할 일·위젯·목표의 원본은 유지해요."
                : confirm === "entry"
                  ? "이 기록을 삭제할까요? 원본으로 연결한 기록은 유지해요."
                  : "수정 중인 입력을 버릴까요?"}
            </p>
            <div className={s.row}>
              <Button
                size="small"
                variant="ghost"
                disabled={disabled}
                onClick={() => setConfirm(null)}
              >
                취소
              </Button>
              <Button
                size="small"
                variant="danger"
                disabled={disabled}
                onClick={() => {
                  if (confirm === "discard") {
                    setEntryDraft(undefined);
                    setConfirm(null);
                    return;
                  }
                  if (confirm === "discard-page") {
                    setEditingPage(false);
                    setConfirm(null);
                    return;
                  }
                  if (confirm === "page") {
                    if (!samePage(page, deleteBaseline)) {
                      setError(
                        "다른 곳에서 페이지가 바뀌었어요. 최신 내용을 확인한 뒤 다시 삭제해 주세요.",
                      );
                      return;
                    }
                    void persist(
                      "page-delete",
                      { id: page.id, expectedPage: deleteBaseline },
                      () => {
                        discardDiaryCollectionDraft(page.id);
                        onDeleted?.();
                      },
                    );
                  } else if (entryDraft) {
                    if (
                      !sameEntry(
                        page.entries.find((entry) => entry.id === entryDraft.source.id),
                        entryDraft.source,
                      )
                    ) {
                      setError(
                        "다른 곳에서 기록이 바뀌었어요. 입력을 유지했으니 최신 내용을 확인해 주세요.",
                      );
                      return;
                    }
                    void persist(
                      "entry-delete",
                      {
                        pageId: page.id,
                        id: entryDraft.source.id,
                        expectedEntry: entryDraft.source,
                      },
                      () => setEntryDraft(undefined),
                    );
                  }
                }}
              >
                확인
              </Button>
            </div>
          </div>
        </Surface>
      )}
    </div>
  );
}
