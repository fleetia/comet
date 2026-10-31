import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

it("새 이야기 이벤트는 첫 대사에 초점을 둔 초안을 한 번만 만들고 저장 전에는 서버에 쓰지 않는다", async () => {
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot") {
      return {
        ...PREVIEW_SNAPSHOT,
        characters: {
          ...PREVIEW_SNAPSHOT.characters,
          installed: PREVIEW_SNAPSHOT.characters.installed.map((actor) => ({
            ...actor,
            packId: "a",
          })),
        },
      };
    }
    if (name === "get_pack_story_definition") return pack("a");
    if (name === "save_pack_story_definition") {
      return {
        ...pack("a"),
        definition: (args as { definition: PackStorySnapshot["definition"] }).definition,
      };
    }
    return null;
  });
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  await waitFor(() => expect(eventMock.listener).toBeDefined());
  const payload = { packId: "a", scenarioId: "new-story", createNew: true };
  act(() => eventMock.listener?.({ payload }));
  const line = await screen.findByLabelText<HTMLTextAreaElement>("단계 1 대사");
  expect(line.value).toBe("");
  expect(document.activeElement).toBe(line);
  expect(screen.getByLabelText<HTMLInputElement>("장 제목").value).toBe("");
  expect(screen.getByText("바뀐 내용")).toBeTruthy();
  expect(command).not.toHaveBeenCalledWith("save_pack_story_definition", expect.anything());
  expect(
    screen.getAllByRole<HTMLOptionElement>("option").filter((item) => item.value === "new-story"),
  ).toHaveLength(1);

  act(() => eventMock.listener?.({ payload }));
  expect(
    screen.getAllByRole<HTMLOptionElement>("option").filter((item) => item.value === "new-story"),
  ).toHaveLength(1);
  fireEvent.keyDown(line, { key: "z", metaKey: true });
  expect(
    screen.queryAllByRole<HTMLOptionElement>("option").filter((item) => item.value === "new-story"),
  ).toHaveLength(0);
  act(() => eventMock.listener?.({ payload }));
  expect(
    screen.queryAllByRole<HTMLOptionElement>("option").filter((item) => item.value === "new-story"),
  ).toHaveLength(0);
  fireEvent.keyDown(document, { key: "z", metaKey: true, shiftKey: true });
  expect(
    screen.getAllByRole<HTMLOptionElement>("option").filter((item) => item.value === "new-story"),
  ).toHaveLength(1);
  expect(command).not.toHaveBeenCalledWith("save_pack_story_definition", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(await screen.findByRole("complementary", { name: "확인할 곳" })).toBeTruthy();
  expect(command).not.toHaveBeenCalledWith("save_pack_story_definition", expect.anything());
  fireEvent.click(screen.getByText("빈 대사가 있어요"));
  fireEvent.change(screen.getByLabelText("단계 1 대사"), { target: { value: "안녕" } });
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "save_pack_story_definition",
      expect.objectContaining({
        definition: expect.objectContaining({
          scenarios: expect.arrayContaining([
            expect.objectContaining({
              id: "new-story",
              chapters: [
                expect.objectContaining({
                  next: "end",
                  steps: [expect.objectContaining({ kind: "line", text: "안녕" })],
                }),
              ],
            }),
          ]),
        }),
      }),
    ),
  );
});

async function editStoryTitle(title: string): Promise<HTMLInputElement> {
  fireEvent.click(await screen.findByRole("button", { name: "이야기 설정" }));
  const input = screen.getByLabelText<HTMLInputElement>("이야기 제목");
  input.focus();
  fireEvent.change(input, { target: { value: title } });
  return input;
}

it("저장할 때 baseline과 명시된 다음 장을 보내고 성공하면 변경 표시를 지운다", async () => {
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot") return PREVIEW_SNAPSHOT;
    if (name === "get_pack_story_definition") return { ...pack("a"), baseline: "기준" };
    if (name === "save_pack_story_definition") {
      const value = args as { packId: string; definition: PackStorySnapshot["definition"] };
      return { ...pack(value.packId), baseline: "새 기준", definition: value.definition };
    }
    return null;
  });
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  await editStoryTitle("바꾼 이야기");
  expect(screen.getByText("바뀐 내용")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_pack_story_definition", {
      packId: "a",
      expectedBaseline: "기준",
      definition: expect.objectContaining({
        scenarios: expect.arrayContaining([
          expect.objectContaining({
            id: "one",
            title: "바꾼 이야기",
            chapters: [expect.objectContaining({ next: "end" })],
          }),
        ]),
      }),
    }),
  );
  await waitFor(() => expect(screen.queryByText("바뀐 내용")).toBeNull());
});

it("충돌을 포함한 저장 실패에서 초안과 baseline을 보존한다", async () => {
  let reads = 0;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot") return PREVIEW_SNAPSHOT;
    if (name === "get_pack_story_definition") {
      reads += 1;
      const current = pack("a");
      return reads === 1
        ? { ...current, baseline: "기존 기준" }
        : {
            ...current,
            baseline: "새 기준",
            definition: {
              ...current.definition,
              scenarios: [{ ...scenario("one"), title: "다른 창의 이야기" }],
            },
          };
    }
    if (name === "save_pack_story_definition") throw new Error("다른 창에서 변경되었어요");
    return null;
  });
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  const title = await editStoryTitle("보존할 초안");
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect((await screen.findByRole("alert")).textContent).toContain("다른 창에서 변경되었어요");
  expect(title.value).toBe("보존할 초안");
  expect(screen.getByText("바뀐 내용")).toBeTruthy();
  expect(command).toHaveBeenCalledWith(
    "save_pack_story_definition",
    expect.objectContaining({ expectedBaseline: "기존 기준" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "최신 내용 확인" }));
  const dialog = await screen.findByRole("dialog", { name: "저장된 최신 내용" });
  expect(within(dialog).getByText("다른 창의 이야기")).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "초안 계속 편집" }));
  expect(title.value).toBe("보존할 초안");
});

it("다른 이야기와 팩을 방문해도 각 초안을 유지한다", async () => {
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  await editStoryTitle("첫 초안");
  fireEvent.change(screen.getByLabelText("이야기 선택"), { target: { value: "two" } });
  await editStoryTitle("둘째 초안");
  fireEvent.change(screen.getByLabelText("팩 선택"), { target: { value: "b" } });
  await editStoryTitle("다른 팩 초안");
  fireEvent.change(screen.getByLabelText("팩 선택"), { target: { value: "a" } });
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLSelectElement>("이야기 선택").value).toBe("one"),
  );
  fireEvent.click(screen.getByRole("button", { name: "이야기 설정" }));
  expect(screen.getByLabelText<HTMLInputElement>("이야기 제목").value).toBe("첫 초안");
  fireEvent.change(screen.getByLabelText("이야기 선택"), { target: { value: "two" } });
  fireEvent.click(screen.getByRole("button", { name: "이야기 설정" }));
  expect(screen.getByLabelText<HTMLInputElement>("이야기 제목").value).toBe("둘째 초안");
  fireEvent.change(screen.getByLabelText("팩 선택"), { target: { value: "b" } });
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLSelectElement>("이야기 선택").value).toBe("other"),
  );
  fireEvent.click(screen.getByRole("button", { name: "이야기 설정" }));
  expect(screen.getByLabelText<HTMLInputElement>("이야기 제목").value).toBe("다른 팩 초안");
});

it("팩을 넘나든 변경을 창 전체 순서대로 되돌리고 다시 실행한다", async () => {
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  await editStoryTitle("팩 A 수정");
  fireEvent.change(screen.getByLabelText("팩 선택"), { target: { value: "b" } });
  const titleB = await editStoryTitle("팩 B 수정");
  fireEvent.keyDown(titleB, { key: "z", metaKey: true });
  expect(titleB.value).toBe("other 이야기");
  fireEvent.keyDown(titleB, { key: "z", metaKey: true });
  expect(titleB.value).toBe("other 이야기");
  fireEvent.change(screen.getByLabelText("팩 선택"), { target: { value: "a" } });
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLSelectElement>("이야기 선택").value).toBe("one"),
  );
  fireEvent.click(screen.getByRole("button", { name: "이야기 설정" }));
  const titleA = screen.getByLabelText<HTMLInputElement>("이야기 제목");
  expect(titleA.value).toBe("one 이야기");
  fireEvent.keyDown(titleA, { key: "z", metaKey: true, shiftKey: true });
  expect(titleA.value).toBe("팩 A 수정");
  fireEvent.keyDown(titleA, { key: "z", metaKey: true, shiftKey: true });
  expect(titleA.value).toBe("팩 A 수정");
  fireEvent.change(screen.getByLabelText("팩 선택"), { target: { value: "b" } });
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLSelectElement>("이야기 선택").value).toBe("other"),
  );
  fireEvent.click(screen.getByRole("button", { name: "이야기 설정" }));
  expect(screen.getByLabelText<HTMLInputElement>("이야기 제목").value).toBe("팩 B 수정");
});

it("저장 중 받은 다른 팩 열기 요청을 저장 완료 후 처리하고 저장 결과는 원래 팩에 남긴다", async () => {
  let finish: (value: PackStorySnapshot) => void = () => {};
  let sent: PackStorySnapshot["definition"] | undefined;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot") return PREVIEW_SNAPSHOT;
    if (name === "get_pack_story_definition") return pack((args as { packId: string }).packId);
    if (name === "save_pack_story_definition") {
      sent = (args as { definition: PackStorySnapshot["definition"] }).definition;
      return new Promise<PackStorySnapshot>((resolve) => {
        finish = resolve;
      });
    }
    return null;
  });
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  await editStoryTitle("저장한 팩 A");
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(sent).toBeDefined());
  if (!sent) throw new Error("저장 요청을 받지 못했어요.");
  act(() => eventMock.listener?.({ payload: { packId: "b", scenarioId: "other" } }));
  expect(screen.getByLabelText<HTMLSelectElement>("팩 선택").value).toBe("a");
  const savedDefinition = sent;
  await act(async () => finish({ ...pack("a"), baseline: "저장 후", definition: savedDefinition }));
  await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>("팩 선택").value).toBe("b"));
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLSelectElement>("이야기 선택").value).toBe("other"),
  );
  fireEvent.change(screen.getByLabelText("팩 선택"), { target: { value: "a" } });
  await waitFor(() =>
    expect(screen.getByLabelText<HTMLSelectElement>("이야기 선택").value).toBe("one"),
  );
  fireEvent.click(screen.getByRole("button", { name: "이야기 설정" }));
  expect(screen.getByLabelText<HTMLInputElement>("이야기 제목").value).toBe("저장한 팩 A");
  expect(screen.queryByText("바뀐 내용")).toBeNull();
});

it("연속 입력을 한 번에 되돌리고 저장한 뒤에도 다시 실행한다", async () => {
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot") return PREVIEW_SNAPSHOT;
    if (name === "get_pack_story_definition") return pack("a");
    if (name === "save_pack_story_definition") {
      return {
        ...pack("a"),
        definition: (args as { definition: PackStorySnapshot["definition"] }).definition,
      };
    }
    return null;
  });
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  const title = await editStoryTitle("하");
  fireEvent.change(title, { target: { value: "하나" } });
  fireEvent.keyDown(title, { key: "z", metaKey: true });
  expect(title.value).toBe("one 이야기");
  fireEvent.keyDown(title, { key: "z", metaKey: true, shiftKey: true });
  expect(title.value).toBe("하나");
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() => expect(screen.queryByText("바뀐 내용")).toBeNull());
  fireEvent.keyDown(title, { key: "z", metaKey: true });
  expect(title.value).toBe("one 이야기");
  expect(screen.getByText("바뀐 내용")).toBeTruthy();
  fireEvent.keyDown(title, { key: "z", metaKey: true, shiftKey: true });
  expect(title.value).toBe("하나");
});

it("닫기 확인에서 계속 편집과 버리기를 선택한다", async () => {
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  await editStoryTitle("초안");
  fireEvent.click(screen.getByRole("button", { name: "창 닫기" }));
  expect(await screen.findByText("바뀐 내용을 저장할까요?")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
  expect(windowMock.destroy).not.toHaveBeenCalled();
  expect(screen.getByLabelText<HTMLInputElement>("이야기 제목").value).toBe("초안");
  fireEvent.click(screen.getByRole("button", { name: "창 닫기" }));
  fireEvent.click(screen.getByRole("button", { name: "버리기" }));
  await waitFor(() => expect(windowMock.destroy).toHaveBeenCalledOnce());
});

it("닫기에서 저장이 실패하면 창과 초안을 유지하고 성공하면 닫는다", async () => {
  let fail = true;
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot") return PREVIEW_SNAPSHOT;
    if (name === "get_pack_story_definition") return pack("a");
    if (name === "save_pack_story_definition") {
      if (fail) throw new Error("저장 실패");
      return {
        ...pack("a"),
        definition: (args as { definition: PackStorySnapshot["definition"] }).definition,
      };
    }
    return null;
  });
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  await editStoryTitle("초안");
  fireEvent.click(screen.getByRole("button", { name: "창 닫기" }));
  const dialog = await screen.findByRole("dialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));
  expect((await screen.findByRole("alert")).textContent).toContain("저장 실패");
  expect(windowMock.destroy).not.toHaveBeenCalled();
  expect(screen.getByLabelText<HTMLInputElement>("이야기 제목").value).toBe("초안");
  fail = false;
  fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));
  await waitFor(() => expect(windowMock.destroy).toHaveBeenCalledOnce());
});
afterEach(cleanup);

it("선을 끊거나 다시 잇고 빈 곳에 장을 만들며 각 변경을 되돌린다", async () => {
  const snapshot = pack("a");
  const story = scenario("one");
  story.chapters = [
    { id: "first", title: "첫 장", next: "second", steps: [] },
    { id: "second", title: "둘째 장", next: "end", steps: [] },
  ];
  snapshot.definition.scenarios = [story];
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot") return PREVIEW_SNAPSHOT;
    if (name === "get_pack_story_definition") return snapshot;
    return null;
  });
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  const first = await screen.findByText("첫 장", { selector: "span" });
  fireEvent.click(first);
  const next = (): HTMLSelectElement => screen.getByLabelText("다음 장");
  expect(next().value).toBe("second");
  const edgeId = flowMock.edgeId;
  expect(edgeId).toBeDefined();
  if (!edgeId) throw new Error("첫 장에서 나가는 선이 없어요.");

  act(() => flowMock.selectEdge?.(edgeId));
  fireEvent.keyDown(document, { key: "Delete" });
  expect(next().value).toBe("");
  fireEvent.keyDown(document, { key: "z", metaKey: true });
  expect(next().value).toBe("second");

  act(() => flowMock.connect?.(edgeId, first));
  expect(next().value).toBe("first");
  fireEvent.keyDown(document, { key: "z", metaKey: true });
  expect(next().value).toBe("second");

  const pane = document.createElement("div");
  pane.className = "react-flow__pane";
  act(() => flowMock.connect?.(edgeId, pane));
  expect(screen.getByLabelText<HTMLInputElement>("장 제목").value).toBe("");
  expect(screen.getByLabelText<HTMLTextAreaElement>("단계 1 대사").value).toBe("");
  fireEvent.click(screen.getByText("첫 장", { selector: "span" }));
  const createdId = next().value;
  expect(createdId).not.toBe("second");
  expect(createdId).not.toBe("");
  expect(screen.getByRole<HTMLOptionElement>("option", { name: "새 장" }).value).toBe(createdId);
  fireEvent.keyDown(document, { key: "z", metaKey: true });
  expect(next().value).toBe("second");
  expect(screen.queryByRole("option", { name: "새 장" })).toBeNull();
  fireEvent.keyDown(document, { key: "z", metaKey: true, shiftKey: true });
  expect(next().value).toBe(createdId);
});

it("불러오는 동안 안내하고 선택한 이야기의 구조를 표시한다", async () => {
  let finish: (value: PackStorySnapshot) => void = () => {};
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot") return PREVIEW_SNAPSHOT;
    if (name === "get_pack_story_definition")
      return new Promise<PackStorySnapshot>((resolve) => {
        finish = resolve;
      });
    return null;
  });
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  expect(screen.getByRole("status").textContent).toContain("불러오는 중");
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("get_pack_story_definition", { packId: "a" }),
  );
  await act(async () => finish(pack("a")));
  expect(await screen.findByText("one 장", { selector: "span" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("이야기 선택"), { target: { value: "two" } });
  expect(screen.getByText("two 장", { selector: "span" })).toBeTruthy();
});

it("실패하면 다시 불러올 수 있다", async () => {
  let fail = true;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot") return PREVIEW_SNAPSHOT;
    if (name === "get_pack_story_definition") {
      if (fail) throw new Error("실패");
      return pack("a");
    }
    return null;
  });
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));
  expect(await screen.findByText("one 장", { selector: "span" })).toBeTruthy();
});

it("팩 전환 뒤 늦게 도착한 이전 팩은 표시하지 않는다", async () => {
  let finish: (value: PackStorySnapshot) => void = () => {};
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot") return PREVIEW_SNAPSHOT;
    if (name === "get_pack_story_definition")
      return (args as { packId: string }).packId === "a"
        ? new Promise<PackStorySnapshot>((resolve) => {
            finish = resolve;
          })
        : pack("b");
    return null;
  });
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("get_pack_story_definition", { packId: "a" }),
  );
  fireEvent.change(screen.getByLabelText("팩 선택"), { target: { value: "b" } });
  expect(await screen.findByText("other 장", { selector: "span" })).toBeTruthy();
  await act(async () => finish(pack("a")));
  expect(screen.queryByText("one 장")).toBeNull();
  expect(screen.getByText("other 장", { selector: "span" })).toBeTruthy();
});

it("이야기가 없는 팩의 빈 상태를 표시한다", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot") return PREVIEW_SNAPSHOT;
    if (name === "get_pack_story_definition") {
      const empty = pack("a");
      return { ...empty, definition: { ...empty.definition, scenarios: [] } };
    }
    return null;
  });
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="" />);
  expect(await screen.findByText("이야기가 없어요.")).toBeTruthy();
});

function useChapterFixture(chapters: NonNullable<ScenarioDefinition["chapters"]>): void {
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot") return PREVIEW_SNAPSHOT;
    if (name === "get_pack_story_definition") {
      const value = pack("a");
      value.definition.scenarios = [{ ...scenario("one"), chapters }];
      return value;
    }
    if (name === "save_pack_story_definition") {
      return {
        ...pack("a"),
        definition: (args as { definition: PackStorySnapshot["definition"] }).definition,
      };
    }
    return null;
  });
}

const writtenLine = { kind: "line" as const, persona: "a", expression: "평온", text: "안녕" };

it("빈 대사와 끊어진 연결이 있으면 저장하지 않고 확인할 곳을 연다", async () => {
  useChapterFixture([
    { id: "first", title: "첫 장", next: "", steps: [{ ...writtenLine, text: "" }] },
  ]);
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  await editStoryTitle("쓰던 초안");
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  expect(await screen.findByText("고쳐야 저장할 수 있어요.")).toBeTruthy();
  expect(screen.getByText("빈 대사가 있어요")).toBeTruthy();
  expect(screen.getByText("이어질 곳 없음")).toBeTruthy();
  expect(screen.getByText("바뀐 내용")).toBeTruthy();
  expect(command).not.toHaveBeenCalledWith("save_pack_story_definition", expect.anything());
});

it("도달하지 못하는 장만 있으면 경고를 표시하면서 저장한다", async () => {
  useChapterFixture([
    { id: "first", title: "첫 장", next: "end", steps: [writtenLine] },
    { id: "second", title: "별도 장", next: "end", steps: [writtenLine] },
  ]);
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  await editStoryTitle("바꾼 제목");
  fireEvent.click(screen.getByRole("button", { name: "확인할 곳 1" }));
  expect(screen.getByText("어디서도 오지 못해요")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "save_pack_story_definition",
      expect.objectContaining({
        definition: expect.objectContaining({
          scenarios: [expect.objectContaining({ title: "바꾼 제목" })],
        }),
      }),
    ),
  );
});

it("들어오는 연결을 보여주고 장을 삭제한 뒤 되돌린다", async () => {
  useChapterFixture([
    { id: "first", title: "첫 장", next: "second", steps: [writtenLine] },
    { id: "second", title: "둘째", next: "end", steps: [writtenLine] },
  ]);
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  fireEvent.click(await screen.findByText("둘째", { selector: "span" }));
  fireEvent.click(screen.getByRole("button", { name: "장 지우기" }));
  const dialog = await screen.findByRole("dialog", { name: "둘째 장을 지울까요?" });
  expect(within(dialog).getByText(/여기로 이어지던 1곳이 끊겨요/)).toBeTruthy();
  fireEvent.click(within(dialog).getByRole("button", { name: "장 지우기" }));
  expect(screen.queryByText("둘째", { selector: "span" })).toBeNull();
  expect(screen.getByRole("button", { name: "확인할 곳 1" })).toBeTruthy();
  fireEvent.keyDown(document, { key: "z", metaKey: true });
  expect(await screen.findByText("둘째", { selector: "span" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "확인할 곳 0" })).toBeTruthy();
  expect(screen.queryByText("바뀐 내용")).toBeNull();
});

it("장 위치만 이동하고 정돈해도 이야기의 변경 표시가 생기지 않는다", async () => {
  useChapterFixture([{ id: "first", title: "첫 장", next: "end", steps: [writtenLine] }]);
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  await screen.findByText("첫 장", { selector: "span" });
  act(() => flowMock.drag?.("chapter:first", { x: 300, y: 120 }));
  expect(screen.queryByText("바뀐 내용")).toBeNull();
  expect(localStorage.length).toBe(1);
  fireEvent.click(screen.getByRole("button", { name: "정돈" }));
  expect(localStorage.length).toBe(0);
  expect(screen.queryByText("바뀐 내용")).toBeNull();
});
