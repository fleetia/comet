import { useId, type CSSProperties, type JSX, type ReactNode, type RefObject } from "react";
import { ArrowRightIcon } from "@comet/icon";
import { Balloon as NoticeBalloon, Button as CometButton, IconButton } from "@comet/ui";
import * as s from "../companion.css";

type Props = {
  hostRef: RefObject<HTMLElement | null>;
  speakerName: string;
  skinFramed: boolean;
  skinned: CSSProperties | undefined;
  textStyle: CSSProperties;
  fullText: string;
  expanded: boolean;
  navigating: boolean;
  visibleError: string | null | undefined;
  children: ReactNode;
  onExpand: () => void;
  onOpenSettings: () => void;
  onClose: () => void;
};

/** A collapsed update line that expands into its single navigation action. */
export function UpdateNoticeBalloon({
  hostRef,
  speakerName,
  skinFramed,
  skinned,
  textStyle,
  fullText,
  expanded,
  navigating,
  visibleError,
  children,
  onExpand,
  onOpenSettings,
  onClose,
}: Props): JSX.Element {
  const actionsId = useId();
  return (
    <section ref={hostRef} className={s.updateNoticeHost} aria-label="업데이트 알림">
      <NoticeBalloon
        aria-live="polite"
        speakerName={speakerName}
        tail={skinFramed ? "none" : "left"}
        content={expanded ? "actions" : "text"}
        className={`${s.updateNoticeBalloon} ${skinFramed ? s.balloonSkinned : ""}`}
        style={skinned}
        speechTrigger={{
          "aria-label": fullText,
          "aria-expanded": expanded,
          "aria-controls": expanded ? actionsId : undefined,
          disabled: navigating,
          style: { ...textStyle, lineHeight: 1.65, wordBreak: "keep-all" },
          onClick: () => {
            if (!expanded) onExpand();
          },
        }}
        actions={
          expanded && (
            <div id={actionsId} className={s.updateNoticeAction}>
              <CometButton
                variant="link"
                trailingIcon={<ArrowRightIcon size={14} />}
                disabled={navigating}
                onClick={onOpenSettings}
              >
                이동하기
              </CometButton>
            </div>
          )
        }
      >
        {children}
      </NoticeBalloon>
      <IconButton
        className={s.balloonClose}
        size="compact"
        icon="close"
        aria-label="업데이트 알림 닫기"
        disabled={navigating}
        onClick={onClose}
      />
      {visibleError && (
        <p className={s.error} role="alert">
          {visibleError}
        </p>
      )}
    </section>
  );
}
