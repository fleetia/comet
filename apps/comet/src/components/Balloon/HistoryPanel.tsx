import type { JSX } from "react";
import type { ConversationSession, ConversationView, Persona, Snapshot } from "../../types";
import { characterName } from "../characterIdentity";
import * as s from "../companion.css";
import { ConversationHistory } from "./ConversationHistory";
import type { ConversationSaveRequest } from "./ConversationSave";

type Props = {
  snapshot: Snapshot;
  persona: Persona;
  sessions: ConversationSession[];
  loading: boolean;
  error: string | null;
  previewConversations: ConversationView[] | undefined;
  hidden: boolean;
  onResume: (sessionId: string) => void;
  onSave: (request: ConversationSaveRequest | null) => void;
};

/** Past conversations with friendship scores; stays mounted but hidden while a save is open. */
export function HistoryPanel({
  snapshot,
  persona,
  sessions,
  loading,
  error,
  previewConversations,
  hidden,
  onResume,
  onSave,
}: Props): JSX.Element {
  return (
    <div style={{ display: hidden ? "none" : "contents" }}>
      <ConversationHistory
        key={`${snapshot.user?.id}:${persona}`}
        snapshot={snapshot}
        persona={persona}
        sessions={sessions}
        loading={loading}
        error={error}
        previewConversations={previewConversations}
        onResume={onResume}
        onSave={onSave}
      />
      <div className={s.footer}>
        {snapshot.relationships.map((relationship) => (
          <span key={relationship.persona}>
            {characterName(snapshot, relationship.persona)} 친밀도 {relationship.score}/100
          </span>
        ))}
      </div>
    </div>
  );
}
