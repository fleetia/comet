import type { JSX } from "react";
import type { ConversationView, Message, Snapshot } from "../../types";
import * as s from "../companion.css";
import { ConversationLog } from "./ConversationHistory";
import { ConversationMessageActions, type ConversationSaveRequest } from "./ConversationSave";

type Props = {
  snapshot: Snapshot;
  conversation: ConversationView;
  latestUser: Message | undefined;
  latestUserOpen: boolean;
  onLatestUserOpenChange: (open: boolean) => void;
  logOpen: boolean;
  onLogOpenChange: (open: boolean) => void;
  onSave: (message: Message, kind: ConversationSaveRequest["kind"]) => void;
};

/** Collapsed "최근에 한 말" and "이번 대화" sections; their content mounts only while open. */
export function ConversationDisclosures({
  snapshot,
  conversation,
  latestUser,
  latestUserOpen,
  onLatestUserOpenChange,
  logOpen,
  onLogOpenChange,
  onSave,
}: Props): JSX.Element {
  return (
    <>
      {latestUser && (
        <details
          className={s.conversationDetails}
          open={latestUserOpen}
          onToggle={(event) => onLatestUserOpenChange(event.currentTarget.open)}
        >
          <summary className={s.conversationSummary}>최근에 한 말</summary>
          {latestUserOpen && (
            <>
              <p className={s.historyMessage}>{latestUser.content}</p>
              <ConversationMessageActions
                message={latestUser}
                onSave={(kind) => onSave(latestUser, kind)}
              />
            </>
          )}
        </details>
      )}
      <details
        className={s.conversationDetails}
        open={logOpen}
        onToggle={(event) => onLogOpenChange(event.currentTarget.open)}
      >
        <summary className={s.conversationSummary}>이번 대화</summary>
        {logOpen && (
          <ConversationLog
            key={conversation.session.id}
            snapshot={snapshot}
            sessionId={conversation.session.id}
            page={conversation}
            onSave={onSave}
          />
        )}
      </details>
    </>
  );
}
