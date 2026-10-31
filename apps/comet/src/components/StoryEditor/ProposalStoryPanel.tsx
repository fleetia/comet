import { useEffect, useRef, useState, type JSX } from "react";
import { Button, FormField, Select, Textarea, TextInput } from "@comet/ui";
import type { CharacterDefinition, ScenarioDefinition, SceneLine } from "../../types";
import { SceneStepFields } from "../CharacterEditor/SceneStepFields";
import { StoryLineInput } from "./StoryLineInput";
import * as s from "./storyPanel.css";

export type ProposalStage = "defer" | "intro" | "accept" | "decline" | "ending";
const LABELS: Record<ProposalStage, string> = {
  defer: "유보",
  intro: "제안",
  accept: "수락",
  decline: "거절",
  ending: "마무리",
};
const entries = (text: string): string[] => (text === "" ? [] : text.split("\n"));

export function ProposalStoryPanel({
  scenario,
  stage,
  actors,
  scenarios,
  onChange,
  onClose,
  stepFocus,
}: {
  scenario: ScenarioDefinition;
  stage: ProposalStage;
  actors: CharacterDefinition[];
  scenarios: ScenarioDefinition[];
  onChange: (scenario: ScenarioDefinition) => void;
  onClose: () => void;
  stepFocus?: { index: number; sequence: number } | null;
}): JSX.Element {
  const [expanded, setExpanded] = useState<number | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const focusIndex = useRef<number | null>(null);
  const lines = scenario[stage] ?? [];
  const maxLines = stage === "defer" ? 8 : 32;
  const definitions = actors.filter((actor) => scenario.participants.includes(actor.sourceId));
  const patch = (changes: Partial<ScenarioDefinition>): void =>
    onChange({ ...scenario, ...changes });
  const setLines = (next: SceneLine[]): void => patch({ [stage]: next });
  useEffect(() => {
    setExpanded(null);
    panelRef.current?.querySelector<HTMLTextAreaElement>("[data-line-index]")?.focus();
  }, [scenario.id, stage]);
  useEffect(() => {
    if (stepFocus) setExpanded(stepFocus.index);
  }, [stepFocus]);
  useEffect(() => {
    if (!stepFocus || expanded !== stepFocus.index) return;
    panelRef.current
      ?.querySelector<HTMLElement>(`[data-step-index="${stepFocus.index}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [stepFocus, expanded]);
  useEffect(() => {
    if (focusIndex.current == null) return;
    panelRef.current
      ?.querySelector<HTMLTextAreaElement>(`[data-line-index="${focusIndex.current}"]`)
      ?.focus();
    focusIndex.current = null;
  }, [lines]);
  function insert(index: number, previous?: SceneLine): void {
    if (lines.length >= maxLines) return;
    const line: SceneLine = {
      persona: previous?.persona ?? definitions[0]?.sourceId ?? scenario.centerId,
      expression: previous?.expression ?? "평온",
      text: "",
    };
    const next = [...lines];
    next.splice(index, 0, line);
    focusIndex.current = index;
    setLines(next);
  }
  function move(index: number, direction: number): void {
    const target = index + direction;
    if (target < 0 || target >= lines.length) return;
    const next = [...lines];
    [next[index], next[target]] = [next[target], next[index]];
    setExpanded(target);
    setLines(next);
  }
  function listField(
    key: "acceptKeywords" | "declineKeywords" | "keywords" | "requiredFlags",
    label: string,
  ): JSX.Element {
    return (
      <FormField label={`${label} · 한 줄에 하나`}>
        <Textarea
          fill
          layout="flexible"
          rows={2}
          value={(scenario[key] ?? []).join("\n")}
          onChange={(event) => patch({ [key]: entries(event.target.value) })}
        />
      </FormField>
    );
  }
  return (
    <aside ref={panelRef} className={s.panel} aria-label={`${LABELS[stage]} 편집`}>
      <div className={s.header}>
        <strong>{LABELS[stage]}</strong>
        <Button variant="ghost" aria-label="패널 닫기" onClick={onClose}>
          닫기
        </Button>
      </div>
      <div className={s.content}>
        <p>제안형은 네 단계가 정해져 있어서 장을 더하거나 잇는 곳을 바꿀 수 없어요.</p>
        {lines.map((line, index) => {
          const actor = actors.find((value) => value.sourceId === line.persona);
          return (
            <div key={index} className={s.stepRow} data-step-index={index}>
              <div className={s.line}>
                <StoryLineInput
                  line={line}
                  actor={actor}
                  index={index}
                  label={`${LABELS[stage]} ${index + 1} 대사`}
                  onChange={(text) =>
                    setLines(lines.map((value, i) => (i === index ? { ...value, text } : value)))
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      insert(index + 1, line);
                    }
                  }}
                />
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
                      step={{ ...line, kind: "line" }}
                      label={`${LABELS[stage]} ${index + 1}`}
                      definitions={definitions}
                      chapters={[]}
                      allowTargets={false}
                      hideLineText
                      showSaved
                      onChange={(next) => {
                        if (next.kind !== "line") return;
                        const { kind: _kind, ...updated } = next;
                        setLines(lines.map((value, i) => (i === index ? updated : value)));
                      }}
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
                        disabled={index === lines.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        아래로
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          setExpanded(null);
                          setLines(lines.filter((_, i) => i !== index));
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
        <Button
          variant="ghost"
          disabled={lines.length >= maxLines}
          onClick={() => insert(lines.length, lines.at(-1))}
        >
          대사 추가
        </Button>
        {lines.length >= maxLines && (
          <p className={s.notice}>
            {LABELS[stage]} 대사는 {maxLines}줄까지 넣을 수 있어요.
          </p>
        )}
        {stage === "intro" && (
          <>
            {listField("acceptKeywords", "수락 표현")}
            {listField("declineKeywords", "거절 표현")}
            {listField("keywords", "시작 키워드")}
            {listField("requiredFlags", "조건")}
            <FormField label="최소 친밀도">
              <TextInput
                fill
                type="number"
                min={0}
                max={100}
                value={scenario.minAffinity}
                onChange={(event) => {
                  const minAffinity = Math.max(0, Math.min(100, Number(event.target.value)));
                  patch({
                    minAffinity,
                    ...(scenario.revealAffinity != null && scenario.revealAffinity > minAffinity
                      ? { revealAffinity: minAffinity }
                      : {}),
                  });
                }}
              />
            </FormField>
            {scenario.revealAffinity == null && (scenario.defer?.length ?? 0) === 0 && (
              <Button variant="ghost" onClick={() => patch({ revealAffinity: 0, defer: [] })}>
                유보 추가
              </Button>
            )}
          </>
        )}
        {stage === "defer" && (
          <>
            <FormField label="노출 친밀도">
              <TextInput
                fill
                type="number"
                min={0}
                max={scenario.minAffinity}
                value={scenario.revealAffinity ?? ""}
                onChange={(event) =>
                  patch({
                    revealAffinity:
                      event.target.value === ""
                        ? null
                        : Math.max(0, Math.min(scenario.minAffinity, Number(event.target.value))),
                  })
                }
              />
            </FormField>
            <Button
              variant="ghost"
              onClick={() => {
                patch({ revealAffinity: null, defer: [] });
                onClose();
              }}
            >
              유보 삭제
            </Button>
          </>
        )}
        {(stage === "ending" || stage === "decline") && (
          <FormField label="이어질 이야기">
            <Select
              fill
              value={(stage === "ending" ? scenario.acceptNextId : scenario.declineNextId) ?? ""}
              onChange={(event) =>
                patch(
                  stage === "ending"
                    ? { acceptNextId: event.target.value || null }
                    : { declineNextId: event.target.value || null },
                )
              }
            >
              <option value="">없음</option>
              {scenarios.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title || "새 이야기"}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        {stage === "ending" && (
          <>
            <FormField label="완료 효과 · 남길 조건">
              <Textarea
                fill
                layout="flexible"
                rows={2}
                value={scenario.completion.setFlags.join("\n")}
                onChange={(event) =>
                  patch({
                    completion: { ...scenario.completion, setFlags: entries(event.target.value) },
                  })
                }
              />
            </FormField>
            <FormField label="완료 효과 · 경험으로 남길 문장">
              <Textarea
                fill
                layout="flexible"
                rows={2}
                maxLength={500}
                value={scenario.completion.memoryTemplate ?? ""}
                onChange={(event) =>
                  patch({
                    completion: {
                      ...scenario.completion,
                      memoryTemplate: event.target.value || null,
                    },
                  })
                }
              />
            </FormField>
          </>
        )}
      </div>
    </aside>
  );
}
