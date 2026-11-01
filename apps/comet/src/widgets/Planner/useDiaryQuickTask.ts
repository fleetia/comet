import { useEffect, useRef, useState, type RefObject } from "react";

const QUICK_TASK_DRAFT_KEY = "comet:diary:quick-task";

function readQuickTask(): { title: string; date: string | null } | null {
  try {
    return JSON.parse(localStorage.getItem(QUICK_TASK_DRAFT_KEY) || "null");
  } catch {
    return null;
  }
}

export type DiaryQuickTask = {
  open: boolean;
  title: string;
  date: string | null;
  show: () => void;
  hide: () => void;
  change: (title: string) => void;
  submit: () => Promise<void>;
  discard: () => void;
};

export function useDiaryQuickTask({
  defaultDate,
  saving,
  pending,
  createTask,
}: {
  /** The selected date for a day page, or null for tools, pages and envelopes. */
  defaultDate: string | null;
  saving: boolean;
  pending: RefObject<boolean>;
  createTask: (title: string, plannedDate: string | null) => Promise<string | null>;
}): DiaryQuickTask {
  const [draft] = useState(readQuickTask);
  const [open, setOpen] = useState(Boolean(draft?.title));
  const [title, setTitle] = useState(draft?.title ?? "");
  const [date, setDate] = useState<string | null>(draft?.date ?? null);
  // Invalidates a pending save once the draft changes, is discarded, or the diary unmounts.
  const version = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      version.current += 1;
    };
  }, []);
  useEffect(() => {
    if (!title) setDate(defaultDate);
  }, [title, defaultDate]);
  useEffect(() => {
    try {
      if (title) localStorage.setItem(QUICK_TASK_DRAFT_KEY, JSON.stringify({ title, date }));
      else localStorage.removeItem(QUICK_TASK_DRAFT_KEY);
    } catch {
      // Keep the in-memory draft if browser storage is unavailable.
    }
  }, [title, date]);

  async function submit(): Promise<void> {
    if (pending.current || saving || !title.trim() || title.length > 500) return;
    const submitted = version.current;
    if (await createTask(title, date)) {
      if (!mounted.current || submitted !== version.current) return;
      version.current += 1;
      setTitle("");
      setOpen(false);
    }
  }
  return {
    open,
    title,
    date,
    show: () => {
      if (!title) setDate(defaultDate);
      setOpen(true);
    },
    hide: () => setOpen(false),
    change: (value) => {
      version.current += 1;
      setTitle(value);
    },
    submit,
    discard: () => {
      version.current += 1;
      setTitle("");
      setOpen(false);
    },
  };
}
