import { afterEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import StoryEditorWindow from "../components/StoryEditor/StoryEditorWindow";
import { command, PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";
import type { InstalledCharacterPack, PackStorySnapshot, ScenarioDefinition } from "../types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
vi.mock("../components/characterAnimation", async (load) => ({
  ...(await load<typeof import("../components/characterAnimation")>()),
  animationAssetUrl: (characterId: string) => `data:image/png;base64,${characterId}-saved-bytes`,
}));
const eventMock = vi.hoisted(() => ({
  listener: undefined as
    | ((event: { payload: { packId: string; scenarioId: string; createNew?: boolean } }) => void)
    | undefined,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockImplementation(async (_name, listener) => {
    eventMock.listener = listener;
    return () => {};
  }),
}));
const windowMock = vi.hoisted(() => ({
  destroy: vi.fn().mockResolvedValue(undefined),
  onCloseRequested: vi.fn().mockResolvedValue(() => {}),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => windowMock }));
const flowMock = vi.hoisted(() => ({
  drag: undefined as undefined | ((id: string, position: { x: number; y: number }) => void),
  selectEdge: undefined as undefined | ((id: string) => void),
  connect: undefined as undefined | ((id: string, target: Element) => void),
  edgeId: undefined as string | undefined,
  nodes: [] as { id: string; data: { item: { title: string }; trialState: string | null } }[],
  edges: [] as { id: string; style: { strokeWidth: number } }[],
  locked: false,
}));
vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ReactFlow: ({
    children,
    nodes,
    edges,
    onNodeClick,
    onNodeDragStop,
    onEdgeClick,
    onConnectStart,
    onConnectEnd,
    nodesConnectable,
    nodesDraggable,
  }: {
    children: React.ReactNode;
    nodesConnectable: boolean;
    nodesDraggable: boolean;
    nodes: {
      id: string;
      position: { x: number; y: number };
      data: { item: { title: string }; trialState: string | null };
    }[];
    edges: { id: string; source: string; style: { strokeWidth: number } }[];
    onNodeClick: (event: unknown, node: unknown) => void;
    onNodeDragStop: (event: unknown, node: unknown) => void;
    onEdgeClick: (event: unknown, edge: { id: string }) => void;
    onConnectStart: (event: unknown, params: { handleType: string }) => void;
    onConnectEnd: (
      event: { clientX: number; clientY: number },
      state: { fromHandle: { id: string } },
    ) => void;
  }) => {
    flowMock.nodes = nodes;
    flowMock.edges = edges;
    flowMock.locked = !nodesConnectable && !nodesDraggable;
    flowMock.edgeId = edges.find((edge) => edge.source === "chapter:first")?.id;
    flowMock.drag = (id, position) => {
      const node = nodes.find((item) => item.id === id);
      if (node) onNodeDragStop(null, { ...node, position });
    };
    flowMock.selectEdge = (id) => {
      const edge = edges.find((item) => item.id === id);
      if (edge) onEdgeClick(null, edge);
    };
    flowMock.connect = (id, target) => {
      const original = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
      Object.defineProperty(document, "elementFromPoint", {
        configurable: true,
        value: () => target,
      });
      try {
        onConnectStart(null, { handleType: "source" });
        onConnectEnd({ clientX: 250, clientY: 180 }, { fromHandle: { id } });
      } finally {
        if (original) Object.defineProperty(document, "elementFromPoint", original);
        else Reflect.deleteProperty(document, "elementFromPoint");
      }
    };
    return (
      <div>
        {nodes.map((node) => (
          <span
            key={node.id}
            className="react-flow__node"
            data-id={node.id}
            onClick={() => onNodeClick(null, node)}
          >
            {node.data.item.title}
          </span>
        ))}
        {children}
      </div>
    );
  },
  Background: () => null,
  MiniMap: () => null,
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
  useNodesState: (nodes: unknown[]) => {
    const [current, setCurrent] = useState(nodes);
    return [current, setCurrent, vi.fn()];
  },
  useReactFlow: () => ({
    fitView: vi.fn(),
    zoomIn: vi.fn(),
    zoomOut: vi.fn(),
    flowToScreenPosition: (position: unknown) => position,
    getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    setViewport: vi.fn(),
    setCenter: vi.fn(),
    screenToFlowPosition: (position: unknown) => position,
  }),
}));
const packs = [
  { id: "a", name: "팩 A" },
  { id: "b", name: "팩 B" },
] as InstalledCharacterPack[];
const actor = { ...PREVIEW_SNAPSHOT.characters.installed[0], packId: "a" };
const story: ScenarioDefinition = {
  id: "story",
  title: "이야기",
  centerId: actor.definition.sourceId,
  participants: [actor.definition.sourceId],
  keywords: [],
  requiredFlags: [],
  minAffinity: 0,
  chapters: [
    {
      id: "first",
      title: "첫 장",
      next: "second",
      steps: [
        {
          kind: "choice",
          persona: actor.definition.sourceId,
          expression: "평온",
          prompt: "어디로?",
          options: [
            { id: "a", label: "하나", goto: "second" },
            { id: "b", label: "둘", goto: "second" },
          ],
        },
      ],
    },
    { id: "second", title: "둘째 장", steps: [] },
  ],
  allowIncompleteRepeat: false,
  allowRepeat: false,
  completion: { setFlags: [], memoryTemplate: null },
};
const snapshot: PackStorySnapshot = {
  packId: "a",
  baseline: "1",
  sourceToLocal: {},
  definition: { worldRules: "", storyFlags: [], knowledge: [], scenarios: [story] },
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("시험 중 편집을 잠그고 지난 선택지만 표시하며 장을 누르면 편집으로 돌아간다", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot")
      return {
        ...PREVIEW_SNAPSHOT,
        characters: { ...PREVIEW_SNAPSHOT.characters, installed: [actor] },
      };
    if (name === "get_pack_story_definition") return snapshot;
    if (name === "trial_pack_authoring")
      return {
        blockedReasons: [],
        steps: [],
        scene: {
          status: "wait",
          chapterId: "second",
          prompt: null,
          options: [],
          history: [{ persona: actor.id, text: "대사" }],
          chapterPath: ["first", "second"],
          exits: [{ chapterId: "first", kind: "choice", stepIndex: 0, optionIndex: 1 }],
        },
      };
    return null;
  });
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="story" />);
  fireEvent.click(await screen.findByRole("button", { name: "시험" }));
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "장 추가" }).disabled).toBe(true);
  expect(flowMock.locked).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "처음부터 시험" }));
  await screen.findByText(/대사/);
  await waitFor(() => {
    expect(flowMock.nodes.find((node) => node.id === "chapter:first")?.data.trialState).toBe(
      "visited",
    );
    expect(flowMock.nodes.find((node) => node.id === "chapter:second")?.data.trialState).toBe(
      "current",
    );
  });
  expect(
    flowMock.edges.find((edge) => edge.id === "exit:first:choice:0:0")?.style.strokeWidth,
  ).toBe(1.5);
  expect(
    flowMock.edges.find((edge) => edge.id === "exit:first:choice:0:1")?.style.strokeWidth,
  ).toBe(3);
  fireEvent.click(screen.getByText("첫 장"));
  expect(screen.queryByRole("complementary", { name: "시험" })).toBeNull();
  expect(await screen.findByLabelText("장 제목")).toBeTruthy();
});

it("replays saved animation for each friend in a story editor trial", async () => {
  const urls: string[] = [];
  const clip = {
    id: "saved-clip",
    name: "저장된 동작",
    fps: 8,
    frames: [{ assetId: "saved-asset", x: 0, y: 0, width: 16, height: 16 }],
  };
  const savedActors = [
    actor,
    {
      ...actor,
      id: "friend",
      definition: { ...actor.definition, sourceId: "friend-source", name: "친구" },
    },
  ].map((value) => ({
    ...value,
    definition: { ...value.definition, animation: { clips: [clip], bindings: {}, overrides: {} } },
  }));
  const proposal = {
    ...story,
    chapters: undefined,
    participants: savedActors.map((value) => value.definition.sourceId),
    keywords: ["시작"],
  };
  const proposalSnapshot = {
    ...snapshot,
    definition: { ...snapshot.definition, scenarios: [proposal] },
  };
  const state = {
    stage: null,
    ready: true,
    presentIds: savedActors.map((value) => value.id),
    flags: [],
    turn: 0,
    waitTurn: 0,
    pendingNextScenarioId: null,
  };
  const lines = savedActors.map((value, index) => ({
    persona: value.id,
    expression: "평온",
    text: `  ${index}번째 저장된 대사\n원문  `,
    motion: { mode: "clip" as const, clipId: clip.id, repeat: false, intervalMs: 0 },
  }));
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal(
    "Image",
    vi.fn(function image() {
      const element = document.createElement("img");
      Object.defineProperties(element, {
        naturalWidth: { value: 16 },
        naturalHeight: { value: 16 },
        src: {
          set(value: string) {
            urls.push(value);
            if (value) queueMicrotask(() => element.dispatchEvent(new Event("load")));
          },
        },
      });
      return element;
    }),
  );
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot")
      return {
        ...PREVIEW_SNAPSHOT,
        characters: { ...PREVIEW_SNAPSHOT.characters, installed: savedActors },
      };
    if (name === "get_pack_story_definition") return proposalSnapshot;
    if (name === "trial_pack_authoring")
      return {
        blockedReasons: [],
        steps: [
          {
            input: "시작",
            source: "registered",
            stage: "intro",
            conditions: [],
            blockedReasons: [],
            beforeState: state,
            afterState: { ...state, stage: "intro" },
            lines,
            lineDurationsMs: [120, 180],
            plannedEffects: { setFlags: [], memoryTemplate: null },
            modelRequired: false,
            modelNotRunReason: null,
            presentationAssumed: true,
          },
        ],
      };
    return null;
  });

  render(<StoryEditorWindow initialPackId="a" initialScenarioId="story" />);
  fireEvent.click(await screen.findByRole("button", { name: "시험" }));
  fireEvent.click(screen.getByRole("button", { name: "처음부터 시험" }));
  const previewElement = await screen.findByLabelText("선택한 대사 미리보기");
  const preview = within(previewElement);
  await waitFor(() =>
    expect(urls).toContain(`data:image/png;base64,${savedActors[0].id}-saved-bytes`),
  );
  expect(previewElement.textContent).toContain(lines[0].text);
  fireEvent.click(preview.getByRole("button", { name: "미리보기" }));
  expect(await preview.findByLabelText("대사 동작 미리보기")).toBeTruthy();
  await waitFor(() => expect(previewElement.textContent).toContain(lines[1].text));
  await waitFor(() =>
    expect(urls).toContain(`data:image/png;base64,${savedActors[1].id}-saved-bytes`),
  );
  await waitFor(() =>
    expect(preview.getByRole("button", { name: "정지" })).toHaveProperty("disabled", true),
  );
  expect(urls.filter(Boolean).every((url) => url.endsWith("-saved-bytes"))).toBe(true);
  expect(command).toHaveBeenCalledWith(
    "trial_pack_authoring",
    expect.objectContaining({
      request: expect.objectContaining({
        actors: savedActors.map((value) => ({
          id: value.id,
          packId: value.packId,
          definition: value.definition,
        })),
      }),
    }),
  );
}, 15000);

it("replays saved animation for newly reached scene dialogue after a timeout", async () => {
  const urls: string[] = [];
  const clip = {
    id: "saved-clip",
    name: "저장된 동작",
    fps: 8,
    frames: [{ assetId: "saved-asset", x: 0, y: 0, width: 16, height: 16 }],
  };
  const savedActor = {
    ...actor,
    definition: { ...actor.definition, animation: { clips: [clip], bindings: {}, overrides: {} } },
  };
  const line = (text: string) => ({
    persona: savedActor.id,
    expression: "평온",
    text,
    motion: { mode: "clip" as const, clipId: clip.id, repeat: false, intervalMs: 0 },
  });
  const first = line("기다리기 전 대사");
  const timeout = line("시간 초과 대사");
  const history = [{ persona: savedActor.id, text: first.text, line: first, durationMs: 100 }];
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal(
    "Image",
    vi.fn(function image() {
      const element = document.createElement("img");
      Object.defineProperties(element, {
        naturalWidth: { value: 16 },
        naturalHeight: { value: 16 },
        src: {
          set(value: string) {
            urls.push(value);
            if (value) queueMicrotask(() => element.dispatchEvent(new Event("load")));
          },
        },
      });
      return element;
    }),
  );
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot")
      return { ...PREVIEW_SNAPSHOT, characters: { ...PREVIEW_SNAPSHOT.characters, installed: [savedActor] } };
    if (name === "get_pack_story_definition") return snapshot;
    if (name === "trial_pack_authoring") {
      const responses = (args as { request: { sceneResponses: unknown[] } }).request.sceneResponses;
      return {
        blockedReasons: [],
        steps: [],
        scene: {
          status: responses.length ? "completed" : "wait",
          chapterId: responses.length ? null : "first",
          prompt: null,
          options: [],
          history: responses.length
            ? [...history, { persona: null, text: "(시간 초과)" }, { persona: savedActor.id, text: timeout.text, line: timeout, durationMs: 100 }]
            : history,
        },
      };
    }
    return null;
  });

  render(<StoryEditorWindow initialPackId="a" initialScenarioId="story" />);
  fireEvent.click(await screen.findByRole("button", { name: "시험" }));
  fireEvent.click(screen.getByRole("button", { name: "처음부터 시험" }));
  let previewElement = await screen.findByLabelText("선택한 대사 미리보기");
  expect(previewElement.textContent).toContain(first.text);
  fireEvent.click(screen.getByRole("button", { name: "시간 초과" }));
  await waitFor(() =>
    expect(screen.getByLabelText("선택한 대사 미리보기").textContent).toContain(timeout.text),
  );
  previewElement = screen.getByLabelText("선택한 대사 미리보기");
  expect(previewElement.textContent).not.toContain(first.text);
  fireEvent.click(within(previewElement).getByRole("button", { name: "미리보기" }));
  expect(await within(previewElement).findByLabelText("대사 동작 미리보기")).toBeTruthy();
  await waitFor(() => expect(urls).toContain(`data:image/png;base64,${savedActor.id}-saved-bytes`));
  expect(urls.filter(Boolean).every((url) => url.endsWith("-saved-bytes"))).toBe(true);
});
