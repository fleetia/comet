import { useCallback, useEffect, useMemo, useState, type JSX } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button, CharacterArtwork, Select } from "@comet/ui";
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
  Snapshot,
} from "../../types";
import { WindowHeader } from "../WindowHeader/WindowHeader";
import {
  buildStoryGraph,
  layoutStoryGraph,
  type StoryGraph,
  type StoryGraphEdge,
  type StoryGraphNode,
} from "./storyGraph";
import * as s from "./storyEditor.css";

type Target = { packId: string; scenarioId: string };
type CardData = Record<string, unknown> & {
  item: StoryGraphNode;
  exits: StoryGraphEdge[];
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
                  <Handle
                    id={exit.id}
                    type="source"
                    position={Position.Right}
                    className={exit.kind === "choice" ? `${s.handle} ${s.choiceHandle}` : s.handle}
                  />
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
}: {
  graph: StoryGraph;
  actors: CharacterDefinition[];
  openStory: (id: string) => void;
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
          exits: graph.edges.filter((edge) => edge.source === item.id),
          actors,
          openStory,
        },
      })),
    [graph, positions, actors, openStory],
  );
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
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
  const { fitView, zoomIn, zoomOut } = useReactFlow();
  const [zoom, setZoom] = useState(100);
  const startPosition = graph.startId ? positions[graph.startId] : undefined;
  return (
    <div className={s.canvas}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        nodesConnectable={false}
        elementsSelectable={false}
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
  const [story, setStory] = useState<PackStorySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    let received = false;
    let unlisten: (() => void) | undefined;
    void listen<Target>(
      "open-story-editor",
      ({ payload }) => {
        received = true;
        if (active) setTarget(payload);
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
        if (active && !received && current) setTarget(current);
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
    setStory(null);
    void Promise.all([
      command<InstalledCharacterPack[]>("get_character_packs"),
      command<Snapshot>("get_snapshot"),
    ])
      .then(([available, snapshot]) => {
        if (!active) return;
        setPacks(available);
        setActors(
          snapshot.characters.installed
            .filter((actor) => actor.packId === target.packId)
            .map((actor) => actor.definition),
        );
        if (!target.packId) {
          setLoading(false);
          return;
        }
        return command<PackStorySnapshot>("get_pack_story_definition", {
          packId: target.packId,
        }).then((value) => {
          if (active) {
            setStory(value);
            setLoading(false);
          }
        });
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
  const scenarios = story?.definition.scenarios ?? [];
  const selected = scenarios.find((value) => value.id === target.scenarioId) ?? scenarios[0];
  const graph = useMemo(
    () => (selected ? buildStoryGraph(selected, scenarios) : null),
    [selected, scenarios],
  );
  const openStory = useCallback(
    (scenarioId: string) => setTarget((current) => ({ ...current, scenarioId })),
    [],
  );
  return (
    <main className={s.window}>
      <WindowHeader
        label="창 닫기"
        nativeControls
        className={s.header}
        actions={
          <div className={s.selectors}>
            <Select
              aria-label="팩 선택"
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
              disabled={!selected}
              onChange={(event) => openStory(event.target.value)}
            >
              {scenarios.map((scenario) => (
                <option key={scenario.id} value={scenario.id}>
                  {scenario.title}
                </option>
              ))}
            </Select>
          </div>
        }
      >
        <span className={s.windowTitle}>장면 편집기</span>
      </WindowHeader>
      {loading ? (
        <div className={s.canvas}>
          <div className={s.state} role="status">
            이야기를 불러오는 중이에요.
          </div>
        </div>
      ) : error ? (
        <div className={s.canvas}>
          <div className={s.state}>
            <p role="alert">이야기를 불러오지 못했어요. {error}</p>
            <Button onClick={() => setRevision((value) => value + 1)}>다시 불러오기</Button>
          </div>
        </div>
      ) : !graph ? (
        <div className={s.canvas}>
          <div className={s.state}>이야기가 없어요.</div>
        </div>
      ) : (
        <ReactFlowProvider key={`${target.packId}:${selected?.id}`}>
          <StoryCanvas graph={graph} actors={actors} openStory={openStory} />
        </ReactFlowProvider>
      )}
    </main>
  );
}
