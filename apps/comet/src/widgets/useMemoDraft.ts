import { useCallback, useEffect, useRef, useState } from "react";
import { command, errorText, isDesktop } from "../hooks/useSnapshot";
import type { WidgetSnapshot } from "./types";

type Draft = { body: string; fontSize: number };
type Props = Draft & { id: string; noteId: string };

export function useMemoDraft({ id, noteId, body, fontSize }: Props): {
  draft: Draft;
  status: "saved" | "unsaved" | "saving" | "error";
  error: string | null;
  edit: (patch: Partial<Draft>) => void;
  flush: () => Promise<boolean>;
  isConflict: () => boolean;
  adopt: (next: Draft) => void;
} {
  const [draft, setDraft] = useState<Draft>({ body, fontSize });
  const [status, setStatus] = useState<"saved" | "unsaved" | "saving" | "error">("saved");
  const [error, setError] = useState<string | null>(null);
  const current = useRef(draft);
  const saved = useRef(draft);
  const pending = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const conflict = useRef(false);
  const isConflict = useCallback((): boolean => conflict.current, []);

  useEffect(() => {
    const clean =
      current.current.body === saved.current.body &&
      current.current.fontSize === saved.current.fontSize;
    if (!pending.current && clean) {
      const next = { body, fontSize };
      saved.current = next;
      current.current = next;
      setDraft(next);
    }
  }, [body, fontSize]);

  const flush = useCallback((): Promise<boolean> => {
    clearTimeout(timer.current);
    if (conflict.current) {
      return Promise.resolve(false);
    }
    if (pending.current) {
      return pending.current;
    }
    async function save(): Promise<boolean> {
      try {
        while (
          current.current.body !== saved.current.body ||
          current.current.fontSize !== saved.current.fontSize
        ) {
          if (!isDesktop()) {
            throw new Error("미리보기에서는 저장하지 않아요.");
          }
          const next = { ...current.current };
          setStatus("saving");
          setError(null);
          await command<WidgetSnapshot>("save_memo_note", {
            id,
            noteId,
            ...next,
            expectedBody: saved.current.body,
          });
          saved.current = next;
        }
        setStatus("saved");
        setError(null);
        return true;
      } catch (cause: unknown) {
        setStatus("error");
        const message = errorText(cause);
        conflict.current = message.includes("다른 화면에서 이 메모가 변경됐어요");
        setError(message);
        return false;
      }
    }
    const result = save();
    pending.current = result;
    void result.finally(() => {
      pending.current = null;
    });
    return result;
  }, [id, noteId]);

  function edit(patch: Partial<Draft>): void {
    const next = { ...current.current, ...patch };
    current.current = next;
    setDraft(next);
    if (!conflict.current) setStatus("unsaved");
    clearTimeout(timer.current);
    if (!conflict.current) timer.current = setTimeout(() => void flush(), 400);
  }

  function adopt(next: Draft): void {
    clearTimeout(timer.current);
    conflict.current = false;
    current.current = next;
    saved.current = next;
    setDraft(next);
    setStatus("saved");
    setError(null);
  }

  useEffect(() => () => clearTimeout(timer.current), []);
  return { draft, status, error, edit, flush, isConflict, adopt };
}
