import type { JSX } from "react";
import { Button, Select, Textarea } from "@comet/ui";
import type { AnimationClip, CharacterLine } from "../../types";
import { DEFAULT_EXPRESSION } from "../characterIdentity";
import { MotionSelect } from "../MotionSelect/MotionSelect";
import * as e from "./CharacterEditor.css";
import * as s from "../characters.css";

export function Lines({
  title,
  lines,
  limit,
  expressions,
  clips,
  onChange,
  onSelect,
  allowEmpty = false,
}: {
  title: string;
  lines: CharacterLine[];
  limit: number;
  expressions: string[];
  clips: AnimationClip[];
  onChange: (lines: CharacterLine[]) => void;
  onSelect: (index: number) => void;
  allowEmpty?: boolean;
}): JSX.Element {
  return (
    <section className={e.authoredGroup} aria-label={`${title} 대사`}>
      <div className={e.authoredHeading}>
        <h3 className={s.subheading}>
          {title} · {lines.length} / {limit}줄
        </h3>
        <Button
          variant="ghost"
          type="button"
          disabled={lines.length >= limit}
          onClick={() => onChange([...lines, { expression: DEFAULT_EXPRESSION, text: "" }])}
        >
          {title} 대사 추가
        </Button>
      </div>
      {lines.map((line, index) => (
        <div className={e.authoredRow} key={index}>
          <span className={s.small}>{index + 1}</span>
          <Textarea
            layout="flexible"
            fill
            className={e.authoredText}
            aria-label={`${title} ${index + 1} 대사`}
            rows={1}
            maxLength={500}
            required
            value={line.text}
            onFocus={() => onSelect(index)}
            onChange={(event) => {
              onSelect(index);
              onChange(
                lines.map((value, i) =>
                  i === index ? { ...value, text: event.target.value } : value,
                ),
              );
            }}
          />
          <Select
            fill
            aria-label={`${title} ${index + 1} 표정`}
            value={line.expression}
            onChange={(event) =>
              onChange(
                lines.map((value, i) =>
                  i === index ? { ...value, expression: event.target.value } : value,
                ),
              )
            }
          >
            {[...new Set([...expressions, line.expression])].map((expression) => (
              <option key={expression}>{expression}</option>
            ))}
          </Select>
          <div className={e.authoredMotion}>
            <MotionSelect
              label={`${title} ${index + 1}`}
              value={line.motion}
              clips={clips}
              onChange={(motion) =>
                onChange(lines.map((value, i) => (i === index ? { ...value, motion } : value)))
              }
            />
          </div>
          <div className={s.compactActions}>
            <Button
              variant="ghost"
              type="button"
              disabled={index === 0}
              aria-label={`${title} ${index + 1} 위로`}
              onClick={() => {
                const next = [...lines];
                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                onChange(next);
              }}
            >
              ↑
            </Button>
            <Button
              variant="ghost"
              type="button"
              disabled={index === lines.length - 1}
              aria-label={`${title} ${index + 1} 아래로`}
              onClick={() => {
                const next = [...lines];
                [next[index], next[index + 1]] = [next[index + 1], next[index]];
                onChange(next);
              }}
            >
              ↓
            </Button>
            <Button
              variant="ghost"
              type="button"
              disabled={!allowEmpty && lines.length <= 1}
              aria-label={`${title} ${index + 1} 삭제`}
              onClick={() => onChange(lines.filter((_, i) => i !== index))}
            >
              ×
            </Button>
          </div>
        </div>
      ))}
    </section>
  );
}
