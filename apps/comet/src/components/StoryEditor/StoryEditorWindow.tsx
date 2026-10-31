import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useLayoutEffect,
  type JSX,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Button, CharacterArtwork, Dialog, Select } from "@comet/ui";
import { tokens } from "@comet/token";
import {
  Background,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useNodesState,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import type {
  CharacterDefinition,
  InstalledCharacterPack,
  PackStorySnapshot,
  PackStoryDefinition,
  ScenarioDefinition,
  Snapshot,
} from "../../types";
import { useWindowCloseGuard } from "../../widgets/useWindowCloseGuard";
import { StoryPanel } from "./StoryPanel";
import { WindowHeader } from "../WindowHeader/WindowHeader";
import {
  buildStoryGraph,
  layoutStoryGraph,
  normalizeStoryChapters,
  type StoryGraph,
  type StoryGraphExit,
  type StoryGraphNode,
} from "./storyGraph";
import * as s from "./storyEditor.css";

type Target = { packId: string; scenarioId: string; createNew?: boolean };
function normalizeScenario(scenario: ScenarioDefinition): ScenarioDefinition {
  return scenario.chapters == null
    ? scenario
    : { ...scenario, chapters: normalizeStoryChapters(scenario.chapters) };
}
type CardData = Record<string, unknown> & {
  item: StoryGraphNode;
  exits: StoryGraphExit[];
  actors: CharacterDefinition[];
  openStory: (id: string) => void;
};
type CardNode = Node<CardData, "card">;

function StoryCard({ data }: NodeProps<CardNode>): JSX.Element {
  const { item, exits, actors, openStory } = data;
  if (item.kind === "end")
    return (
      <div className={s.end}>
        <Handle type="target" position={Position.Left} className={s.target} />끝
      </div>
    );
  const actor = actors.find((value) => value.sourceId === item.firstLine?.persona);
  return (
    <div className={s.card}>
      <Handle type="target" position={Position.Left} className={s.target} />
      {item.kind === "story" && item.storyId ? (
        <button
          type="button"
          className={s.storyButton}
          onClick={() => {
            if (item.storyId) openStory(item.storyId);
          }}
        >
          {item.title} →
        </button>
      ) : (
        <>
          <div className={s.cardTitle}>
            <span className={s.titleText}>{item.title || "새 장"}</span>
            {item.isStart && <span className={s.start}>시작</span>}
            {item.hasWait && <span className={s.wait}>기다림</span>}
          </div>
          {item.firstLine && (
            <div className={s.line}>
              <CharacterArtwork
                size="compact"
                face={actor?.expressions[item.firstLine.expression]}
                style={{ width: 18, height: 18, fontSize: 8, flexShrink: 0 }}
              />
              <span className={s.lineText}>{item.firstLine.text}</span>
            </div>
          )}
          {exits.length > 0 && (
            <div className={s.exits}>
              {exits.map((exit) => (
                <div className={s.exit} key={exit.id}>
                  <span className={s.exitText}>{exit.label}</span>
                  {"target" in exit && (
                    <Handle
                      id={exit.id}
                      type="source"
                      position={Position.Right}
                      className={
                        exit.kind === "choice" ? `${s.handle} ${s.choiceHandle}` : s.handle
                      }
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
const nodeTypes = { card: StoryCard };

function StoryCanvas({
  graph,
  actors,
  openStory,
  openChapter,
  closePanel,
  openSettings,
  panelOpen,
}: {
  graph: StoryGraph;
  actors: CharacterDefinition[];
  openStory: (id: string) => void;
  openChapter: (id: string) => void;
  closePanel: () => void;
  openSettings: () => void;
  panelOpen: boolean;
}): JSX.Element {
  const positions = useMemo(() => layoutStoryGraph(graph), [graph]);
  const initialNodes = useMemo<CardNode[]>(
    () =>
      graph.nodes.map((item) => ({
        id: item.id,
        type: "card",
        position: positions[item.id],
        data: {
          item,
          exits: [
            ...graph.edges.filter((edge) => edge.source === item.id),
            ...(item.localExits ?? []),
          ],
          actors,
          openStory,
        },
      })),
    [graph, positions, actors, openStory],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  useEffect(() => {
    setNodes((current) =>
      initialNodes.map((node) => ({
        ...node,
        position: current.find((item) => item.id === node.id)?.position ?? node.position,
      })),
    );
  }, [initialNodes, setNodes]);
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.id,
        style: {
          stroke: edge.kind === "choice" ? tokens["color/primary"] : tokens["color/ink-3"],
          strokeWidth: 1.5,
          strokeDasharray: edge.kind === "timeout" ? "4 4" : undefined,
        },
      })),
    [graph],
  );
  const { fitView, zoomIn, zoomOut, getViewport, setViewport, flowToScreenPosition } =
    useReactFlow();
  const [zoom, setZoom] = useState(100);
  const startPosition = graph.startId ? positions[graph.startId] : undefined;
  return (
    <div className={`${s.canvas} ${panelOpen ? s.panelOpen : ""}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        nodesConnectable={false}
        elementsSelectable={false}
        onPaneClick={closePanel}
        onNodeClick={(_, node) => {
          if (node.data.item.kind !== "chapter") return;
          openChapter(node.data.item.id);
          const right = flowToScreenPosition({ x: node.position.x + 224, y: node.position.y }).x;
          const overlap = right - (window.innerWidth - Math.min(400, window.innerWidth));
          if (overlap > 0) {
            const viewport = getViewport();
            void setViewport({ ...viewport, x: viewport.x - overlap }, { duration: 0 });
          }
        }}
        defaultViewport={{
          x: 48 - (startPosition?.x ?? 0),
          y: 80 - (startPosition?.y ?? 0),
          zoom: 1,
        }}
        onMove={(_, viewport) => setZoom(Math.round(viewport.zoom * 100))}
        minZoom={0.001}
        maxZoom={2}
      >
        <Background color={tokens["color/card-border"]} gap={20} size={1} />
        <MiniMap
          style={{ width: 220, height: 96 }}
          nodeColor={tokens["color/ink-3"]}
          maskColor={tokens["color/hover"]}
          pannable
          zoomable
        />
      </ReactFlow>
      <div className={s.toolbar}>
        <Button variant="ghost" onClick={openSettings}>
          이야기 설정
        </Button>
        <Button variant="ghost" onClick={() => void fitView({ duration: 0 })}>
          맞춤 보기
        </Button>
      </div>
      <div className={s.zoom}>
        <Button variant="ghost" aria-label="축소" onClick={() => void zoomOut({ duration: 0 })}>
          −
        </Button>
        <span className={s.zoomValue}>{zoom}%</span>
        <Button variant="ghost" aria-label="확대" onClick={() => void zoomIn({ duration: 0 })}>
          +
        </Button>
      </div>
    </div>
  );
}

export default function StoryEditorWindow({
  initialPackId,
  initialScenarioId,
}: {
  initialPackId: string;
  initialScenarioId: string;
}): JSX.Element {
  const [target, setTarget] = useState<Target>({
    packId: initialPackId,
    scenarioId: initialScenarioId,
  });
  const [packs, setPacks] = useState<InstalledCharacterPack[] | null>(null);
  const [actors, setActors] = useState<CharacterDefinition[]>([]);
  const [actorsPack, setActorsPack] = useState<string | null>(null);
  const created = useRef(new Set<string>());
  type Draft = {
    saved: PackStorySnapshot;
    definition: PackStoryDefinition;
  };
  type Change = { packId: string; before: PackStoryDefinition; after: PackStoryDefinition };
  const history = useRef<{ past: Change[]; future: Change[] }>({ past: [], future: [] });
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const [panel, setPanel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [latest, setLatest] = useState<PackStorySnapshot | null>(null);
  const lock = useRef(false);
  const pendingTarget = useRef<Target | null>(null);
  const group = useRef<EventTarget | null>(null);
  const targetRef = useRef(target);
  targetRef.current = target;
  const draft = drafts[target.packId];
  const dirty = Object.values(drafts).some(
    (item) => JSON.stringify(item.definition) !== JSON.stringify(item.saved.definition),
  );
  const closeGuard = useWindowCloseGuard(dirty, busy, () => getCurrentWindow().destroy());
  function receiveTarget(value: Target): void {
    if (lock.current) pendingTarget.current = value;
    else setTarget(value);
  }
  function releaseLock(): void {
    lock.current = false;
    setBusy(false);
    const pending = pendingTarget.current;
    pendingTarget.current = null;
    if (pending) setTarget(pending);
  }
  function recordChange(
    packId: string,
    before: PackStoryDefinition,
    after: PackStoryDefinition,
    grouped = false,
  ): void {
    const { past } = history.current;
    const last = past.at(-1);
    if (grouped && last?.packId === packId) last.after = after;
    else past.push({ packId, before, after });
    history.current.future = [];
  }
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    let received = false;
    let unlisten: (() => void) | undefined;
    void listen<Target>(
      "open-story-editor",
      ({ payload }) => {
        received = true;
        if (active) receiveTarget(payload);
      },
      { target: { kind: "WebviewWindow", label: "story-editor" } },
    )
      .then(async (cleanup) => {
        if (!active) {
          cleanup();
          return;
        }
        unlisten = cleanup;
        const current = await command<Target>("get_story_editor_target");
        if (active && !received && current) receiveTarget(current);
      })
      .catch((cause: unknown) => {
        if (active) setError(errorText(cause));
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setPanel(null);
    group.current = null;
    void Promise.all([
      command<InstalledCharacterPack[]>("get_character_packs"),
      command<Snapshot>("get_snapshot"),
    ])
      .then(async ([available, snapshot]) => {
        if (!active) return;
        setPacks(available);
        setActorsPack(target.packId);
        setActors(
          snapshot.characters.installed
            .filter((actor) => actor.packId === target.packId)
            .map((actor) => actor.definition),
        );
        if (target.packId && !draftsRef.current[target.packId]) {
          const saved = await command<PackStorySnapshot>("get_pack_story_definition", {
            packId: target.packId,
          });
          if (!active) return;
          const definition = {
            ...saved.definition,
            scenarios: saved.definition.scenarios.map(normalizeScenario),
          };
          setDrafts((current) => ({
            ...current,
            [target.packId]: { saved: { ...saved, definition }, definition },
          }));
        }
        if (active) setLoading(false);
      })
      .catch((cause: unknown) => {
        if (active) {
          setError(errorText(cause));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [target.packId, revision]);
  useEffect(() => {
    if (
      loading ||
      !target.createNew ||
      actorsPack !== target.packId ||
      created.current.has(target.scenarioId) ||
      !draft ||
      draft.definition.scenarios.some((item) => item.id === target.scenarioId)
    )
      return;
    const first = actors.find((actor) => actor.presenceRole !== "npc");
    if (!first) {
      setError("중심 인물로 선택할 친구가 없어요.");
      return;
    }
    created.current.add(target.scenarioId);
    const scenario: ScenarioDefinition = {
      id: target.scenarioId,
      title: "",
      centerId: first.sourceId,
      participants: [first.sourceId],
      keywords: [],
      requiredFlags: [],
      minAffinity: 0,
      purpose: "story",
      chapters: [
        {
          id: crypto.randomUUID(),
          title: "",
          next: "end",
          steps: [{ kind: "line", persona: first.sourceId, expression: "평온", text: "" }],
        },
      ],
      allowIncompleteRepeat: false,
      allowRepeat: false,
      completion: { setFlags: [], memoryTemplate: null },
    };
    const definition = {
      ...draft.definition,
      scenarios: [...draft.definition.scenarios, scenario],
    };
    recordChange(target.packId, draft.definition, definition);
    setDrafts((current) => {
      const item = current[target.packId];
      if (!item || item.definition.scenarios.some((value) => value.id === scenario.id))
        return current;
      return {
        ...current,
        [target.packId]: {
          ...item,
          definition,
        },
      };
    });
  }, [loading, target.packId, target.scenarioId, target.createNew, draft, actors, actorsPack]);
  const scenarios = draft?.definition.scenarios ?? [];
  const selected = scenarios.find((value) => value.id === target.scenarioId) ?? scenarios[0];
  const graph = useMemo(
    () => (selected ? buildStoryGraph(selected, scenarios) : null),
    [selected, scenarios],
  );
  useLayoutEffect(() => {
    if (selected?.chapters?.length === 1) setPanel(`chapter:${selected.chapters[0].id}`);
    else setPanel(null);
  }, [target.packId, selected?.id]);
  const openStory = useCallback((scenarioId: string) => {
    group.current = null;
    setPanel(null);
    setTarget((current) => ({ ...current, scenarioId }));
  }, []);
  function updateScenario(scenario: ScenarioDefinition): void {
    if (lock.current || !draft) return;
    const definition = {
      ...draft.definition,
      scenarios: scenarios.map((value) => (value.id === scenario.id ? scenario : value)),
    };
    const active = document.activeElement;
    const typing = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;
    const grouped = typing && group.current === active;
    group.current = typing ? active : null;
    recordChange(target.packId, draft.definition, definition, grouped);
    setDrafts((current) => ({
      ...current,
      [target.packId]: {
        ...draft,
        definition,
      },
    }));
  }
  function travel(redo: boolean): void {
    if (lock.current) return;
    const from = redo ? history.current.future : history.current.past;
    const to = redo ? history.current.past : history.current.future;
    const change = from.pop();
    if (!change) return;
    to.push(change);
    group.current = null;
    setDrafts((current) => ({
      ...current,
      [change.packId]: {
        ...current[change.packId],
        definition: redo ? change.after : change.before,
      },
    }));
  }
  useEffect(() => {
    function keydown(event: KeyboardEvent): void {
      if (event.key === "Escape") setPanel(null);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.altKey) {
        event.preventDefault();
        travel(event.shiftKey);
      }
    }
    function blur(): void {
      group.current = null;
    }
    function beforeKeydown(event: KeyboardEvent): void {
      if (event.key === "Enter" && !event.shiftKey) group.current = null;
    }
    document.addEventListener("keydown", beforeKeydown, true);
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusout", blur);
    return () => {
      document.removeEventListener("keydown", beforeKeydown, true);
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("focusout", blur);
    };
  });
  async function loadLatest(): Promise<void> {
    if (lock.current || !target.packId) return;
    const packId = target.packId;
    lock.current = true;
    setBusy(true);
    try {
      const value = await command<PackStorySnapshot>("get_pack_story_definition", { packId });
      if (targetRef.current.packId === packId && !pendingTarget.current) setLatest(value);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      releaseLock();
    }
  }
  async function save(all = false): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError(null);
    group.current = null;
    try {
      const entries = Object.entries(draftsRef.current).filter(
        ([id, item]) =>
          (all || id === targetRef.current.packId) &&
          JSON.stringify(item.definition) !== JSON.stringify(item.saved.definition),
      );
      for (const [packId, item] of entries) {
        const definition = {
          ...item.definition,
          scenarios: item.definition.scenarios.map(normalizeScenario),
        };
        const saved = await command<PackStorySnapshot>("save_pack_story_definition", {
          packId,
          definition,
          expectedBaseline: item.saved.baseline,
        });
        const normalized = {
          ...saved.definition,
          scenarios: saved.definition.scenarios.map(normalizeScenario),
        };
        setDrafts((current) => ({
          ...current,
          [packId]: {
            ...current[packId],
            saved: { ...saved, definition: normalized },
            definition: normalized,
          },
        }));
      }
      return true;
    } catch (cause) {
      setError(errorText(cause));
      return false;
    } finally {
      releaseLock();
    }
  }
  return (
    <main className={s.window}>
      <WindowHeader
        label="창 닫기"
        nativeControls
        className={s.header}
        onClose={closeGuard.requestClose}
        actions={
          <div className={s.selectors}>
            <Select
              aria-label="팩 선택"
              disabled={busy}
              value={target.packId}
              onChange={(event) => setTarget({ packId: event.target.value, scenarioId: "" })}
            >
              {packs?.map((pack) => (
                <option key={pack.id} value={pack.id}>
                  {pack.name}
                </option>
              ))}
            </Select>
            <Select
              aria-label="이야기 선택"
              value={selected?.id ?? ""}
              disabled={!selected || busy}
              onChange={(event) => openStory(event.target.value)}
            >
              {scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.title}
                </option>
              ))}
            </Select>
            <div className={s.saveActions}>
              {dirty && <span>바뀐 내용</span>}
              <Button
                variant="ghost"
                disabled={
                  !draft ||
                  busy ||
                  JSON.stringify(draft.definition) === JSON.stringify(draft.saved.definition)
                }
                onClick={() => {
                  if (!draft) return;
                  group.current = null;
                  recordChange(target.packId, draft.definition, draft.saved.definition);
                  setDrafts((current) => ({
                    ...current,
                    [target.packId]: {
                      ...draft,
                      definition: draft.saved.definition,
                    },
                  }));
                }}
              >
                취소
              </Button>
              <Button
                disabled={
                  !draft ||
                  busy ||
                  JSON.stringify(draft.definition) === JSON.stringify(draft.saved.definition)
                }
                onClick={() => void save()}
              >
                저장
              </Button>
            </div>
          </div>
        }
      >
        <span className={s.windowTitle}>장면 편집기</span>
      </WindowHeader>
      {error && !loading && draft && !closeGuard.confirmClose && (
        <div role="alert">
          저장하거나 불러오지 못했어요. {error}{" "}
          <Button disabled={busy} onClick={() => void loadLatest()}>
            최신 내용 확인
          </Button>
        </div>
      )}
      {loading ? (
        <div className={s.canvas}>
          <div className={s.state} role="status">
            이야기를 불러오는 중이에요.
          </div>
        </div>
      ) : error && !draft ? (
        <div className={s.canvas}>
          <div className={s.state}>
            <p role="alert">이야기를 불러오지 못했어요. {error}</p>
            <Button onClick={() => setRevision((value) => value + 1)}>다시 불러오기</Button>
          </div>
        </div>
      ) : !graph || !selected ? (
        <div className={s.canvas}>
          <div className={s.state}>이야기가 없어요.</div>
        </div>
      ) : (
        <div className={s.workspace}>
          <ReactFlowProvider key={`${target.packId}:${selected.id}`}>
            <StoryCanvas
              graph={graph}
              actors={actors}
              openStory={openStory}
              openChapter={(id) => setPanel(id)}
              closePanel={() => setPanel(null)}
              openSettings={() => setPanel("settings")}
              panelOpen={panel !== null}
            />
          </ReactFlowProvider>
          {panel && (
            <StoryPanel
              key={`${selected.id}:${panel}`}
              scenario={selected}
              chapterId={panel === "settings" ? null : panel.replace(/^chapter:/, "")}
              actors={actors}
              onChange={updateScenario}
              onClose={() => setPanel(null)}
            />
          )}
        </div>
      )}
      <Dialog
        isOpen={latest !== null}
        title="저장된 최신 내용"
        variant="confirm"
        onOpenChange={(open) => {
          if (!open) setLatest(null);
        }}
        footer={
          <>
            <Button onClick={() => setLatest(null)}>초안 계속 편집</Button>
            <Button
              onClick={() => {
                if (!latest) return;
                const definition = {
                  ...latest.definition,
                  scenarios: latest.definition.scenarios.map(normalizeScenario),
                };
                history.current.past = history.current.past.filter(
                  (item) => item.packId !== latest.packId,
                );
                history.current.future = history.current.future.filter(
                  (item) => item.packId !== latest.packId,
                );
                group.current = null;
                setDrafts((current) => ({
                  ...current,
                  [latest.packId]: {
                    saved: { ...latest, definition },
                    definition,
                  },
                }));
                setLatest(null);
                setError(null);
              }}
            >
              초안을 버리고 불러오기
            </Button>
          </>
        }
      >
        <p>다른 창에서 저장한 이야기</p>
        <ul>
          {latest?.definition.scenarios.map((item) => (
            <li key={item.id}>
              <details>
                <summary>{item.title || "새 이야기"}</summary>
                {(item.chapters ?? []).map((chapter) => (
                  <section key={chapter.id}>
                    <strong>{chapter.title || "새 장"}</strong>
                    {chapter.steps.map((step, index) =>
                      step.kind === "line" ? (
                        <p key={index}>{step.text}</p>
                      ) : step.kind === "ask" || step.kind === "choice" ? (
                        <p key={index}>{step.prompt}</p>
                      ) : null,
                    )}
                  </section>
                ))}
                {item.chapters == null &&
                  [
                    ...(item.intro ?? []),
                    ...(item.accept ?? []),
                    ...(item.decline ?? []),
                    ...(item.ending ?? []),
                  ].map((line, index) => <p key={index}>{line.text}</p>)}
              </details>
            </li>
          ))}
        </ul>
      </Dialog>
      <Dialog
        isOpen={closeGuard.confirmClose}
        title="바뀐 내용을 저장할까요?"
        variant="confirm"
        onOpenChange={(open) => {
          if (!open) closeGuard.keepEditing();
        }}
        footer={
          <>
            <Button onClick={closeGuard.keepEditing}>계속 편집</Button>
            <Button disabled={busy} onClick={() => void closeGuard.discardAndClose()}>
              버리기
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                void (async () => {
                  if (await save(true)) await getCurrentWindow().destroy();
                })()
              }
            >
              저장
            </Button>
          </>
        }
      >
        <p>저장하지 않은 내용이 있어요.</p>
        {error && (
          <p role="alert">
            저장하지 못했어요. {error} 계속 편집으로 돌아가 최신 내용을 확인할 수 있어요.
          </p>
        )}
      </Dialog>
      {closeGuard.closeError && <p role="alert">{closeGuard.closeError}</p>}
    </main>
  );
}
