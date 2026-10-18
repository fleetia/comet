import type { JSX } from "react";
import { Icon } from "@comet/icon";
import { Button as CometButton } from "@comet/ui";
import * as surfaceStyle from "./conversationSurface.css";

/** Shortcuts above the separate desktop input: resume, talk together and past conversations. */
export function InputSurfaceActions({
  resumeDisabled,
  togetherDisabled,
  historyDisabled,
  onResume,
  onTogether,
  onHistory,
}: {
  resumeDisabled: boolean;
  togetherDisabled: boolean;
  historyDisabled: boolean;
  onResume: () => void;
  onTogether: () => void;
  onHistory: () => void;
}): JSX.Element {
  return (
    <div className={surfaceStyle.inputActions}>
      <CometButton
        variant="ghost"
        className={`${surfaceStyle.inputAction} ${surfaceStyle.resumeAction}`}
        leadingIcon={<Icon name="resume" size={15} />}
        disabled={resumeDisabled}
        onClick={onResume}
      >
        이어서 하기
      </CometButton>
      <CometButton
        variant="ghost"
        className={`${surfaceStyle.inputAction} ${surfaceStyle.togetherAction}`}
        leadingIcon={<Icon name="together" size={15} />}
        disabled={togetherDisabled}
        onClick={onTogether}
      >
        함께 이야기해 봐
      </CometButton>
      <CometButton
        variant="ghost"
        className={`${surfaceStyle.inputAction} ${surfaceStyle.historyAction}`}
        leadingIcon={<Icon name="history" size={15} />}
        disabled={historyDisabled}
        onClick={onHistory}
      >
        지난 대화
      </CometButton>
    </div>
  );
}
