import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { TauriEvent } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button, Checkbox, FormField, Select, Surface, Textarea, TextInput } from "@comet/ui";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type {
  AnimationAsset,
  AuthoringState,
  AuthoringSubject,
  AuthoringTrialTrace,
  InstalledCharacter,
  PackStoryDefinition,
  PackStorySnapshot,
} from "../../types";
import { CharacterLinePreview, type CharacterPreviewLine } from "./CharacterLinePreview";
import * as s from "../characters.css";

const EMPTY: PackStoryDefinition = { worldRules: "", storyFlags: [], knowledge: [], scenarios: [] };
const STAGES = {
  entry: "등장",
  intro: "제안",
  defer: "유보",
  accept: "수락",
  decline: "거절",
  ending: "마무리",
};
const SCENE_STATUSES = {
  wait: "이벤트 대기",
  ask: "입력 대기",
  choice: "선택 대기",
  completed: "완료",
  blocked: "시작할 수 없음",
};
type SceneResponse =
  | { kind: "event" | "timeout" }
  | { kind: "answer"; value: string }
  | { kind: "choice"; optionId: string };

export function AuthoringTrial({
  title,
  actors,
  subject,
  packId,
  definition: draftDefinition,
  baseline,
  presentIds: initialPresentIds,
  assets = {},
  visible,
}: {
  title: string;
  actors: InstalledCharacter[];
  subject: AuthoringSubject;
  packId?: string | null;
  definition?: PackStoryDefinition;
  baseline?: string;
  presentIds?: string[];
  assets?: Record<string, AnimationAsset[]>;
  visible: boolean;
}): JSX.Element {
  const scope = JSON.stringify([packId, subject]);
  const residents = actors.filter((actor) => actor.definition.presenceRole !== "npc");
  const scenarioCenter =
    subject.kind === "scenario"
      ? draftDefinition?.scenarios.find((scenario) => scenario.id === subject.scenarioId)?.centerId
      : undefined;
  const defaultCenter =
    residents.find((actor) => actor.definition.sourceId === scenarioCenter)?.id ??
    residents[0]?.id ??
    "";
  const initialPresenceKey = JSON.stringify(initialPresentIds);
  const [expanded, setExpanded] = useState(false);
  const [snapshot, setSnapshot] = useState<PackStorySnapshot | null>(null);
  const [inputs, setInputs] = useState("");
  const [sceneKnownName, setSceneKnownName] = useState("");
  const [sceneAnswer, setSceneAnswer] = useState("");
  const [centerId, setCenterId] = useState(defaultCenter);
  const [presentIds, setPresentIds] = useState(
    initialPresentIds ?? residents.map((actor) => actor.id),
  );
  const [flags, setFlags] = useState<string[]>([]);
  const [affinity, setAffinity] = useState("20");
  const [turn, setTurn] = useState("0");
  const [waitTurn, setWaitTurn] = useState("0");
  const [completed, setCompleted] = useState<string[]>([]);
  const [incomplete, setIncomplete] = useState<string[]>([]);
  const [trace, setTrace] = useState<AuthoringTrialTrace | null>(null);
  const [stepIndex, setStepIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const mounted = useRef(true);
  const generation = useRef(0);
  const pending = useRef(false);
  const sceneResponses = useRef<SceneResponse[]>([]);
  const definition = draftDefinition ?? snapshot?.definition ?? EMPTY;
  const sceneScenario =
    subject.kind === "scenario" &&
    definition.scenarios.find((scenario) => scenario.id === subject.scenarioId);
  const isSceneStory = Boolean(sceneScenario && sceneScenario.chapters != null);
  const key = JSON.stringify([
    scope,
    visible,
    expanded,
    actors,
    assets,
    definition,
    baseline,
    snapshot?.baseline,
    inputs,
    sceneKnownName,
    centerId,
    presentIds,
    flags,
    affinity,
    turn,
    waitTurn,
    completed,
    incomplete,
  ]);
  const identity = useRef(key);
  if (identity.current !== key) {
    identity.current = key;
    generation.current += 1;
  }
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
    };
  }, []);
  useEffect(() => {
    setInputs("");
    setSceneKnownName("");
    setFlags([]);
    setCompleted([]);
    setIncomplete([]);
    setCenterId(defaultCenter);
    setAffinity("20");
    setTurn("0");
    setWaitTurn("0");
    setExpanded(false);
  }, [scope]);
  useEffect(() => {
    setSnapshot(null);
  }, [scope, baseline]);
  useEffect(() => {
    setPresentIds(initialPresentIds ?? residents.map((actor) => actor.id));
  }, [scope, initialPresenceKey]);
  const invalidate = useCallback((): void => {
    generation.current += 1;
    setTrace(null);
    sceneResponses.current = [];
    setSceneAnswer("");
    setStepIndex(0);
    setError(null);
    setBusy(false);
    pending.current = false;
  }, []);
  useEffect(invalidate, [key, invalidate]);
  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | undefined;
    function visibility(): void {
      if (document.hidden) invalidate();
    }
    document.addEventListener("visibilitychange", visibility);
    if (isDesktop()) {
      void (async (): Promise<void> => {
        try {
          const cleanup = await getCurrentWindow().listen(
            TauriEvent.WINDOW_CLOSE_REQUESTED,
            invalidate,
          );
          if (live) unlisten = cleanup;
          else cleanup();
        } catch (cause) {
          if (live) setError(errorText(cause));
        }
      })();
    }
    return () => {
      live = false;
      document.removeEventListener("visibilitychange", visibility);
      unlisten?.();
    };
  }, [invalidate]);
  useEffect(() => {
    if (!visible || !expanded || draftDefinition || !packId || snapshot) return;
    let current = true;
    setBusy(true);
    void command<PackStorySnapshot>("get_pack_story_definition", { packId })
      .then((value) => {
        if (current) setSnapshot(value);
      })
      .catch((cause: unknown) => {
        if (current) setError(errorText(cause));
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [visible, expanded, scope, baseline, draftDefinition, Boolean(snapshot), reload]);
  const valid =
    [affinity, turn, waitTurn].every(
      (value) => value.trim() && Number.isSafeInteger(Number(value)) && Number(value) >= 0,
    ) &&
    Number(affinity) <= 100 &&
    inputs.split("\n").length <= 32 &&
    inputs.split("\n").every((value) => Array.from(value).length <= 500);
  async function test(responses: SceneResponse[] = []): Promise<void> {
    if (
      !visible ||
      !expanded ||
      pending.current ||
      !valid ||
      (packId && !draftDefinition && !snapshot)
    )
      return;
    const version = ++generation.current;
    pending.current = true;
    setBusy(true);
    if (responses.length === 0) setTrace(null);
    setError(null);
    try {
      const result = await command<AuthoringTrialTrace>("trial_pack_authoring", {
        request: {
          actors: actors.map((actor) => ({
            id: actor.id,
            packId: actor.packId ?? null,
            definition: actor.definition,
          })),
          definition,
          subject,
          context: {
            centerId,
            presentIds,
            flags,
            affinity: Number(affinity),
            turn: Number(turn),
            waitTurn: Number(waitTurn),
            completedScenarioIds: completed,
            incompleteScenarioIds: incomplete,
          },
          inputs: inputs.split("\n"),
          ...(isSceneStory ? { sceneResponses: responses, sceneKnownName } : {}),
        },
      });
      if (mounted.current && generation.current === version) {
        setTrace(result);
        setStepIndex(0);
        sceneResponses.current = responses;
        setSceneAnswer("");
      }
    } catch (cause) {
      if (mounted.current && generation.current === version) setError(errorText(cause));
    } finally {
      if (mounted.current && generation.current === version) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  function toggle(values: string[], value: string, checked: boolean): string[] {
    return checked ? [...new Set([...values, value])] : values.filter((item) => item !== value);
  }
  const step = trace?.steps[stepIndex];
  const queue: CharacterPreviewLine[] = [];
  if (step)
    for (const [index, line] of step.lines.entries()) {
      const actor = actors.find((item) => item.id === line.persona);
      if (actor)
        queue.push({
          definition: actor.definition,
          character: actor,
          line,
          assets: assets[actor.id] ?? [],
          durationMs: step.lineDurationsMs[index],
        });
    }
  const canPreview = Boolean(step && queue.length === step.lines.length && queue.length);
  function stateText(state: AuthoringState): string {
    return `${state.stage ? STAGES[state.stage] : "대기"} · ${state.ready ? "입력 대기" : "대사 전"} · 참가 ${state.presentIds.length}명 · 조건 ${state.flags.join(", ") || "없음"} · 입력 ${state.turn} / 대기 ${state.waitTurn}${state.pendingNextScenarioId ? ` · 다음 이야기 ${state.pendingNextScenarioId}` : ""}`;
  }
  return (
    <details open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary>{title}</summary>
      <p className={s.small}>
        편집 중인 원문과 임시 조건으로 시험해요. 실제 등장·대화·기억·친밀도·완료 조건은 바뀌지
        않아요.
      </p>
      {!isSceneStory && (
        <FormField label={`${title} 입력 · 한 줄에 한 번`}>
          <Textarea
            layout="flexible"
            fill
            rows={3}
            maxLength={32031}
            value={inputs}
            onChange={(event) => setInputs(event.target.value)}
          />
        </FormField>
      )}
      <FormField label={`${title} 중심 인물`}>
        <Select fill value={centerId} onChange={(event) => setCenterId(event.target.value)}>
          <option value="">선택해 주세요</option>
          {residents.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.definition.name}
            </option>
          ))}
        </Select>
      </FormField>
      <details>
        <summary>임시 참가자·조건·진행 상태</summary>
        <p className={s.small}>
          현재 구성은 시험의 시작값이에요. 체크를 바꿔도 실제 구성은 바뀌지 않아요.
        </p>
        {isSceneStory && (
          <FormField label="이미 알고 있는 이름 · 시험에만 사용">
            <TextInput
              fill
              value={sceneKnownName}
              onChange={(event) => setSceneKnownName(event.target.value)}
            />
          </FormField>
        )}
        {actors.map((actor) => (
          <Checkbox
            key={actor.id}
            checked={presentIds.includes(actor.id)}
            disabled={!presentIds.includes(actor.id) && presentIds.length >= 8}
            onChange={(event) => setPresentIds(toggle(presentIds, actor.id, event.target.checked))}
            label={<>{actor.definition.name} · 시험 참가</>}
          />
        ))}
        {presentIds
          .filter((id) => !actors.some((actor) => actor.id === id))
          .map((id, index) => (
            <Checkbox
              key={id}
              checked
              onChange={() => setPresentIds(presentIds.filter((value) => value !== id))}
              label={<>다른 팩의 점유 자리 {index + 1}</>}
            />
          ))}
        {definition.storyFlags.map((flag) => (
          <Checkbox
            key={flag.id}
            checked={flags.includes(flag.id)}
            onChange={(event) => setFlags(toggle(flags, flag.id, event.target.checked))}
            label={<>{flag.id} · 시험 조건</>}
          />
        ))}
        <FormField label={`${title} 친밀도`}>
          <TextInput
            fill
            type="number"
            min={0}
            max={100}
            value={affinity}
            onChange={(event) => setAffinity(event.target.value)}
          />
        </FormField>
        <FormField label={`${title} 현재 입력 수`}>
          <TextInput
            fill
            type="number"
            min={0}
            value={turn}
            onChange={(event) => setTurn(event.target.value)}
          />
        </FormField>
        <FormField label={`${title} 다시 제안할 입력 수`}>
          <TextInput
            fill
            type="number"
            min={0}
            value={waitTurn}
            onChange={(event) => setWaitTurn(event.target.value)}
          />
        </FormField>
        {definition.scenarios.map((scenario) => (
          <div key={scenario.id}>
            <Checkbox
              checked={completed.includes(scenario.id)}
              onChange={(event) => {
                setCompleted(toggle(completed, scenario.id, event.target.checked));
                if (event.target.checked)
                  setIncomplete(incomplete.filter((id) => id !== scenario.id));
              }}
              label={<>{scenario.title} · 완료한 것으로 시험</>}
            />
            <Checkbox
              checked={incomplete.includes(scenario.id)}
              onChange={(event) => {
                setIncomplete(toggle(incomplete, scenario.id, event.target.checked));
                if (event.target.checked)
                  setCompleted(completed.filter((id) => id !== scenario.id));
              }}
              label={<>{scenario.title} · 미완료로 시험</>}
            />
          </div>
        ))}
      </details>
      <Button
        disabled={
          !visible ||
          !expanded ||
          busy ||
          !valid ||
          Boolean(packId && !draftDefinition && !snapshot)
        }
        onClick={() => void test()}
      >
        {title}
      </Button>
      {packId && !draftDefinition && (
        <Button
          variant="ghost"
          disabled={!visible || !expanded || busy}
          onClick={() => {
            setSnapshot(null);
            setReload((value) => value + 1);
          }}
        >
          팩 조건 다시 불러오기
        </Button>
      )}
      {error && (
        <p role="alert" style={{ color: "var(--comet-color-danger)" }}>
          {error}
        </p>
      )}
      {trace && isSceneStory && (
        <section aria-label={`${title} 결과`}>
          {trace.blockedReasons.map((reason, index) => (
            <p key={index}>{reason}</p>
          ))}
          {trace.scene && (
            <>
              <Surface variant="card" className={s.sourcePanel}>
                현재 상태: {SCENE_STATUSES[trace.scene.status]}
                {trace.scene.chapterId &&
                  ` · ${(sceneScenario && sceneScenario.chapters?.find((chapter) => chapter.id === trace.scene?.chapterId)?.title) ?? trace.scene.chapterId}`}
              </Surface>
              {trace.scene.status === "wait" && (
                <div>
                  <p>기다리는 단계</p>
                  <Button
                    variant="primary"
                    disabled={busy}
                    onClick={() => void test([...sceneResponses.current, { kind: "event" }])}
                  >
                    이벤트 보내기
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void test([...sceneResponses.current, { kind: "timeout" }])}
                  >
                    시간 초과
                  </Button>
                </div>
              )}
              {trace.scene.status === "ask" && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void test([...sceneResponses.current, { kind: "answer", value: sceneAnswer }]);
                  }}
                >
                  <FormField label={trace.scene.prompt ?? "시험 입력"}>
                    <TextInput
                      fill
                      value={sceneAnswer}
                      onChange={(event) => setSceneAnswer(event.target.value)}
                    />
                  </FormField>
                  <Button type="submit" disabled={busy}>
                    보내기
                  </Button>
                </form>
              )}
              {trace.scene.status === "choice" && (
                <div>
                  <p>{trace.scene.prompt}</p>
                  {trace.scene.options.map((option) => (
                    <Button
                      key={option.id}
                      disabled={busy}
                      onClick={() =>
                        void test([
                          ...sceneResponses.current,
                          { kind: "choice", optionId: option.id },
                        ])
                      }
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              )}
              <p>이렇게 이어져요</p>
              {trace.scene.history.map((entry, index) => (
                <p key={index} style={{ whiteSpace: "pre-wrap" }}>
                  {entry.persona &&
                    `${actors.find((actor) => actor.id === entry.persona)?.definition.name ?? "확인할 화자"}: `}
                  {entry.text}
                </p>
              ))}
            </>
          )}
        </section>
      )}
      {trace && !isSceneStory && (
        <section aria-label={`${title} 결과`}>
          {trace.blockedReasons.map((reason, index) => (
            <p key={index}>{reason}</p>
          ))}
          {trace.steps.length === 0 && <p role="status">시험 조건에서 등록 응답이 없어요.</p>}
          <div className={s.compactActions}>
            {trace.steps.map((value, index) => (
              <Button
                key={index}
                variant={index === stepIndex ? "primary" : "ghost"}
                onClick={() => setStepIndex(index)}
              >
                {index + 1}.{" "}
                {value.stage
                  ? STAGES[value.stage]
                  : value.source === "registered"
                    ? "등록 응답"
                    : "등록 응답 없음"}
              </Button>
            ))}
          </div>
          {step && (
            <>
              <p>시험 입력: {step.input ?? "초기 상태"}</p>
              <p>출처: {step.source === "registered" ? "등록 대사" : "등록 응답 없음"}</p>
              {step.conditions.map((condition) => (
                <p key={condition.id}>
                  {condition.label}: {condition.matched ? "충족" : "미충족"}
                </p>
              ))}
              {step.blockedReasons.map((reason, index) => (
                <p key={index}>{reason}</p>
              ))}
              <p>시험 전: {stateText(step.beforeState)}</p>
              <p>시험 후: {stateText(step.afterState)}</p>
              {step.presentationAssumed && (
                <p className={s.small}>
                  대사를 끝까지 보았다고 가정한 임시 전이예요. 실제 표시나 완료 증거가 아니에요.
                </p>
              )}
              {step.modelRequired && (
                <p>
                  {step.modelNotRunReason ??
                    "생성 응답에는 AI가 필요해요. 시험에서 모델은 실행하지 않았어요."}
                </p>
              )}
              {step.lines.map((line, index) => (
                <p key={index} style={{ whiteSpace: "pre-wrap" }}>
                  {actors.find((actor) => actor.id === line.persona)?.definition.name ??
                    "확인할 화자"}
                  : {line.text}
                </p>
              ))}
              {canPreview && (
                <CharacterLinePreview
                  key={`${key}:${stepIndex}`}
                  definition={queue[0].definition}
                  character={queue[0].character}
                  line={queue[0].line}
                  assets={queue[0].assets}
                  sequence={queue}
                  visible={visible && expanded}
                />
              )}
              {step.plannedEffects.setFlags.length > 0 && (
                <p>계획된 완료 조건: {step.plannedEffects.setFlags.join(", ")}</p>
              )}
              {step.plannedEffects.memoryTemplate && (
                <p>계획된 경험: {step.plannedEffects.memoryTemplate}</p>
              )}
            </>
          )}
        </section>
      )}
    </details>
  );
}
