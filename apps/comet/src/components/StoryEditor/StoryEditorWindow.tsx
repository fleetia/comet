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
  useUpdateNodeInternals,
  type Edge,
  type Node,
  type NodeProps,
  type XYPosition,
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
import { ProposalStoryPanel, type ProposalStage } from "./ProposalStoryPanel";
import { WindowHeader } from "../WindowHeader/WindowHeader";
import {
  buildStoryGraph,
  normalizeStoryChapters,
  findStoryProblems,
  setStoryExit,
  createStoryChapter,
  deleteStoryChapter,
  incomingStoryExits,
  STORY_CHAPTER_LIMIT,
  setStoryStart,
  type StoryExitRef,
  type StoryProblem,
  type StoryGraph,
  type StoryGraphExit,
  type StoryGraphNode,
} from "./storyGraph";
import { useStoryPositions } from "./storyPositions";
import { changeStoryMode, type StoryMode } from "./storyMode";
import * as modeStyles from "./storyMode.css";
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
  editable: boolean;
  hasProblem: boolean;
};
type CardNode = Node<CardData, "card">;

function StoryCard({ id, data }: NodeProps<CardNode>): JSX.Element {
  const { item, exits, actors, openStory, editable, hasProblem } = data;
  const updateNodeInternals = useUpdateNodeInternals();
  const exitIds = exits.map((exit) => exit.id).join("|");
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, exitIds, updateNodeInternals]);
  if (item.kind === "end")
    return (
      <div className={s.end}>
        <Handle type="target" position={Position.Left} className={s.target} />끝
      </div>
    );
  const actor = actors.find((value) => value.sourceId === item.firstLine?.persona);
  return (
    <div
      className={`${item.kind === "story" ? s.storyCard : s.card} ${hasProblem ? s.problemCard : ""}`}
    >
      <Handle type="target" position={Position.Left} className={s.target} />
      {item.kind === "story" && item.storyId ? (
        <button
          type="button"
          className={s.storyButton}
          onClick={() => {
            if (item.storyId) openStory(item.storyId);
          }}
        >
          <span className={s.storyLabel}>다음 이야기</span>
          <strong>{item.title}</strong>
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
                  <span
                    className={`${s.exitText} ${exit.targetState === "missing" || exit.targetState === "invalid" ? s.missingExit : ""}`}
                  >
                    {exit.targetState === "missing" ? `${exit.label} · 이어질 곳 없음` : exit.label}
                  </span>
                  {("target" in exit || (editable && exit.ref)) && (
                    <Handle
                      id={exit.id}
                      type="source"
                      isConnectable={editable && !!exit.ref}
                      position={Position.Right}
                      className={
                        exit.targetState === "missing" || exit.targetState === "invalid"
                          ? `${s.handle} ${s.missingHandle}`
                          : exit.kind === "choice"
                            ? `${s.handle} ${s.choiceHandle}`
                            : s.handle
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
  editable,
  packId,
  scenarioId,
  problems,
  onConnectExit,
  onCreateChapter,
  onAddChapter,
  onDisconnect,
  openProblems,
  atLimit,
  focusRequest,
}: {
  graph: StoryGraph;
  actors: CharacterDefinition[];
  openStory: (id: string) => void;
  openChapter: (id: string) => void;
  closePanel: () => void;
  openSettings: () => void;
  panelOpen: boolean;
  editable: boolean;
  packId: string;
  scenarioId: string;
  problems: StoryProblem[];
  onConnectExit: (ref: StoryExitRef, target: string) => void;
  onCreateChapter: (ref: StoryExitRef) => string | undefined;
  onAddChapter: () => void;
  onDisconnect: (ref: StoryExitRef) => void;
  openProblems: () => void;
  atLimit: boolean;
  focusRequest: { id: string; sequence: number } | null;
}): JSX.Element {
  const { positions, savePosition, tidy } = useStoryPositions(graph, packId, scenarioId);
  const initialNodes = useMemo<CardNode[]>(
    () =>
      graph.nodes.map((item) => ({
        id: item.id,
        type: "card",
        position: positions[item.id],
        draggable: item.kind === "chapter",
        deletable: false,
        data: {
          item,
          exits: [
            ...graph.edges.filter((edge) => edge.source === item.id),
            ...(item.localExits ?? []),
          ],
          actors,
          openStory,
          editable,
          hasProblem: problems.some(
            (problem) => `${editable ? "chapter" : "proposal"}:${problem.chapterId}` === item.id,
          ),
        },
      })),
    [graph, positions, actors, openStory, editable, problems],
  );
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  useEffect(() => {
    setNodes(initialNodes);
  }, [initialNodes, setNodes]);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const edges = useMemo<Edge[]>(
    () =>
      graph.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.id,
        selectable: editable && !!edge.ref,
        deletable: editable && !!edge.ref,
        selected: selectedEdge === edge.id,
        style: {
          stroke: edge.kind === "choice" ? tokens["color/primary"] : tokens["color/ink-3"],
          strokeWidth: selectedEdge === edge.id ? 3 : 1.5,
          strokeDasharray: edge.kind === "timeout" ? "4 4" : undefined,
        },
      })),
    [graph, editable, selectedEdge],
  );
  const {
    fitView,
    zoomIn,
    zoomOut,
    getViewport,
    setViewport,
    setCenter,
    flowToScreenPosition,
    screenToFlowPosition,
  } = useReactFlow();
  const [zoom, setZoom] = useState(100);
  const [draggingExit, setDraggingExit] = useState(false);
  const [dropPoint, setDropPoint] = useState<XYPosition | null>(null);
  const handledFocus = useRef<number | null>(null);
  useEffect(() => {
    if (!focusRequest || handledFocus.current === focusRequest.sequence) return;
    const position = nodes.find(
      (node) => node.id === `${editable ? "chapter" : "proposal"}:${focusRequest.id}`,
    )?.position;
    if (!position) return;
    handledFocus.current = focusRequest.sequence;
    const zoom = getViewport().zoom;
    void setCenter(
      position.x + 112 + Math.min(400, window.innerWidth) / (2 * zoom),
      position.y + 50,
      { duration: 0 },
    );
  }, [focusRequest, nodes, getViewport, setCenter, editable]);
  useEffect(() => {
    function keydown(event: KeyboardEvent): void {
      if (!selectedEdge || (event.key !== "Delete" && event.key !== "Backspace")) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement ||
        (active instanceof HTMLElement && active.isContentEditable)
      )
        return;
      const ref = graph.edges.find((edge) => edge.id === selectedEdge)?.ref;
      if (ref) {
        event.preventDefault();
        onDisconnect(ref);
        setSelectedEdge(null);
      }
    }
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, [selectedEdge, graph, onDisconnect]);
  const startPosition = graph.startId ? positions[graph.startId] : undefined;
  return (
    <div
      className={`${s.canvas} ${panelOpen ? s.panelOpen : ""}`}
      onMouseMove={(event) => {
        if (!draggingExit) return;
        const element = document.elementFromPoint(event.clientX, event.clientY);
        const bounds = event.currentTarget.getBoundingClientRect();
        setDropPoint(
          element?.classList.contains("react-flow__pane")
            ? { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
            : null,
        );
      }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        nodesConnectable={editable}
        connectionLineStyle={{ strokeDasharray: "4 4" }}
        elementsSelectable={editable}
        nodesDraggable
        onNodeDragStop={(_, node) => savePosition(node.id, node.position)}
        onConnectStart={(_, params) => {
          if (params.handleType === "source") setDraggingExit(true);
        }}
        onConnectEnd={(event, state) => {
          setDraggingExit(false);
          setDropPoint(null);
          if (!editable || !state.fromHandle) return;
          const exit = [
            ...graph.edges,
            ...graph.nodes.flatMap((node) => node.localExits ?? []),
          ].find((item) => item.id === state.fromHandle?.id);
          if (!exit?.ref) return;
          const point = "changedTouches" in event ? event.changedTouches[0] : event;
          if (!point) return;
          const element = document.elementFromPoint(point.clientX, point.clientY);
          const nodeElement = element?.closest(".react-flow__node");
          const targetId = nodeElement?.getAttribute("data-id");
          if (targetId?.startsWith("chapter:")) onConnectExit(exit.ref, targetId.slice(8));
          else if (!atLimit && element?.classList.contains("react-flow__pane")) {
            const id = onCreateChapter(exit.ref);
            if (id)
              savePosition(
                `chapter:${id}`,
                screenToFlowPosition({ x: point.clientX, y: point.clientY }),
              );
          }
        }}
        deleteKeyCode={null}
        onEdgeClick={(_, edge) => {
          if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
          setSelectedEdge(edge.id);
        }}
        onPaneClick={() => {
          setSelectedEdge(null);
          closePanel();
        }}
        onNodeClick={(_, node) => {
          setSelectedEdge(null);
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
      {draggingExit && dropPoint && !atLimit && (
        <div className={s.dropHint} style={{ left: dropPoint.x, top: dropPoint.y }}>
          여기에 놓으면 새 장
        </div>
      )}
      <div className={s.toolbar}>
        <Button variant="ghost" onClick={openSettings}>
          이야기 설정
        </Button>
        <Button
          variant="ghost"
          disabled={!editable || atLimit}
          title={
            !editable
              ? "제안형은 네 단계가 정해져 있어서 장을 더할 수 없어요."
              : atLimit
                ? "장은 99개까지 만들 수 있어요."
                : undefined
          }
          onClick={onAddChapter}
        >
          장 추가
        </Button>
        {editable && atLimit && (
          <span className={s.limitNotice}>장은 99개까지 만들 수 있어요.</span>
        )}
        <Button variant="ghost" onClick={openProblems}>
          확인할 곳 {problems.length}
        </Button>
        <Button variant="ghost" onClick={tidy}>
          정돈
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
  const [deleting, setDeleting] = useState<string | null>(null);
  const [newStory, setNewStory] = useState<Target | null>(null);
  const [newMode, setNewMode] = useState<StoryMode>("scene");
  const [focusRequest, setFocusRequest] = useState<{ id: string; sequence: number } | null>(null);
  const [pendingProblems, setPendingProblems] = useState<Target | null>(null);
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
    setNewMode("scene");
    setNewStory(target);
  }, [loading, target.packId, target.scenarioId, target.createNew, draft, actors, actorsPack]);
  function createNewStory(): void {
    if (
      !newStory ||
      !draft ||
      newStory.packId !== target.packId ||
      newStory.scenarioId !== target.scenarioId
    )
      return;
    const first = actors.find((actor) => actor.presenceRole !== "npc");
    if (!first) return;
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
    const createdScenario =
      newMode === "proposal" ? changeStoryMode(scenario, "proposal") : scenario;
    const definition = {
      ...draft.definition,
      scenarios: [...draft.definition.scenarios, createdScenario],
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
    setNewStory(null);
  }
  const scenarios = draft?.definition.scenarios ?? [];
  const selected = scenarios.find((value) => value.id === target.scenarioId) ?? scenarios[0];
  const problems = useMemo(() => (selected ? findStoryProblems(selected) : []), [selected]);
  const graph = useMemo(
    () => (selected ? buildStoryGraph(selected, scenarios) : null),
    [selected, scenarios],
  );
  useLayoutEffect(() => {
    setFocusRequest(null);
    if (selected?.chapters?.length === 1) setPanel(`chapter:${selected.chapters[0].id}`);
    else setPanel(null);
  }, [target.packId, selected?.id]);
  useEffect(() => {
    if (
      !loading &&
      pendingProblems &&
      target.packId === pendingProblems.packId &&
      selected?.id === pendingProblems.scenarioId
    ) {
      setPanel("problems");
      setPendingProblems(null);
    }
  }, [loading, pendingProblems, target.packId, selected?.id]);
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
  function addChapter(ref?: StoryExitRef): string | undefined {
    if (!selected?.chapters || selected.chapters.length >= STORY_CHAPTER_LIMIT || lock.current)
      return;
    const id = crypto.randomUUID();
    const chapter = {
      id,
      title: "",
      next: "end",
      steps: [{ kind: "line" as const, persona: selected.centerId, expression: "평온", text: "" }],
    };
    let next = createStoryChapter(selected, chapter);
    if (ref) next = setStoryExit(next, ref, id);
    group.current = null;
    updateScenario(next);
    setPanel(`chapter:${id}`);
    return id;
  }
  function changeExit(ref: StoryExitRef, destination: string): void {
    if (!selected || !selected.chapters) return;
    group.current = null;
    updateScenario(setStoryExit(selected, ref, destination));
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
        const invalid = item.definition.scenarios.find((scenario) =>
          findStoryProblems(scenario).some((problem) => problem.blocking),
        );
        if (invalid) {
          closeGuard.keepEditing();
          setTarget({ packId, scenarioId: invalid.id });
          setPendingProblems({ packId, scenarioId: invalid.id });
          return false;
        }
      }
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
            <Button
              variant="ghost"
              disabled={
                loading ||
                busy ||
                !target.packId ||
                !draft ||
                !packs?.some((pack) => pack.id === target.packId)
              }
              onClick={() => {
                group.current = null;
                setPanel(null);
                setTarget({
                  packId: target.packId,
                  scenarioId: crypto.randomUUID(),
                  createNew: true,
                });
              }}
            >
              이야기 추가
            </Button>
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
              editable={selected.chapters != null}
              packId={target.packId}
              scenarioId={selected.id}
              problems={problems}
              onConnectExit={changeExit}
              onDisconnect={(ref) => changeExit(ref, "")}
              onCreateChapter={addChapter}
              onAddChapter={() => {
                addChapter();
              }}
              openProblems={() => setPanel("problems")}
              atLimit={(selected.chapters?.length ?? 0) >= STORY_CHAPTER_LIMIT}
              focusRequest={focusRequest}
            />
          </ReactFlowProvider>
          {panel === "problems" && (
            <aside className={s.problemsPanel} aria-label="확인할 곳">
              <div className={s.problemsHeader}>
                <strong>확인할 곳 {problems.length}</strong>
                <Button variant="ghost" onClick={() => setPanel(null)}>
                  닫기
                </Button>
              </div>
              <p>
                {problems.some((problem) => problem.blocking)
                  ? "고쳐야 저장할 수 있어요."
                  : "저장해도 쓰던 내용은 남아요. 고치면 목록에서 사라져요."}
              </p>
              <ul className={s.problemsList}>
                {problems.map((problem, index) => {
                  const chapter = selected.chapters?.find((item) => item.id === problem.chapterId);
                  const reason = {
                    "missing-exit": "이어질 곳 없음",
                    "missing-chapter": "없는 장으로 이어져요",
                    "empty-line": "빈 대사가 있어요",
                    unreachable: "어디서도 오지 못해요",
                    "unreachable-cycle": "시작 장에서 닿지 않는 순환이에요",
                    "missing-accept-keywords": "수락 표현이 없어서 이 갈래로 갈 수 없어요.",
                    "missing-decline-keywords": "거절 표현이 없어서 이 갈래로 갈 수 없어요.",
                    "invalid-reveal-affinity": "노출 친밀도는 0 이상 최소 친밀도 이하여야 해요.",
                  }[problem.kind];
                  const proposalTitles: Record<string, string> = {
                    intro: "제안",
                    accept: "수락",
                    decline: "거절",
                    ending: "마무리",
                    defer: "유보",
                  };
                  return (
                    <li key={`${problem.chapterId}:${problem.kind}:${index}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setPanel(
                            `${selected.chapters ? "chapter" : "proposal"}:${problem.chapterId}`,
                          );
                          setFocusRequest((current) => ({
                            id: problem.chapterId,
                            sequence: (current?.sequence ?? 0) + 1,
                          }));
                        }}
                      >
                        <strong>
                          {chapter?.title || proposalTitles[problem.chapterId] || "새 장"}
                        </strong>
                        <span>{reason}</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </aside>
          )}
          {panel?.startsWith("proposal:") && selected.chapters == null && (
            <ProposalStoryPanel
              key={`${selected.id}:${panel}`}
              scenario={selected}
              stage={panel.slice("proposal:".length) as ProposalStage}
              actors={actors}
              scenarios={scenarios}
              onChange={updateScenario}
              onClose={() => setPanel(null)}
            />
          )}
          {panel && panel !== "problems" && !panel.startsWith("proposal:") && (
            <StoryPanel
              key={`${selected.id}:${panel}`}
              scenario={selected}
              chapterId={panel === "settings" ? null : panel.replace(/^chapter:/, "")}
              actors={actors}
              onChange={updateScenario}
              onCreateChapter={(exit) => {
                if (panel.startsWith("chapter:"))
                  addChapter({ ...exit, chapterId: panel.slice(8) });
              }}
              onDeleteChapter={() => {
                if (panel.startsWith("chapter:")) setDeleting(panel.slice(8));
              }}
              onSetStart={() => {
                if (!panel.startsWith("chapter:")) return;
                group.current = null;
                updateScenario(setStoryStart(selected, panel.slice(8)));
              }}
              onClose={() => setPanel(null)}
            />
          )}
        </div>
      )}
      <Dialog
        isOpen={
          newStory !== null &&
          newStory.packId === target.packId &&
          newStory.scenarioId === target.scenarioId
        }
        title="어떤 이야기를 만들까요?"
        variant="confirm"
        onOpenChange={(open) => {
          if (!open) {
            setNewStory(null);
            setTarget((current) => ({ ...current, createNew: false }));
          }
        }}
        footer={
          <>
            <Button
              onClick={() => {
                setNewStory(null);
                setTarget((current) => ({ ...current, createNew: false }));
              }}
            >
              취소
            </Button>
            <Button onClick={createNewStory}>만들기</Button>
          </>
        }
      >
        <div className={modeStyles.choices}>
          <button
            type="button"
            className={modeStyles.choice}
            aria-pressed={newMode === "scene"}
            onClick={() => setNewMode("scene")}
          >
            <strong>장면형</strong>
            <span>장을 이어 가며 선택과 기다리기를 넣어요. 튜토리얼도 이 방식이에요.</span>
          </button>
          <button
            type="button"
            className={modeStyles.choice}
            aria-pressed={newMode === "proposal"}
            onClick={() => setNewMode("proposal")}
          >
            <strong>제안형</strong>
            <span>친구가 먼저 제안하고 수락·거절로 나뉘어요. 네 단계가 정해져 있어요.</span>
          </button>
        </div>
      </Dialog>
      <Dialog
        isOpen={deleting !== null}
        title={`${selected?.chapters?.find((chapter) => chapter.id === deleting)?.title || "새 장"} 장을 지울까요?`}
        variant="confirm"
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        footer={
          <>
            <Button onClick={() => setDeleting(null)}>계속 편집</Button>
            <Button
              onClick={() => {
                if (selected && deleting) {
                  group.current = null;
                  updateScenario(deleteStoryChapter(selected, deleting));
                  setPanel(null);
                }
                setDeleting(null);
              }}
            >
              장 지우기
            </Button>
          </>
        }
      >
        <p>
          여기로 이어지던 {selected && deleting ? incomingStoryExits(selected, deleting).length : 0}
          곳이 끊겨요. 되돌리기로 되살릴 수 있어요.
        </p>
        {selected?.chapters?.[0]?.id === deleting && <p>다음 장을 시작 장으로 삼아요.</p>}
      </Dialog>
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
