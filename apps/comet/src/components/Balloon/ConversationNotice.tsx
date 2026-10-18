import type { JSX, RefObject } from "react";
import { Button } from "@comet/ui";
import * as s from "../companion.css";

type Props = {
  failedContent: string | null | undefined;
  hasCurrentReply: boolean;
  canRetry: boolean;
  recoveryReason: string | undefined;
  visibleError: string | null | undefined;
  errorRef: RefObject<HTMLParagraphElement | null>;
  pending: boolean;
  navigating: boolean;
  canCancel: boolean;
  onRetry: () => void;
  onEditInput: () => void;
  onOpenModelSettings: () => void;
  onCancel: () => void;
};

/** Failure, recovery and cancel controls for the current turn. */
export function ConversationNotice({
  failedContent,
  hasCurrentReply,
  canRetry,
  recoveryReason,
  visibleError,
  errorRef,
  pending,
  navigating,
  canCancel,
  onRetry,
  onEditInput,
  onOpenModelSettings,
  onCancel,
}: Props): JSX.Element {
  return (
    <div className={s.notice}>
      {failedContent && (
        <div aria-label="답변에 실패한 이번 입력">
          <span className={s.historyName}>
            이번 입력 · {hasCurrentReply ? "답변을 마치지 못했어요" : "답변을 받지 못했어요"}
          </span>
          <p className={s.failedInput}>{failedContent}</p>
        </div>
      )}
      {canRetry && (
        <p role="status">
          {recoveryReason === "cancelled"
            ? "생성을 멈췄어요."
            : "답변을 끝내지 못했어요. 보낸 내용은 남아 있어요."}
        </p>
      )}
      {visibleError && (
        <p ref={errorRef} className={s.error} role="alert">
          {visibleError}
        </p>
      )}
      <div className={s.row}>
        {canRetry && (
          <Button variant="ghost" disabled={pending || navigating} onClick={onRetry}>
            다시 이야기하기
          </Button>
        )}
        {canRetry && (
          <>
            <Button
              variant="ghost"
              size="small"
              disabled={pending || navigating}
              onClick={onEditInput}
            >
              입력 수정
            </Button>
            <Button
              variant="ghost"
              size="small"
              disabled={pending || navigating}
              onClick={onOpenModelSettings}
            >
              AI 연결 확인
            </Button>
          </>
        )}
        {canCancel && (
          <Button variant="ghost" size="small" disabled={pending} onClick={onCancel}>
            생성 멈추기
          </Button>
        )}
      </div>
    </div>
  );
}
