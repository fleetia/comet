import type { JSX, KeyboardEvent, RefObject } from "react";
import { SendIcon } from "@comet/icon";
import { WaitingDots } from "@comet/ui";
import type { Persona } from "../../types";
import { Button, Select, TextArea } from "../../ui";
import * as ui from "../../common.css";
import * as s from "../companion.css";

/** Composition and Enter handlers shared by every conversation editor. */
export type EditorKeyHandlers = {
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
};

type Props = {
  availability: { ready: boolean; label: string };
  navigating: boolean;
  onOpenModelSettings: () => void;
  target: Persona | "all";
  onTargetChange: (target: Persona | "all") => void;
  recipientLocked: boolean;
  recipient: Persona;
  recipientName: string;
  offerAll: boolean;
  showEditor: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
  input: string;
  inputLabel: string;
  inputDisabled: boolean;
  onInputChange: (value: string) => void;
  editorKeys: EditorKeyHandlers;
  pending: boolean;
  sendDisabled: boolean;
  responding: boolean;
  onSubmit: () => void;
  onFinish: (() => void) | undefined;
};

export function ConversationForm({
  availability,
  navigating,
  onOpenModelSettings,
  target,
  onTargetChange,
  recipientLocked,
  recipient,
  recipientName,
  offerAll,
  showEditor,
  inputRef,
  input,
  inputLabel,
  inputDisabled,
  onInputChange,
  editorKeys,
  pending,
  sendDisabled,
  responding,
  onSubmit,
  onFinish,
}: Props): JSX.Element {
  return (
    <form
      className={s.form}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div aria-label="대화 가능 상태">
        <div className={s.row}>
          <p className={s.conversationMeta}>{availability.label}</p>
          {!availability.ready && (
            <Button
              variant="quiet"
              size="compact"
              disabled={navigating}
              onClick={onOpenModelSettings}
            >
              AI 연결 설정
            </Button>
          )}
        </div>
      </div>
      <div className={s.recipientRow}>
        <label className={ui.quiet}>
          받는 친구{" "}
          <Select
            className={s.recipient}
            value={target}
            disabled={recipientLocked || navigating}
            onChange={(event) => onTargetChange(event.target.value as Persona | "all")}
          >
            <option value={recipient}>{recipientName}</option>
            {offerAll && <option value="all">모두에게</option>}
          </Select>
        </label>
        <span className={ui.quiet}>Shift + Enter 줄바꿈</span>
      </div>
      {showEditor && (
        <div className={s.inputCapsule}>
          <TextArea
            resize="none"
            ref={inputRef}
            className={s.input}
            aria-label={inputLabel}
            value={input}
            rows={3}
            disabled={inputDisabled}
            maxLength={2000}
            placeholder="하고 싶은 이야기를 적어 줘."
            onChange={(event) => onInputChange(event.target.value)}
            {...editorKeys}
          />
          <Button
            type="submit"
            className={s.capsuleSend}
            aria-label={pending ? "전송 중" : "보내기"}
            disabled={sendDisabled}
          >
            <SendIcon size={18} />
          </Button>
        </div>
      )}
      {showEditor && responding && (
        <div className={s.recipientRow}>
          <WaitingDots label="답변 준비 중" />
        </div>
      )}
      {onFinish && (
        <Button variant="quiet" size="compact" disabled={navigating} onClick={onFinish}>
          대화 끝내기
        </Button>
      )}
    </form>
  );
}
