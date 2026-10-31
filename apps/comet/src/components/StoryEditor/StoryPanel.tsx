import { useEffect, useRef, useState, type JSX } from "react";
import {
  Button,
  CharacterArtwork,
  Checkbox,
  FormField,
  Select,
  Textarea,
  TextInput,
} from "@comet/ui";
import type {
  CharacterDefinition,
  ScenarioChapter,
  ScenarioDefinition,
  ScenarioStep,
} from "../../types";
import {
  ACTION_LABELS,
  EVENT_LABELS,
  newStep,
  SceneStepFields,
  STEP_NAMES,
} from "../CharacterEditor/SceneStepFields";
import * as s from "./storyPanel.css";

const entries = (text: string): string[] => (text === "" ? [] : text.split("\n"));

function stepSummary(step: Exclude<ScenarioStep, { kind: "line" }>): string {
  switch (step.kind) {
    case "ask":
    case "choice":
      return step.prompt;
    case "move":
      return step.enter === "left" ? "왼쪽에서 등장" : "오른쪽에서 등장";
    case "action":
      return ACTION_LABELS[step.do];
    case "wait":
      return `${EVENT_LABELS[step.event]} · ${step.timeoutSec}초`;
  }
}

export function StoryPanel({
  scenario,
  chapterId,
  actors,
  onChange,
  onClose,
}: {
  scenario: ScenarioDefinition;
  chapterId: string | null;
  actors: CharacterDefinition[];
  onChange: (scenario: ScenarioDefinition) => void;
  onClose: () => void;
}): JSX.Element {
  const [menuAt, setMenuAt] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const focusIndex = useRef<number | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const chapters = scenario.chapters ?? [];
  const chapter = chapters.find((value) => value.id === chapterId);
  const definitions = actors.filter((actor) => scenario.participants.includes(actor.sourceId));
  const patch = (changes: Partial<ScenarioDefinition>): void =>
    onChange({ ...scenario, ...changes });
  const patchChapter = (changes: Partial<ScenarioChapter>): void => {
    if (!chapter) return;
    patch({
      chapters: chapters.map((value) =>
        value.id === chapter.id ? { ...value, ...changes } : value,
      ),
    });
  };
  useEffect(() => {
    setMenuAt(null);
    setExpanded(null);
    if (chapterId) {
      panelRef.current?.querySelector<HTMLTextAreaElement>("[data-line-index]")?.focus();
    }
  }, [chapterId, scenario.id]);
  useEffect(() => {
    if (focusIndex.current == null) return;
    panelRef.current
      ?.querySelector<HTMLTextAreaElement>(`[data-line-index="${focusIndex.current}"]`)
      ?.focus();
    focusIndex.current = null;
  }, [chapter?.steps]);
  function insert(
    index: number,
    kind: ScenarioStep["kind"],
    previousLine?: Extract<ScenarioStep, { kind: "line" }>,
  ): void {
    if (!chapter || chapter.steps.length >= 32) return;
    const persona = definitions[0]?.sourceId ?? scenario.centerId;
    const steps = [...chapter.steps];
    const next =
      previousLine && kind === "line"
        ? {
            kind: "line" as const,
            persona: previousLine.persona,
            expression: previousLine.expression,
            text: "",
          }
        : newStep(kind, persona);
    steps.splice(index, 0, next);
    if (kind === "line") focusIndex.current = index;
    else setExpanded(index);
    setMenuAt(null);
    patchChapter({ steps });
  }
  function move(index: number, direction: number): void {
    if (!chapter) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= chapter.steps.length) return;
    const steps = [...chapter.steps];
    [steps[index], steps[nextIndex]] = [steps[nextIndex], steps[index]];
    setExpanded(nextIndex);
    patchChapter({ steps });
  }
  function addMenu(index: number): JSX.Element {
    return (
      <div className={s.addRow}>
        <button
          type="button"
          className={s.add}
          aria-label={`단계 ${index + 1} 앞에 추가`}
          aria-expanded={menuAt === index}
          disabled={!chapter || chapter.steps.length >= 32}
          onClick={() => setMenuAt(menuAt === index ? null : index)}
        >
          +
        </button>
        {menuAt === index && (
          <div className={s.menu} role="menu" aria-label="단계 추가">
            {(Object.keys(STEP_NAMES) as ScenarioStep["kind"][]).map((kind) => (
              <button type="button" role="menuitem" key={kind} onClick={() => insert(index, kind)}>
                {STEP_NAMES[kind]}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <aside ref={panelRef} className={s.panel} aria-label={chapterId ? "장 편집" : "이야기 설정"}>
      <div className={s.header}>
        <strong>{chapterId ? chapter?.title || "새 장" : "이야기 설정"}</strong>
        <Button variant="ghost" aria-label="패널 닫기" onClick={onClose}>
          닫기
        </Button>
      </div>
      {scenario.chapters == null ? (
        <p className={s.notice}>제안형 편집은 다음 변경에서 열려요.</p>
      ) : chapterId == null ? (
        <div className={s.content}>
          <FormField label="이야기 제목">
            <TextInput
              fill
              value={scenario.title}
              onChange={(event) => patch({ title: event.target.value })}
            />
          </FormField>
          <FormField label="중심 인물">
            <Select
              fill
              value={scenario.centerId}
              onChange={(event) =>
                patch({
                  centerId: event.target.value,
                  participants: [...new Set([...scenario.participants, event.target.value])],
                })
              }
            >
              {actors
                .filter((actor) => actor.presenceRole !== "npc")
                .map((actor) => (
                  <option key={actor.sourceId} value={actor.sourceId}>
                    {actor.name}
                  </option>
                ))}
            </Select>
          </FormField>
          <div>
            <p>참가 인물</p>
            {actors.map((actor) => (
              <Checkbox
                key={actor.sourceId}
                label={actor.name}
                checked={scenario.participants.includes(actor.sourceId)}
                disabled={actor.sourceId === scenario.centerId}
                onChange={(event) =>
                  patch({
                    participants: event.target.checked
                      ? [...scenario.participants, actor.sourceId]
                      : scenario.participants.filter((id) => id !== actor.sourceId),
                  })
                }
              />
            ))}
          </div>
          <FormField label="쓰임">
            <Select
              fill
              value={scenario.purpose ?? "story"}
              onChange={(event) => patch({ purpose: event.target.value as "story" | "tutorial" })}
            >
              <option value="story">이야기</option>
              <option value="tutorial">튜토리얼</option>
            </Select>
          </FormField>
          <FormField label="시작 키워드 · 한 줄에 하나">
            <Textarea
              fill
              layout="flexible"
              rows={2}
              value={scenario.keywords.join("\n")}
              onChange={(event) => patch({ keywords: entries(event.target.value) })}
            />
          </FormField>
          <FormField label="시작 조건 · 한 줄에 하나">
            <Textarea
              fill
              layout="flexible"
              rows={2}
              value={scenario.requiredFlags.join("\n")}
              onChange={(event) => patch({ requiredFlags: entries(event.target.value) })}
            />
          </FormField>
          <FormField label="최소 친밀도">
            <TextInput
              fill
              type="number"
              min={0}
              max={100}
              value={scenario.minAffinity}
              onChange={(event) => patch({ minAffinity: Number(event.target.value) })}
            />
          </FormField>
        </div>
      ) : (
        chapter && (
          <div className={s.content}>
            <FormField label="장 제목">
              <TextInput
                fill
                maxLength={40}
                value={chapter.title}
                onChange={(event) => patchChapter({ title: event.target.value })}
              />
            </FormField>
            {chapter.steps.map((step, index) => {
              const actor =
                step.kind === "line"
                  ? actors.find((value) => value.sourceId === step.persona)
                  : undefined;
              return (
                <div key={index} className={s.stepRow}>
                  {addMenu(index)}
                  <div className={step.kind === "line" ? s.line : s.step}>
                    {step.kind === "line" ? (
                      <div className={s.lineInput}>
                        <CharacterArtwork
                          size="compact"
                          face={actor?.expressions[step.expression]}
                          style={{ width: 20, height: 20, fontSize: 8, flexShrink: 0 }}
                        />
                        <div className={s.textareaWrapper} data-value={step.text}>
                          <textarea
                            className={s.textarea}
                            aria-label={`단계 ${index + 1} 대사`}
                            data-line-index={index}
                            value={step.text}
                            maxLength={500}
                            rows={1}
                            onChange={(event) =>
                              patchChapter({
                                steps: chapter.steps.map((value, i) =>
                                  i === index ? { ...step, text: event.target.value } : value,
                                ),
                              })
                            }
                            onKeyDown={(event) => {
                              if (
                                event.key === "Enter" &&
                                !event.shiftKey &&
                                !event.nativeEvent.isComposing
                              ) {
                                event.preventDefault();
                                insert(index + 1, "line", step);
                              }
                              if (
                                event.key === "/" &&
                                !event.ctrlKey &&
                                !event.metaKey &&
                                !event.altKey &&
                                !step.text &&
                                !event.nativeEvent.isComposing
                              ) {
                                event.preventDefault();
                                setMenuAt(index);
                              }
                            }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className={s.stepSummary}>
                        <strong>
                          {step.kind === "action" && step.do !== "widget.open"
                            ? "동작"
                            : STEP_NAMES[step.kind]}
                        </strong>
                        <span>{stepSummary(step)}</span>
                      </div>
                    )}
                    {step.kind === "wait" && (
                      <div className={s.stepSummary}>
                        <strong>시간이 지나면</strong>
                        <span>
                          {step.onTimeout.steps.find((value) => value.kind === "line")?.text}
                        </span>
                      </div>
                    )}
                    <button
                      type="button"
                      className={s.expand}
                      aria-expanded={expanded === index}
                      onClick={() => setExpanded(expanded === index ? null : index)}
                    >
                      {expanded === index ? "접기" : "펼치기"}
                    </button>
                    {expanded === index && (
                      <div className={s.fields}>
                        <SceneStepFields
                          step={step}
                          label={`단계 ${index + 1}`}
                          definitions={definitions}
                          chapters={chapters}
                          allowTargets={false}
                          hideLineText={step.kind === "line"}
                          showSaved
                          onChange={(next) =>
                            patchChapter({
                              steps: chapter.steps.map((value, i) => (i === index ? next : value)),
                            })
                          }
                        />
                        <div className={s.actions}>
                          <Button
                            variant="ghost"
                            disabled={index === 0}
                            onClick={() => move(index, -1)}
                          >
                            위로
                          </Button>
                          <Button
                            variant="ghost"
                            disabled={index === chapter.steps.length - 1}
                            onClick={() => move(index, 1)}
                          >
                            아래로
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => {
                              setExpanded(null);
                              patchChapter({ steps: chapter.steps.filter((_, i) => i !== index) });
                            }}
                          >
                            삭제
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            {addMenu(chapter.steps.length)}
            {chapter.steps.length >= 32 && (
              <p className={s.notice}>한 장에는 단계를 32개까지 넣을 수 있어요.</p>
            )}
          </div>
        )
      )}
    </aside>
  );
}
