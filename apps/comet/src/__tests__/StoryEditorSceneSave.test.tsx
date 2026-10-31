import { afterEach, beforeEach, expect, it, vi } from "vitest";
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
  }: {
    children: React.ReactNode;
    nodes: { id: string; position: { x: number; y: number }; data: { item: { title: string } } }[];
    edges: { id: string; source: string }[];
    onNodeClick: (event: unknown, node: unknown) => void;
    onNodeDragStop: (event: unknown, node: unknown) => void;
    onEdgeClick: (event: unknown, edge: { id: string }) => void;
    onConnectStart: (event: unknown, params: { handleType: string }) => void;
    onConnectEnd: (
      event: { clientX: number; clientY: number },
      state: { fromHandle: { id: string } },
    ) => void;
  }) => {
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
function scenario(id: string): ScenarioDefinition {
  return {
    id,
    title: `${id} 이야기`,
    centerId: "a",
    participants: [],
    keywords: [],
    requiredFlags: [],
    minAffinity: 0,
    chapters: [{ id: `${id}-chapter`, title: `${id} 장`, steps: [] }],
    allowIncompleteRepeat: false,
    allowRepeat: false,
    completion: { setFlags: [], memoryTemplate: null },
  };
}
function pack(id: string): PackStorySnapshot {
  return {
    packId: id,
    baseline: "",
    sourceToLocal: {},
    definition: {
      worldRules: "",
      storyFlags: [],
      knowledge: [],
      scenarios: id === "a" ? [scenario("one"), scenario("two")] : [scenario("other")],
    },
  };
}
beforeEach(() => {
  vi.mocked(command).mockReset();
  localStorage.clear();
  windowMock.destroy.mockClear();
  eventMock.listener = undefined;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot") return PREVIEW_SNAPSHOT;
    if (name === "get_pack_story_definition") return pack((args as { packId: string }).packId);
    return null;
  });
});

afterEach(cleanup);

it("제안형을 확인 후 장면형으로 바꾸고 튜토리얼 장과 기다림을 저장한다", async () => {
  const saved = pack("a");
  const line = { persona: "a", expression: "평온", text: "등록 원문" };
  saved.baseline = "1";
  saved.definition.scenarios = [
    {
      ...scenario("one"),
      chapters: null,
      intro: [line],
      accept: [line],
      decline: [line],
      ending: [line],
    },
  ];
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot") return PREVIEW_SNAPSHOT;
    if (name === "get_pack_story_definition") return saved;
    if (name === "save_pack_story_definition")
      return {
        ...saved,
        baseline: "2",
        definition: (args as { definition: PackStorySnapshot["definition"] }).definition,
      };
    return null;
  });
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  fireEvent.click(await screen.findByText("제안", { selector: ".react-flow__node" }));
  expect(screen.getByLabelText("제안 1 대사")).toHaveProperty("value", "등록 원문");
  expect(screen.getByLabelText("시작 키워드 · 한 줄에 하나")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "이야기 설정" }));
  fireEvent.click(screen.getByRole("button", { name: "장을 이어 가는 이야기" }));
  expect(screen.getByRole("dialog", { name: "이야기 방식을 바꿀까요?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
  fireEvent.click(screen.getByText("제안", { selector: ".react-flow__node" }));
  expect(screen.getByLabelText("제안 1 대사")).toHaveProperty("value", "등록 원문");
  fireEvent.click(screen.getByRole("button", { name: "이야기 설정" }));
  fireEvent.click(screen.getByRole("button", { name: "장을 이어 가는 이야기" }));
  fireEvent.click(screen.getByRole("button", { name: "방식 바꾸기" }));
  expect(screen.queryByLabelText("수락 표현 · 한 줄에 하나")).toBeNull();
  expect(screen.queryByLabelText("노출 친밀도")).toBeNull();
  fireEvent.click(screen.getByText("새 장", { selector: ".react-flow__node" }));
  expect(screen.queryByLabelText("시작 키워드 · 한 줄에 하나")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "이야기 설정" }));
  fireEvent.change(screen.getByLabelText("쓰임"), { target: { value: "tutorial" } });
  fireEvent.click(screen.getByText("새 장", { selector: ".react-flow__node" }));
  fireEvent.change(screen.getByLabelText("장 제목"), { target: { value: "첫 만남" } });
  fireEvent.change(screen.getByLabelText("단계 1 대사"), { target: { value: "안녕" } });
  fireEvent.click(screen.getByRole("button", { name: "단계 2 앞에 추가" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "기다리기" }));
  fireEvent.change(screen.getByLabelText("단계 2 기다릴 이벤트"), {
    target: { value: "widget.saved" },
  });
  fireEvent.click(screen.getByText("시간이 지나면", { selector: "summary" }));
  fireEvent.click(screen.getByRole("button", { name: "시간이 지나면 동작 추가" }));
  fireEvent.change(screen.getByLabelText("시간이 지나면 이어질 장"), { target: { value: "end" } });
  fireEvent.click(screen.getByRole("button", { name: "장 추가" }));
  fireEvent.change(screen.getByLabelText("장 제목"), { target: { value: "두 번째 장" } });
  fireEvent.change(screen.getByLabelText("단계 1 대사"), { target: { value: "다음 대사" } });
  fireEvent.click(screen.getByText("첫 만남", { selector: ".react-flow__node" }));
  const chapterTarget = screen.getByLabelText<HTMLSelectElement>("다음 장");
  const secondId = within(chapterTarget).getByRole<HTMLOptionElement>("option", {
    name: "두 번째 장",
  }).value;
  fireEvent.change(chapterTarget, { target: { value: secondId } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "save_pack_story_definition",
      expect.objectContaining({ packId: "a", expectedBaseline: "1" }),
    ),
  );
  const call = vi
    .mocked(command)
    .mock.calls.find(([name]) => name === "save_pack_story_definition");
  if (!call) throw new Error("저장 요청이 없어요.");
  const scene = (call[1] as { definition: PackStorySnapshot["definition"] }).definition
    .scenarios[0];
  expect(scene.purpose).toBe("tutorial");
  expect(scene.intro).toEqual([]);
  expect(scene.chapters).toHaveLength(2);
  if (!scene.chapters || scene.chapters.length !== 2) throw new Error("장이 두 개여야 해요.");
  expect(scene.chapters[0]).toMatchObject({
    title: "첫 만남",
    next: scene.chapters[1].id,
    steps: [
      { kind: "line", text: "안녕" },
      {
        kind: "wait",
        event: "widget.saved",
        widget: "memo",
        onTimeout: { then: "end", steps: [{ kind: "action", do: "widget.open", widget: "memo" }] },
      },
    ],
  });
  expect(scene.chapters[1]).toMatchObject({
    title: "두 번째 장",
    steps: [{ kind: "line", text: "다음 대사" }],
  });
  await waitFor(() => expect(screen.queryByText("바뀐 내용")).toBeNull());
  expect(screen.getByLabelText("장 제목")).toHaveProperty("value", "첫 만남");
  expect(screen.getByLabelText("단계 1 대사")).toHaveProperty("value", "안녕");
});

it.each(["name", "text"] as const)(
  "%s 입력으로 바꾸고 이름 대사 필드를 보존하거나 제거해 저장한다",
  async (input) => {
    const saved = pack("a");
    const ask = {
      kind: "ask" as const,
      id: "name",
      persona: "a",
      expression: "평온",
      prompt: "이름이 뭐예요?",
      input: "name" as const,
      known: "이미 알고 있어요.",
      saved: { expression: "평온", text: "반가워요!" },
    };
    saved.baseline = "1";
    saved.definition.scenarios = [
      {
        ...scenario("one"),
        chapters: [{ id: "first", title: "첫 만남", next: "end", steps: [ask] }],
      },
    ];
    vi.mocked(command).mockImplementation(async (name, args) => {
      if (name === "get_character_packs") return packs;
      if (name === "get_snapshot") return PREVIEW_SNAPSHOT;
      if (name === "get_pack_story_definition") return saved;
      if (name === "save_pack_story_definition")
        return {
          ...saved,
          definition: (args as { definition: PackStorySnapshot["definition"] }).definition,
        };
      return null;
    });
    render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
    fireEvent.click(await screen.findByRole("button", { name: "펼치기" }));
    fireEvent.change(screen.getByLabelText("단계 1 입력 종류"), { target: { value: input } });
    fireEvent.change(screen.getByLabelText("단계 1 질문"), { target: { value: "고친 질문" } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("save_pack_story_definition", expect.anything()),
    );
    const call = vi
      .mocked(command)
      .mock.calls.find(([name]) => name === "save_pack_story_definition");
    const args = call?.[1] as { definition: PackStorySnapshot["definition"] };
    expect(args.definition.scenarios[0].chapters?.[0].steps[0]).toEqual({
      ...ask,
      prompt: "고친 질문",
      input,
      known: input === "name" ? ask.known : null,
      saved: input === "name" ? ask.saved : undefined,
    });
  },
);

it("기존 튜토리얼 장을 열어 대사를 보존하며 저장한다", async () => {
  const saved = pack("a");
  saved.baseline = "1";
  saved.definition.scenarios = [
    {
      ...scenario("one"),
      purpose: "tutorial",
      chapters: [
        {
          id: "first",
          title: "첫 만남",
          next: "end",
          steps: [{ kind: "line", persona: "a", expression: "평온", text: "안녕" }],
        },
      ],
    },
  ];
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot") return PREVIEW_SNAPSHOT;
    if (name === "get_pack_story_definition") return saved;
    if (name === "save_pack_story_definition")
      return {
        ...saved,
        definition: (args as { definition: PackStorySnapshot["definition"] }).definition,
      };
    return null;
  });
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  expect(await screen.findByLabelText("단계 1 대사")).toHaveProperty("value", "안녕");
  fireEvent.click(screen.getByRole("button", { name: "이야기 설정" }));
  fireEvent.change(screen.getByLabelText("이야기 제목"), { target: { value: "고친 제목" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_pack_story_definition", {
      packId: "a",
      expectedBaseline: "1",
      definition: {
        ...saved.definition,
        scenarios: [{ ...saved.definition.scenarios[0], title: "고친 제목" }],
      },
    }),
  );
});

it("저장 충돌 후 대사 원문과 기준을 보존해 재시도하고 취소하면 저장된 원문을 되돌린다", async () => {
  const saved = pack("a");
  const line = { persona: "a", expression: "평온", text: "등록 원문" };
  saved.baseline = "1";
  saved.definition.scenarios = [
    {
      ...scenario("one"),
      chapters: null,
      intro: [line],
      accept: [line],
      decline: [line],
      ending: [line],
      acceptKeywords: ["좋아"],
      declineKeywords: ["싫어"],
    },
  ];
  let attempts = 0;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot") return PREVIEW_SNAPSHOT;
    if (name === "get_pack_story_definition") return saved;
    if (name === "save_pack_story_definition") {
      attempts += 1;
      if (attempts === 1) throw new Error("저장 충돌");
      return {
        ...saved,
        baseline: "2",
        definition: (args as { definition: PackStorySnapshot["definition"] }).definition,
      };
    }
    return null;
  });
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  fireEvent.click(await screen.findByText("제안", { selector: ".react-flow__node" }));
  const raw = "  별을 보고\n\n잠깐 기다리자.  ";
  fireEvent.change(screen.getByLabelText("제안 1 대사"), { target: { value: raw } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect((await screen.findByRole("alert")).textContent).toContain("저장 충돌");
  expect(screen.getByLabelText("제안 1 대사")).toHaveProperty("value", raw);
  const expected = {
    ...saved.definition,
    scenarios: [{ ...saved.definition.scenarios[0], intro: [{ ...line, text: raw }] }],
  };
  expect(command).toHaveBeenLastCalledWith("save_pack_story_definition", {
    packId: "a",
    definition: expected,
    expectedBaseline: "1",
  });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(screen.queryByText("바뀐 내용")).toBeNull());
  const saves = vi
    .mocked(command)
    .mock.calls.filter(([name]) => name === "save_pack_story_definition");
  expect(saves).toHaveLength(2);
  expect(saves[1][1]).toEqual(saves[0][1]);
  fireEvent.change(screen.getByLabelText("제안 1 대사"), { target: { value: "미저장" } });
  fireEvent.click(screen.getByRole("button", { name: "취소" }));
  expect(screen.getByLabelText("제안 1 대사")).toHaveProperty("value", raw);
});

it("팩을 바꾸면 방식 전환 확인을 닫고 새 팩의 제안 원문을 유지한다", async () => {
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot") return PREVIEW_SNAPSHOT;
    if (name === "get_pack_story_definition") {
      const id = (args as { packId: string }).packId;
      const saved = pack(id);
      const line = { persona: id, expression: "평온", text: `${id} 등록 원문` };
      saved.definition.scenarios = [
        {
          ...scenario(id === "a" ? "one" : "other"),
          chapters: null,
          intro: [line],
          accept: [line],
          decline: [line],
          ending: [line],
        },
      ];
      return saved;
    }
    return null;
  });
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  fireEvent.click(await screen.findByRole("button", { name: "이야기 설정" }));
  fireEvent.click(screen.getByRole("button", { name: "장을 이어 가는 이야기" }));
  expect(screen.getByRole("dialog", { name: "이야기 방식을 바꿀까요?" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("팩 선택"), { target: { value: "b" } });
  await waitFor(() =>
    expect(screen.queryByRole("dialog", { name: "이야기 방식을 바꿀까요?" })).toBeNull(),
  );
  await screen.findByText("제안", { selector: ".react-flow__node" });
  fireEvent.click(screen.getByRole("button", { name: "이야기 설정" }));
  expect(screen.getByLabelText("이야기 제목")).toHaveProperty("value", "other 이야기");
  fireEvent.click(screen.getByText("제안", { selector: ".react-flow__node" }));
  expect(screen.getByLabelText("제안 1 대사")).toHaveProperty("value", "b 등록 원문");
});
