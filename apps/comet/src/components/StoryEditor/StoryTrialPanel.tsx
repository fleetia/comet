import { useEffect, useRef, useState, type JSX } from "react";
import { Button, Checkbox, FormField, Select, TextInput } from "@comet/ui";
import { command, errorText } from "../../hooks/useSnapshot";
import type {
  AuthoringTrialTrace,
  InstalledCharacter,
  PackStoryDefinition,
  ScenarioDefinition,
} from "../../types";
import { CharacterLinePreview, type CharacterPreviewLine } from "../CharacterEditor/CharacterLinePreview";
import * as s from "./storyEditor.css";
import * as trialStyles from "./storyTrial.css";

type SceneResponse =
  | { kind: "event" | "timeout" }
  | { kind: "answer"; value: string }
  | { kind: "choice"; optionId: string };

export function StoryTrialPanel({
  actors,
  definition,
  scenario,
  startChapterId,
  visible,
  onTrace,
  onClose,
}: {
  actors: InstalledCharacter[];
  definition: PackStoryDefinition;
  scenario: ScenarioDefinition;
  startChapterId: string | null;
  visible: boolean;
  onTrace: (trace: AuthoringTrialTrace | null) => void;
  onClose: () => void;
}): JSX.Element {
  const [chapterId, setChapterId] = useState(startChapterId ?? scenario.chapters?.[0]?.id ?? "");
  const [name, setName] = useState("");
  const [flags, setFlags] = useState<string[]>([]);
  const [affinity, setAffinity] = useState("20");
  const [answer, setAnswer] = useState("");
  const [trace, setTrace] = useState<AuthoringTrialTrace | null>(null);
  const [scenePreviewStart, setScenePreviewStart] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const pending = useRef(false);
  const responses = useRef<SceneResponse[]>([]);
  const inputs = useRef<string[]>([]);
  const selectedStart = useRef<string | null>(null);
  const onTraceRef = useRef(onTrace);
  onTraceRef.current = onTrace;
  const identity = JSON.stringify([actors, definition, scenario.id, visible]);
  const previousIdentity = useRef(identity);
  if (previousIdentity.current !== identity) {
    previousIdentity.current = identity;
    generation.current += 1;
  }
  useEffect(() => {
    generation.current += 1;
    pending.current = false;
    setBusy(false);
    setTrace(null);
    setError(null);
    responses.current = [];
    inputs.current = [];
    onTraceRef.current(null);
  }, [identity]);
  useEffect(() => {
    function invalidate(): void {
      if (!document.hidden) return;
      generation.current += 1;
      pending.current = false;
      setBusy(false);
      setTrace(null);
      setError(null);
      responses.current = [];
      inputs.current = [];
      onTraceRef.current(null);
    }
    document.addEventListener("visibilitychange", invalidate);
    return () => {
      generation.current += 1;
      document.removeEventListener("visibilitychange", invalidate);
    };
  }, []);
  const center = actors.find((actor) => actor.definition.sourceId === scenario.centerId);
  const valid = Boolean(
    center &&
    affinity.trim() &&
    Number.isInteger(Number(affinity)) &&
    Number(affinity) >= 0 &&
    Number(affinity) <= 100 &&
    Array.from(name).length <= 40 &&
    !/\p{Cc}/u.test(name),
  );
  async function run(
    nextResponses: SceneResponse[],
    nextInputs: string[],
    start: string | null,
  ): Promise<void> {
    if (!visible || !valid || !center || pending.current) return;
    const version = ++generation.current;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result = await command<AuthoringTrialTrace>("trial_pack_authoring", {
        request: {
          actors: actors.map((actor) => ({
            id: actor.id,
            packId: actor.packId,
            definition: actor.definition,
          })),
          definition,
          subject: { kind: "scenario", scenarioId: scenario.id },
          context: {
            centerId: center.id,
            presentIds: actors
              .filter((actor) => actor.definition.presenceRole !== "npc")
              .map((actor) => actor.id),
            flags,
            affinity: Number(affinity),
            turn: 0,
            waitTurn: 0,
            completedScenarioIds: [],
            incompleteScenarioIds: [],
          },
          inputs: nextInputs,
          ...(scenario.chapters != null
            ? {
                sceneResponses: nextResponses,
                sceneKnownName: name,
                sceneStartChapterId: start,
              }
            : {}),
        },
      });
      if (generation.current !== version) return;
      responses.current = nextResponses;
      inputs.current = nextInputs;
      selectedStart.current = start;
      setScenePreviewStart(trace?.scene?.history.length ?? 0);
      setTrace(result);
      onTraceRef.current(result);
      setAnswer("");
    } catch (cause) {
      if (generation.current === version) setError(errorText(cause));
    } finally {
      if (generation.current === version) {
        pending.current = false;
        setBusy(false);
      }
    }
  }
  function start(fromChapter: boolean): void {
    void run(
      [],
      scenario.chapters == null ? [scenario.keywords[0] || "시작"] : [],
      fromChapter ? chapterId : null,
    );
  }
  function sendResponse(response: SceneResponse): void {
    void run([...responses.current, response], inputs.current, selectedStart.current);
  }
  const scene = trace?.scene;
  const step = trace?.steps.at(-1);
  const preview: CharacterPreviewLine[] = [];
  if (step) {
    for (const [index, line] of step.lines.entries()) {
      const actor = actors.find((value) => value.id === line.persona);
      if (actor) {
        preview.push({
          definition: actor.definition,
          character: actor,
          line,
          assets: [],
          durationMs: step.lineDurationsMs[index],
        });
      }
    }
  }
  const scenePreview: CharacterPreviewLine[] = [];
  for (const entry of scene?.history.slice(scenePreviewStart) ?? []) {
    const actor = actors.find((value) => value.id === entry.line?.persona);
    if (actor && entry.line && entry.durationMs !== undefined) {
      scenePreview.push({
        definition: actor.definition,
        character: actor,
        line: entry.line,
        assets: [],
        durationMs: entry.durationMs,
      });
    }
  }
  const proposalStage = trace?.steps.filter((step) => step.stage).at(-1)?.stage;
  const proposalReplies =
    proposalStage === "intro"
      ? [...(scenario.acceptKeywords ?? []), ...(scenario.declineKeywords ?? [])]
      : proposalStage === "accept"
        ? (scenario.proceedKeywords ?? [])
        : [];
  return (
    <aside className={`${s.problemsPanel} ${trialStyles.panel}`} aria-label="시험">
      <div className={s.problemsHeader}>
        <strong>시험</strong>
        <Button variant="ghost" onClick={onClose}>
          시험 끝내기
        </Button>
      </div>
      <p>실제 창을 열지 않고 기억과 친밀도도 바뀌지 않아요.</p>
      {!trace && (
        <>
          <h3>어디서 시작할까요</h3>
          {scenario.chapters != null && (
            <FormField label="시작 장">
              <Select fill value={chapterId} onChange={(event) => setChapterId(event.target.value)}>
                {scenario.chapters.map((chapter) => (
                  <option key={chapter.id} value={chapter.id}>
                    {chapter.title || "새 장"}
                  </option>
                ))}
              </Select>
            </FormField>
          )}
          {scenario.chapters != null && (
            <FormField label="이미 알고 있는 이름">
              <TextInput fill value={name} onChange={(event) => setName(event.target.value)} />
            </FormField>
          )}
          {scenario.chapters != null && (
            <p>
              이미 알고 있는 이름을 쓰면 이름을 알 때 대사로 넘어가요. 시험에만 쓰고 저장하지
              않아요.
            </p>
          )}
          <p>조건</p>
          {definition.storyFlags.map((flag) => (
            <Checkbox
              key={flag.id}
              checked={flags.includes(flag.id)}
              onChange={(event) =>
                setFlags((current) =>
                  event.target.checked
                    ? [...current, flag.id]
                    : current.filter((id) => id !== flag.id),
                )
              }
              label={flag.id}
            />
          ))}
          <FormField label="친밀도">
            <TextInput
              fill
              type="number"
              min={0}
              max={100}
              value={affinity}
              onChange={(event) => setAffinity(event.target.value)}
            />
          </FormField>
          <div className={trialStyles.startActions}>
            {scenario.chapters != null && (
              <Button disabled={busy || !valid || !chapterId} onClick={() => start(true)}>
                이 장부터 시험
              </Button>
            )}
            <Button variant="ghost" disabled={busy || !valid} onClick={() => start(false)}>
              처음부터 시험
            </Button>
          </div>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {trace && (
        <section aria-label="시험 결과">
          {trace.blockedReasons.map((reason, index) => (
            <p key={index}>{reason}</p>
          ))}
          {scene ? (
            <>
              <div className={trialStyles.conversation}>
                {scene.history.map((entry, index) => (
                  <p
                    key={index}
                    className={`${trialStyles.message} ${entry.persona ? "" : trialStyles.reply}`}
                  >
                    {entry.persona &&
                      `${actors.find((actor) => actor.id === entry.persona)?.definition.name ?? "친구"}: `}
                    {entry.text}
                  </p>
                ))}
              </div>
              {scenePreview.length > 0 && (
                <CharacterLinePreview
                  key={JSON.stringify(scenePreview)}
                  definition={scenePreview[0].definition}
                  character={scenePreview[0].character}
                  line={scenePreview[0].line}
                  assets={scenePreview[0].assets}
                  sequence={scenePreview}
                  visible={visible}
                />
              )}
              {scene.status === "wait" && (
                <div>
                  <p>기다리는 중</p>
                  <Button disabled={busy} onClick={() => sendResponse({ kind: "event" })}>
                    이벤트 보내기
                  </Button>
                  <Button disabled={busy} onClick={() => sendResponse({ kind: "timeout" })}>
                    시간 초과
                  </Button>
                </div>
              )}
              {scene.status === "ask" && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    sendResponse({ kind: "answer", value: answer });
                  }}
                >
                  <FormField label="시험 입력">
                    <TextInput
                      fill
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                    />
                  </FormField>
                  <Button type="submit" disabled={busy}>
                    보내기
                  </Button>
                </form>
              )}
              {scene.status === "choice" && (
                <div>
                  {scene.options.map((option) => (
                    <Button
                      key={option.id}
                      disabled={busy}
                      onClick={() => sendResponse({ kind: "choice", optionId: option.id })}
                    >
                      {option.label}
                    </Button>
                  ))}
                </div>
              )}
              {scene.status === "completed" && <p>이야기가 끝났어요.</p>}
            </>
          ) : (
            <>
              {trace.steps.length === 0 && <p role="status">시험 조건에서 등록 응답이 없어요.</p>}
              <div className={trialStyles.conversation}>
                {trace.steps.flatMap((step, index) => [
                  ...(index > 0 && step.input
                    ? [
                        <p
                          key={`${index}:input`}
                          className={`${trialStyles.message} ${trialStyles.reply}`}
                        >
                          {step.input}
                        </p>,
                      ]
                    : []),
                  ...step.lines.map((line, lineIndex) => (
                    <p key={`${index}:${lineIndex}`} className={trialStyles.message}>
                      {actors.find((actor) => actor.id === line.persona)?.definition.name ?? "친구"}
                      : {line.text}
                    </p>
                  )),
                ])}
              </div>
              {step && preview.length > 0 && preview.length === step.lines.length && (
                <CharacterLinePreview
                  key={JSON.stringify(step)}
                  definition={preview[0].definition}
                  character={preview[0].character}
                  line={preview[0].line}
                  assets={preview[0].assets}
                  sequence={preview}
                  visible={visible}
                />
              )}
              {proposalReplies.map((reply, index) => (
                <Button
                  key={`${reply}:${index}`}
                  disabled={busy}
                  onClick={() => void run([], [...inputs.current, reply], null)}
                >
                  {reply}
                </Button>
              ))}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  if (answer.trim()) void run([], [...inputs.current, answer], null);
                }}
              >
                <FormField label="시험 입력">
                  <TextInput
                    fill
                    value={answer}
                    onChange={(event) => setAnswer(event.target.value)}
                  />
                </FormField>
                <Button type="submit" disabled={busy || !answer.trim()}>
                  보내기
                </Button>
              </form>
            </>
          )}
        </section>
      )}
    </aside>
  );
}
