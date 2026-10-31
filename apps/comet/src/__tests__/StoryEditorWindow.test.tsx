import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import StoryEditorWindow from "../components/StoryEditor/StoryEditorWindow";
import { command, PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";
import type { InstalledCharacterPack, PackStorySnapshot, ScenarioDefinition } from "../types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({}) }));
vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ReactFlow: ({
    children,
    nodes,
  }: {
    children: React.ReactNode;
    nodes: { id: string; data: { item: { title: string } } }[];
  }) => (
    <div>
      {nodes.map((node) => (
        <span key={node.id}>{node.data.item.title}</span>
      ))}
      {children}
    </div>
  ),
  Background: () => null,
  MiniMap: () => null,
  Handle: () => null,
  Position: { Left: "left", Right: "right" },
  useNodesState: (nodes: unknown[]) => [nodes, vi.fn(), vi.fn()],
  useReactFlow: () => ({ fitView: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn() }),
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
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_character_packs") return packs;
    if (name === "get_snapshot") return PREVIEW_SNAPSHOT;
    if (name === "get_pack_story_definition") return pack((args as { packId: string }).packId);
    return null;
  });
});
afterEach(cleanup);

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
  expect(await screen.findByText("one 장")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("이야기 선택"), { target: { value: "two" } });
  expect(screen.getByText("two 장")).toBeTruthy();
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
  expect(await screen.findByText("one 장")).toBeTruthy();
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
  expect(await screen.findByText("other 장")).toBeTruthy();
  await act(async () => finish(pack("a")));
  expect(screen.queryByText("one 장")).toBeNull();
  expect(screen.getByText("other 장")).toBeTruthy();
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
