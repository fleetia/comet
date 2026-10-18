import { useEffect, useState } from "react";
import type { ConversationSession, ConversationView, Persona } from "../../types";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";

type Options = {
  mode: string | undefined;
  surface: "combined" | "input";
  persona: Persona;
  userId: string | undefined;
  conversation: ConversationView | null | undefined;
  previewConversations: ConversationView[] | undefined;
};

export function useConversationSessions({
  mode,
  surface,
  persona,
  userId,
  conversation,
  previewConversations,
}: Options): {
  sessions: ConversationSession[];
  sessionsLoading: boolean;
  sessionsError: string | null;
} {
  const [sessions, setSessions] = useState<ConversationSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  useEffect(() => {
    if (mode !== "menu" && mode !== "history" && !(mode === "input" && surface === "input")) return;
    let active = true;
    setSessions([]);
    setSessionsError(null);
    if (!isDesktop()) {
      setSessionsLoading(false);
      setSessions(
        (previewConversations ?? (conversation ? [conversation] : []))
          .map((item) => item.session)
          .filter((session) => session.participants.includes(persona))
          .sort((left, right) => right.updatedAt - left.updatedAt),
      );
      return;
    }
    setSessionsLoading(true);
    void command<ConversationSession[]>("get_conversations", { persona })
      .then((result) => {
        if (active) setSessions(result ?? []);
      })
      .catch((cause: unknown) => {
        if (active) setSessionsError(errorText(cause));
      })
      .finally(() => {
        if (active) setSessionsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, persona, userId, previewConversations, surface]);
  return { sessions, sessionsLoading, sessionsError };
}
