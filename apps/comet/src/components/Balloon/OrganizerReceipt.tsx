import { useEffect, useState, type JSX } from "react";
import { ActionReceipt } from "@comet/ui";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type { OrganizerAction } from "../../organizer/types";
import * as s from "../companion.css";

export function OrganizerReceipt({ inputId }: { inputId: string }): JSX.Element | null {
  const [actions, setActions] = useState<OrganizerAction[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    let loading = false;
    async function refresh(): Promise<void> {
      if (loading) return;
      loading = true;
      try {
        const result = await command<OrganizerAction[]>("organizer_actions", { inputId });
        if (active) setActions(result ?? []);
      } catch (cause) {
        if (active) setError(errorText(cause));
      } finally {
        loading = false;
      }
    }
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [inputId]);
  async function run(name: string, args?: Record<string, unknown>): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await command(name, args);
      if (name === "organizer_undo")
        setActions((previous) =>
          previous.map((action) =>
            action.id === args?.operationId ? { ...action, undone: true } : action,
          ),
        );
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPending(false);
    }
  }
  if (actions.length === 0) return null;
  return (
    <div className={s.conversationMeta} aria-label="이 요청의 정리 결과">
      {actions.map((action) => (
        <ActionReceipt
          key={action.id}
          title={action.title}
          undone={action.undone}
          pending={pending}
          undoSupported={action.undoSupported}
          undoReason={action.undoReason}
          onOpen={() => void run("organizer_open_records")}
          onUndo={() => void run("organizer_undo", { operationId: action.id })}
        />
      ))}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
