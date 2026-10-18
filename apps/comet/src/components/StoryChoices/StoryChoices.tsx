import { useEffect, useId, useRef, useState, type CSSProperties, type JSX } from "react";
import { Balloon, type BalloonProps, Button, ConstellationChoices, IconButton } from "@comet/ui";
import type { Dispatch, StoryRequest } from "../../types";
import { errorText } from "../../hooks/useSnapshot";
import * as s from "./story.css";

type Props = {
  story: StoryRequest;
  dispatch: Dispatch;
  textStyle?: CSSProperties;
  speakerName?: string;
  speaker?: BalloonProps["speaker"];
  balloonClassName?: string;
  balloonStyle?: CSSProperties;
  skinned?: boolean;
  onClose?: () => void;
};

export function StoryChoices({
  story,
  dispatch,
  textStyle,
  speakerName,
  speaker,
  balloonClassName,
  balloonStyle,
  skinned,
  onClose,
}: Props): JSX.Element {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const alive = useRef(true);
  const currentRequest = useRef(story.id);
  currentRequest.current = story.id;
  const titleId = useId();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function choose(choiceId?: string): Promise<void> {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    const requestId = story.id;
    try {
      await dispatch(choiceId ? "choose_story" : "defer_story", {
        requestId,
        ...(choiceId ? { choiceId } : {}),
      });
    } catch (cause) {
      if (alive.current && currentRequest.current === requestId) setError(errorText(cause));
    } finally {
      lock.current = false;
      if (alive.current && currentRequest.current === requestId) setPending(false);
    }
  }
  return (
    <div className={s.story} role="group" aria-labelledby={titleId}>
      <span className={s.title} id={titleId}>
        {story.title}
      </span>
      <Balloon
        speaker={speaker}
        speakerName={speakerName}
        tail={skinned ? "none" : "left"}
        tailClassName={s.promptTail}
        className={`${s.promptBalloon} ${balloonClassName ?? ""}`}
        style={balloonStyle}
      >
        <p className={s.prompt} style={textStyle} aria-live="polite">
          {story.prompt}
        </p>
      </Balloon>
      {onClose && (
        <IconButton
          className={s.close}
          size="compact"
          icon="close"
          aria-label="이야기 닫기"
          onClick={onClose}
        />
      )}
      <div className={s.choices}>
        <ConstellationChoices
          label="이야기 선택지"
          options={story.choices.map((choice) => ({ ...choice, disabled: pending }))}
          onChoose={(id) => void choose(id)}
        />
        <Button
          className={s.defer}
          variant="ghost"
          size="small"
          disabled={pending}
          onClick={() => void choose()}
        >
          다음에 듣기
        </Button>
      </div>
      {pending && (
        <p className={s.status} role="status">
          이야기를 이어가고 있어요.
        </p>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
