import type { JSX } from "react";
import { Button, CharacterArtwork, Select, Textarea, TextInput } from "@comet/ui";
import type {
  CharacterDefinition,
  ScenarioAction,
  ScenarioActionStep,
  ScenarioChapter,
  ScenarioEvent,
  ScenarioStep,
  ScenarioWidget,
} from "../../types";
import { MotionSelect } from "../MotionSelect/MotionSelect";
import * as s from "../characters.css";

const WIDGETS = [
  "memo",
  "focus-timer",
  "todo",
  "calendar",
  "music",
  "ball",
  "paper-plane",
  "bubbles",
] as const;
const TARGET_LABELS: Record<string, string> = {
  settings: "설정",
  memo: "메모",
  "focus-timer": "집중 타이머",
  todo: "할 일",
  calendar: "달력",
  music: "음악",
  ball: "공",
  "paper-plane": "종이비행기",
  bubbles: "비눗방울",
  friends: "친구들",
  dialogue: "대화",
  desktop: "바탕화면",
  widgets: "위젯",
  ai: "AI",
  general: "일반",
  "ai.recommended": "추천 AI",
  "general.guide": "안내서",
  "first-meeting": "첫 만남",
  talking: "대화하기",
  packs: "대화팩",
  rhythm: "생활 리듬",
  "diary-memory": "일기와 기억",
  glossary: "용어",
  troubleshooting: "문제 해결",
  privacy: "개인정보",
};
const EVENT_NAMES = [
  "body.clicked",
  "body.moved",
  "widget.saved",
  "focus.started",
  "focus.stopped",
  "window.closed",
] as const;
const ACTION_NAMES = [
  "widget.open",
  "focus.start",
  "focus.stop",
  "settings.open",
  "guide.open",
] as const;
export const EVENT_LABELS: Record<ScenarioEvent["event"], string> = {
  "body.clicked": "친구를 클릭함",
  "body.moved": "친구를 옮김",
  "widget.saved": "메모를 저장함",
  "focus.started": "집중 시작",
  "focus.stopped": "집중 종료",
  "window.closed": "창을 닫음",
};
export const ACTION_LABELS: Record<ScenarioAction["do"], string> = {
  "widget.open": "위젯 열기",
  "focus.start": "집중 시작",
  "focus.stop": "집중 종료",
  "settings.open": "설정 열기",
  "guide.open": "안내서 열기",
};
export const STEP_NAMES = {
  line: "대사",
  move: "등장",
  ask: "입력",
  choice: "선택지",
  action: "창 열기",
  wait: "기다리기",
} as const;

function newAction(name: ScenarioAction["do"]): ScenarioActionStep {
  switch (name) {
    case "widget.open":
      return { kind: "action", do: name, widget: "memo" };
    case "focus.start":
      return { kind: "action", do: name, minutes: 5 };
    case "focus.stop":
      return { kind: "action", do: name };
    case "settings.open":
      return { kind: "action", do: name, tab: "friends" };
    case "guide.open":
      return { kind: "action", do: name, page: "first-meeting" };
  }
}
function newEvent(name: ScenarioEvent["event"]): ScenarioEvent {
  switch (name) {
    case "widget.saved":
      return { event: name, widget: "memo" };
    case "window.closed":
      return { event: name, window: "settings" };
    default:
      return { event: name };
  }
}
export function newStep(kind: ScenarioStep["kind"], persona: string): ScenarioStep {
  const actor = { persona, expression: "평온" };
  switch (kind) {
    case "line":
      return { kind, ...actor, text: "" };
    case "move":
      return { kind, persona, enter: "left" };
    case "ask":
      return { kind, ...actor, id: crypto.randomUUID(), prompt: "", input: "text" };
    case "choice":
      return {
        kind,
        ...actor,
        prompt: "",
        options: [
          { id: crypto.randomUUID(), label: "", goto: "next" },
          { id: crypto.randomUUID(), label: "", goto: "next" },
        ],
      };
    case "action":
      return newAction("widget.open");
    case "wait":
      return {
        kind,
        event: "body.clicked",
        timeoutSec: 90,
        onTimeout: { steps: [], then: "next" },
      };
  }
}
function EventFields({
  value,
  label,
  onChange,
}: {
  value: ScenarioEvent;
  label: string;
  onChange: (event: ScenarioEvent) => void;
}): JSX.Element {
  return (
    <>
      <Select
        aria-label={label}
        value={value.event}
        onChange={(event) => onChange(newEvent(event.target.value as ScenarioEvent["event"]))}
      >
        {EVENT_NAMES.map((name) => (
          <option key={name} value={name}>
            {EVENT_LABELS[name]}
          </option>
        ))}
      </Select>
      {value.event === "window.closed" && (
        <Select
          aria-label={`${label} 창`}
          value={value.window}
          onChange={(event) =>
            onChange({
              event: "window.closed",
              window: event.target.value as Extract<
                ScenarioEvent,
                { event: "window.closed" }
              >["window"],
            })
          }
        >
          {["settings", ...WIDGETS].map((name) => (
            <option key={name} value={name}>
              {TARGET_LABELS[name]}
            </option>
          ))}
        </Select>
      )}
    </>
  );
}
function ActionFields({
  value,
  label,
  onChange,
}: {
  value: ScenarioActionStep;
  label: string;
  onChange: (step: ScenarioActionStep) => void;
}): JSX.Element {
  return (
    <>
      <Select
        aria-label={`${label} 동작`}
        value={value.do}
        onChange={(event) => onChange(newAction(event.target.value as ScenarioAction["do"]))}
      >
        {ACTION_NAMES.map((name) => (
          <option key={name} value={name}>
            {ACTION_LABELS[name]}
          </option>
        ))}
      </Select>
      {value.do === "widget.open" && (
        <Select
          aria-label={`${label} 위젯`}
          value={value.widget}
          onChange={(event) => onChange({ ...value, widget: event.target.value as ScenarioWidget })}
        >
          {WIDGETS.map((name) => (
            <option key={name} value={name}>
              {TARGET_LABELS[name]}
            </option>
          ))}
        </Select>
      )}
      {value.do === "focus.start" && (
        <TextInput
          type="number"
          aria-label={`${label} 집중 시간`}
          value={value.minutes}
          onChange={(event) => onChange({ ...value, minutes: Number(event.target.value) })}
        />
      )}
      {value.do === "settings.open" && (
        <>
          <Select
            aria-label={`${label} 설정 탭`}
            value={value.tab}
            onChange={(event) =>
              onChange({ ...value, tab: event.target.value as typeof value.tab })
            }
          >
            {["friends", "dialogue", "desktop", "widgets", "ai", "general"].map((name) => (
              <option key={name} value={name}>
                {TARGET_LABELS[name]}
              </option>
            ))}
          </Select>
          <Select
            aria-label={`${label} 강조`}
            value={value.highlight ?? ""}
            onChange={(event) =>
              onChange({
                ...value,
                highlight: (event.target.value || null) as typeof value.highlight,
              })
            }
          >
            {["", "ai.recommended", "general.guide"].map((name) => (
              <option key={name} value={name}>
                {TARGET_LABELS[name] ?? "없음"}
              </option>
            ))}
          </Select>
        </>
      )}
      {value.do === "guide.open" && (
        <Select
          aria-label={`${label} 안내 페이지`}
          value={value.page}
          onChange={(event) =>
            onChange({ ...value, page: event.target.value as typeof value.page })
          }
        >
          {[
            "first-meeting",
            "talking",
            "friends",
            "packs",
            "widgets",
            "ai",
            "rhythm",
            "diary-memory",
            "glossary",
            "troubleshooting",
            "privacy",
          ].map((name) => (
            <option key={name} value={name}>
              {TARGET_LABELS[name]}
            </option>
          ))}
        </Select>
      )}
    </>
  );
}
export function TargetSelect({
  label,
  value,
  chapters,
  targets,
  onChange,
}: {
  label: string;
  value: string;
  chapters: ScenarioChapter[];
  targets: [string, string][];
  onChange: (value: string) => void;
}): JSX.Element {
  return (
    <Select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
      {targets.map(([id, title]) => (
        <option key={id} value={id}>
          {title}
        </option>
      ))}
      {chapters.map((chapter) => (
        <option key={chapter.id} value={chapter.id}>
          {chapter.title || "새 장"}
        </option>
      ))}
    </Select>
  );
}
export function SceneStepFields({
  step,
  label,
  definitions,
  chapters,
  onChange,
  allowTargets = true,
  hideLineText = false,
  showSaved = false,
}: {
  step: ScenarioStep;
  label: string;
  definitions: CharacterDefinition[];
  chapters: ScenarioChapter[];
  onChange: (step: ScenarioStep) => void;
  allowTargets?: boolean;
  hideLineText?: boolean;
  showSaved?: boolean;
}): JSX.Element {
  const actor =
    "persona" in step ? definitions.find((value) => value.sourceId === step.persona) : undefined;
  const timeoutLabel = allowTargets ? "시간 초과" : "시간이 지나면";
  return (
    <div className={s.relationshipRow}>
      {"persona" in step ? (
        <Select
          aria-label={`${label} 화자`}
          leading={
            actor && (
              <CharacterArtwork
                size="compact"
                face={actor.expressions["expression" in step ? step.expression : "평온"]}
                style={{ width: 14, height: 14, fontSize: 7 }}
              />
            )
          }
          value={step.persona}
          onChange={(event) => onChange({ ...step, persona: event.target.value })}
        >
          {!actor && <option value={step.persona}>확인할 화자</option>}
          {definitions.map((value) => (
            <option key={value.sourceId} value={value.sourceId}>
              {value.name}
            </option>
          ))}
        </Select>
      ) : (
        <span>{STEP_NAMES[step.kind]}</span>
      )}
      {step.kind === "line" && !hideLineText && (
        <Textarea
          layout="flexible"
          fill
          rows={2}
          maxLength={500}
          aria-label={`${label} 본문`}
          value={step.text}
          onChange={(event) => onChange({ ...step, text: event.target.value })}
        />
      )}
      {step.kind === "move" && (
        <Select
          aria-label={`${label} 등장 방향`}
          value={step.enter}
          onChange={(event) => onChange({ ...step, enter: event.target.value as "left" | "right" })}
        >
          <option value="left">왼쪽</option>
          <option value="right">오른쪽</option>
        </Select>
      )}
      {(step.kind === "ask" || step.kind === "choice") && (
        <Textarea
          layout="flexible"
          fill
          rows={2}
          maxLength={500}
          aria-label={`${label} 질문`}
          value={step.prompt}
          onChange={(event) => onChange({ ...step, prompt: event.target.value })}
        />
      )}
      {"expression" in step && (
        <>
          <Select
            aria-label={`${label} 표정`}
            value={step.expression}
            onChange={(event) => onChange({ ...step, expression: event.target.value })}
          >
            {[...new Set([step.expression, ...Object.keys(actor?.expressions ?? {})])].map(
              (value) => (
                <option key={value}>{value}</option>
              ),
            )}
          </Select>
          <MotionSelect
            label={label}
            clips={actor?.animation?.clips ?? []}
            value={step.motion}
            onChange={(motion) => onChange({ ...step, motion })}
          />
        </>
      )}
      {step.kind === "ask" && (
        <>
          {allowTargets && (
            <TextInput
              aria-label={`${label} 입력 ID`}
              value={step.id}
              onChange={(event) => onChange({ ...step, id: event.target.value })}
            />
          )}
          <Select
            aria-label={`${label} 입력 종류`}
            value={step.input}
            onChange={(event) => {
              if (!showSaved) {
                onChange({
                  ...step,
                  input: event.target.value as "name" | "text",
                  known: event.target.value === "name" ? (step.known ?? "") : null,
                } as ScenarioStep);
                return;
              }
              if (event.target.value === "name") {
                onChange({ ...step, input: "name", known: step.known ?? "" });
              } else {
                const { saved: _saved, ...rest } = step;
                onChange({ ...rest, input: "text", known: null });
              }
            }}
          >
            <option value="name">이름</option>
            <option value="text">글</option>
          </Select>
          {step.input === "name" && (
            <TextInput
              aria-label={`${label} 이름을 알 때 대사`}
              value={step.known ?? ""}
              onChange={(event) => onChange({ ...step, known: event.target.value })}
            />
          )}
          {step.input === "name" && showSaved && (
            <>
              {step.saved ? (
                <>
                  <Textarea
                    layout="flexible"
                    fill
                    rows={2}
                    maxLength={500}
                    aria-label={`${label} 이름을 저장한 뒤 대사`}
                    value={step.saved.text}
                    onChange={(event) => {
                      if (step.saved) {
                        onChange({ ...step, saved: { ...step.saved, text: event.target.value } });
                      }
                    }}
                  />
                  <Select
                    aria-label={`${label} 이름을 저장한 뒤 표정`}
                    value={step.saved.expression}
                    onChange={(event) => {
                      if (step.saved) {
                        onChange({
                          ...step,
                          saved: { ...step.saved, expression: event.target.value },
                        });
                      }
                    }}
                  >
                    {[
                      ...new Set([step.saved.expression, ...Object.keys(actor?.expressions ?? {})]),
                    ].map((value) => (
                      <option key={value}>{value}</option>
                    ))}
                  </Select>
                  <MotionSelect
                    label={`${label} 이름을 저장한 뒤`}
                    clips={actor?.animation?.clips ?? []}
                    value={step.saved.motion}
                    onChange={(motion) => {
                      if (step.saved) {
                        onChange({ ...step, saved: { ...step.saved, motion } });
                      }
                    }}
                  />
                  <Button variant="ghost" onClick={() => onChange({ ...step, saved: undefined })}>
                    이름을 저장한 뒤 대사 삭제
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() =>
                    onChange({ ...step, saved: { expression: step.expression, text: "" } })
                  }
                >
                  이름을 저장한 뒤 대사 추가
                </Button>
              )}
            </>
          )}
        </>
      )}
      {step.kind === "choice" && (
        <>
          {step.options.map((option, index) => (
            <div key={option.id} className={s.relationshipRow}>
              <TextInput
                aria-label={`${label} 선택지 ${index + 1}`}
                value={option.label}
                maxLength={20}
                onChange={(event) =>
                  onChange({
                    ...step,
                    options: step.options.map((value, i) =>
                      i === index ? { ...value, label: event.target.value } : value,
                    ),
                  })
                }
              />
              {allowTargets && (
                <TargetSelect
                  label={`${label} 선택지 ${index + 1} 이동`}
                  value={option.goto}
                  chapters={chapters}
                  targets={[
                    ["next", "다음 단계"],
                    ["end", "끝내기"],
                  ]}
                  onChange={(goto) =>
                    onChange({
                      ...step,
                      options: step.options.map((value, i) =>
                        i === index ? { ...value, goto } : value,
                      ),
                    })
                  }
                />
              )}
              <Button
                variant="ghost"
                disabled={step.options.length <= 2}
                onClick={() =>
                  onChange({ ...step, options: step.options.filter((_, i) => i !== index) })
                }
              >
                선택지 {index + 1} 삭제
              </Button>
            </div>
          ))}
          <Button
            disabled={step.options.length >= 4}
            onClick={() =>
              onChange({
                ...step,
                options: [...step.options, { id: crypto.randomUUID(), label: "", goto: "next" }],
              })
            }
          >
            선택지 추가
          </Button>
        </>
      )}
      {step.kind === "action" && <ActionFields value={step} label={label} onChange={onChange} />}
      {step.kind === "wait" && (
        <>
          <EventFields
            label={`${label} 기다릴 이벤트`}
            value={step}
            onChange={(event) =>
              onChange({
                kind: "wait",
                ...event,
                timeoutSec: step.timeoutSec,
                cancelOn: step.cancelOn,
                onTimeout: step.onTimeout,
              })
            }
          />
          <TextInput
            type="number"
            aria-label={`${label} 대기 시간`}
            value={step.timeoutSec}
            onChange={(event) => onChange({ ...step, timeoutSec: Number(event.target.value) })}
          />
          {(step.cancelOn ?? []).map((event, index) => (
            <div key={index}>
              <EventFields
                label={`${label} 중단 이벤트 ${index + 1}`}
                value={event}
                onChange={(next) =>
                  onChange({
                    ...step,
                    cancelOn: (step.cancelOn ?? []).map((value, i) => (i === index ? next : value)),
                  })
                }
              />
              <Button
                variant="ghost"
                onClick={() =>
                  onChange({
                    ...step,
                    cancelOn: (step.cancelOn ?? []).filter((_, i) => i !== index),
                  })
                }
              >
                중단 이벤트 {index + 1} 삭제
              </Button>
            </div>
          ))}
          <Button
            onClick={() =>
              onChange({ ...step, cancelOn: [...(step.cancelOn ?? []), newEvent("body.clicked")] })
            }
          >
            중단 이벤트 추가
          </Button>
          <details>
            <summary>시간이 지나면</summary>
            {step.onTimeout.steps.map((child, index) => (
              <div key={index}>
                <SceneStepFields
                  step={child}
                  label={`${label} ${timeoutLabel} ${index + 1}`}
                  definitions={definitions}
                  chapters={chapters}
                  allowTargets={allowTargets}
                  showSaved={showSaved}
                  onChange={(next) => {
                    if (next.kind === "line" || next.kind === "action")
                      onChange({
                        ...step,
                        onTimeout: {
                          ...step.onTimeout,
                          steps: step.onTimeout.steps.map((value, i) =>
                            i === index ? next : value,
                          ),
                        },
                      });
                  }}
                />
                <Button
                  variant="ghost"
                  onClick={() =>
                    onChange({
                      ...step,
                      onTimeout: {
                        ...step.onTimeout,
                        steps: step.onTimeout.steps.filter((_, i) => i !== index),
                      },
                    })
                  }
                >
                  {timeoutLabel} {index + 1} 삭제
                </Button>
              </div>
            ))}
            <Button
              disabled={step.onTimeout.steps.length >= 4 || !definitions[0]}
              onClick={() =>
                onChange({
                  ...step,
                  onTimeout: {
                    ...step.onTimeout,
                    steps: [
                      ...step.onTimeout.steps,
                      {
                        kind: "line",
                        persona: definitions[0].sourceId,
                        expression: "평온",
                        text: "",
                      },
                    ],
                  },
                })
              }
            >
              {timeoutLabel} 대사 추가
            </Button>
            <Button
              disabled={step.onTimeout.steps.length >= 4}
              onClick={() =>
                onChange({
                  ...step,
                  onTimeout: {
                    ...step.onTimeout,
                    steps: [...step.onTimeout.steps, newAction("widget.open")],
                  },
                })
              }
            >
              {timeoutLabel} 동작 추가
            </Button>
            {allowTargets && (
              <TargetSelect
                label={`${label} 시간 초과 후`}
                value={step.onTimeout.then}
                chapters={chapters}
                targets={[
                  ["next", "다음 단계"],
                  ["nextChapter", "다음 장"],
                  ["end", "끝내기"],
                ]}
                onChange={(then) => onChange({ ...step, onTimeout: { ...step.onTimeout, then } })}
              />
            )}
          </details>
        </>
      )}
    </div>
  );
}
