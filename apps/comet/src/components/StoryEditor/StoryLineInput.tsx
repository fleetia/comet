import type { JSX, KeyboardEvent } from "react";
import { CharacterArtwork } from "@comet/ui";
import type { CharacterDefinition, SceneLine } from "../../types";
import * as s from "./storyPanel.css";

export function StoryLineInput({
  line,
  actor,
  index,
  label,
  onChange,
  onKeyDown,
}: {
  line: SceneLine;
  actor: CharacterDefinition | undefined;
  index: number;
  label: string;
  onChange: (text: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}): JSX.Element {
  return (
    <div className={s.lineInput}>
      <CharacterArtwork
        size="compact"
        face={actor?.expressions[line.expression]}
        style={{ width: 20, height: 20, fontSize: 8, flexShrink: 0 }}
      />
      <div className={s.textareaWrapper} data-value={line.text}>
        <textarea
          className={s.textarea}
          aria-label={label}
          data-line-index={index}
          value={line.text}
          maxLength={500}
          rows={1}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}
