import { useRef, useState, type CSSProperties, type JSX } from "react";
import { ConstellationChoice } from "@comet/ui";
import { Button } from "../../ui";
import type { Dispatch, StoryRequest } from "../../types";
import { errorText } from "../../hooks/useSnapshot";
import * as s from "./story.css";
import * as ui from "../../common.css";

type Props = { story: StoryRequest; dispatch: Dispatch; textStyle?: CSSProperties };

export function StoryChoices({ story, dispatch, textStyle }: Props): JSX.Element {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  async function choose(choiceId?: string): Promise<void> {
    if (lock.current) return;
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      await dispatch(choiceId ? "choose_story" : "defer_story", {
        requestId: story.id,
        ...(choiceId ? { choiceId } : {}),
      });
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return (
    <div className={s.story}>
      <p className={ui.quiet}>{story.title}</p>
      <p className={s.prompt} style={textStyle} aria-live="polite">
        {story.prompt}
      </p>
      <div className={s.choices} role="group" aria-label="이야기 선택지">
        {story.choices.map((choice) => (
          <ConstellationChoice
            key={choice.id}
            disabled={pending}
            className={s.choice}
            onClick={() => void choose(choice.id)}
          >
            {choice.label}
          </ConstellationChoice>
        ))}
        <Button variant="quiet" disabled={pending} onClick={() => void choose()}>
          다음에 듣기
        </Button>
      </div>
      {pending && (
        <p className={ui.quiet} role="status">
          이야기를 이어가고 있어요.
        </p>
      )}
      {error && (
        <p className={ui.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
