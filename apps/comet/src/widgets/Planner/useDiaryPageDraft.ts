import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { DiaryPageProps } from "./DiaryPage";
import type { DiaryEntry, DiaryEntryKind, DiaryPage as Page } from "./diaryTypes";
import { envelopeTitle, isComposing, sameEntry, type Draft } from "./diaryPageData";

type StoredDraft = {
  drafts: Record<string, Draft>;
  kind: DiaryEntryKind;
  body: string;
  time: string;
  envelopeId: string;
  createdTask: { id: string; title: string } | null;
};

export type DiaryPageComposerDraft = {
  kind: DiaryEntryKind;
  body: string;
  time: string;
  envelopeId: string;
  createdTask: StoredDraft["createdTask"];
  composerOpen: boolean;
  disabled: boolean;
  failure: string;
  setBody: (value: string) => void;
  setTime: (value: string) => void;
  setEnvelopeId: (value: string) => void;
  setComposerOpen: (value: boolean) => void;
  changeKind: (value: DiaryEntryKind) => void;
  addEntry: () => Promise<void>;
  composerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
};

export type DiaryPageDraft = {
  drafts: Record<string, Draft>;
  errors: Record<string, string>;
  entries: DiaryEntry[];
  storageFailure: boolean;
  working: boolean;
  savingId: string | null;
  dirty: boolean;
  disabled: boolean;
  changeEntry: (entry: DiaryEntry, changes: Partial<Pick<Draft, "text" | "time">>) => void;
  discardEntry: (id: string) => void;
  saveEntry: (entry: DiaryEntry) => Promise<void>;
  removeEntry: (entry: DiaryEntry) => Promise<void>;
  composer: DiaryPageComposerDraft;
};

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

export function useDiaryPageDraft({
  page,
  date,
  envelopes,
  busy,
  onDiaryAction,
  onAddTask,
  onCreatePage,
  onDirtyChange,
}: Pick<
  DiaryPageProps,
  | "page"
  | "date"
  | "envelopes"
  | "busy"
  | "onDiaryAction"
  | "onAddTask"
  | "onCreatePage"
  | "onDirtyChange"
>): DiaryPageDraft {
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

  const entries = page?.entries ?? [];
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
      if (
        await onDiaryAction("entry-delete", { pageId: page.id, id: entry.id, expectedEntry: entry })
      ) {
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

  function changeKind(value: DiaryEntryKind): void {
    setKind(value);
    if (value !== "event") setTime("");
    if (value !== "envelope") setEnvelopeId("");
    setFailure("");
  }

  return {
    drafts,
    errors,
    entries,
    storageFailure,
    working,
    savingId,
    dirty,
    disabled,
    changeEntry,
    discardEntry,
    saveEntry,
    removeEntry,
    composer: {
      kind,
      body,
      time,
      envelopeId,
      createdTask,
      composerOpen,
      disabled,
      failure,
      setBody,
      setTime,
      setEnvelopeId,
      setComposerOpen,
      changeKind,
      addEntry,
      composerKeyDown,
    },
  };
}
