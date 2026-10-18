import type { CSSProperties, JSX, ReactNode } from "react";
import type { ConversationView, Message, Persona, Snapshot } from "../../types";
import { characterName } from "../characterIdentity";
import * as s from "../companion.css";
import { responseOrigin } from "./conversationStatus";
import { ConversationMessageActions, type ConversationSaveRequest } from "./ConversationSave";

type Props = {
  snapshot: Snapshot;
  conversation: ConversationView;
  persona: Persona;
  showSpeech: boolean;
  textStyle: CSSProperties;
  fullText: string;
  speech: ReactNode;
  latestReply: Message | undefined;
  previousReply: boolean;
  onSave: (message: Message, kind: ConversationSaveRequest["kind"]) => void;
};

/** The live playback line, or the latest retained reply with its save actions. */
export function ConversationReply({
  snapshot,
  conversation,
  persona,
  showSpeech,
  textStyle,
  fullText,
  speech,
  latestReply,
  previousReply,
  onSave,
}: Props): JSX.Element {
  const playback = snapshot.playback;
  return (
    <>
      {showSpeech && (playback || latestReply) && (
        <div
          className={s.conversationSpeech}
          style={textStyle}
          aria-live="polite"
          aria-label={playback ? fullText : undefined}
        >
          <span className={s.historyName}>
            {!playback && previousReply && "이전 답변 · "}
            {!playback && latestReply && conversation.characterNames?.[latestReply.id]
              ? conversation.characterNames[latestReply.id]
              : characterName(snapshot, playback?.persona ?? latestReply?.persona ?? persona)}
          </span>
          <span className={s.responseOrigin}>
            {responseOrigin(
              playback?.source ??
                (latestReply ? conversation.messageSources?.[latestReply.id] : undefined),
            )}
          </span>
          {playback ? speech : latestReply?.content}
        </div>
      )}
      {latestReply && !playback && (
        <div className={s.notice}>
          <ConversationMessageActions
            message={latestReply}
            onSave={(kind) => onSave(latestReply, kind)}
          />
        </div>
      )}
    </>
  );
}
