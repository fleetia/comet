import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import StoryEditorWindow from "./StoryEditorWindow";
import { command, PREVIEW_SNAPSHOT } from "../../hooks/useSnapshot";

vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ onCloseRequested: vi.fn().mockResolvedValue(() => {}) }),
}));

const flow = vi.hoisted(() => ({
  viewport: { x: 0, y: 0, zoom: 1 },
  position: { x: 0, y: 0 },
  setCenter: vi.fn((_: number, __: number, options: { zoom?: number }) => {
    flow.viewport.zoom = options.zoom ?? 2;
  }),
  getViewport: () => flow.viewport,
}));
vi.mock("@xyflow/react", () => ({
  ReactFlowProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  ReactFlow: ({ children, nodes }: {
    children: React.ReactNode;
    nodes: { id: string; position: { x: number; y: number } }[];
  }) => {
    const node = nodes.find((item) => item.id === "chapter:first");
    if (node) flow.position = node.position;
    return <div>{children}</div>;
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
    fitView: vi.fn(), zoomIn: vi.fn(), zoomOut: vi.fn(),
    getViewport: flow.getViewport, setViewport: vi.fn(), setCenter: flow.setCenter,
    flowToScreenPosition: (position: unknown) => position,
    screenToFlowPosition: (position: unknown) => position,
  }),
}));

beforeEach(() => {
  localStorage.clear();
  flow.setCenter.mockClear();
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_character_packs") return [{ id: "a", name: "팩 A" }];
    if (name === "get_snapshot") return PREVIEW_SNAPSHOT;
    if (name === "get_pack_story_definition") return {
      packId: "a", baseline: "", sourceToLocal: {},
      definition: {
        worldRules: "", storyFlags: [], knowledge: [],
        scenarios: [{
          id: "one", title: "이야기", centerId: "a", participants: [], keywords: [],
          requiredFlags: [], minAffinity: 0, allowIncompleteRepeat: false, allowRepeat: false,
          completion: { setFlags: [], memoryTemplate: null },
          chapters: [{
            id: "first", title: "첫 장", next: "end",
            steps: [{ kind: "line", persona: "a", expression: "평온", text: "" }],
          }],
        }],
      },
    };
    return null;
  });
});
afterEach(cleanup);

it.each([
  { source: "찾기", zoom: 0.75 },
  { source: "확인할 곳", zoom: 1.4 },
])("$source에서 장으로 이동할 때 배율을 유지하고 패널 밖에 놓는다", async ({ source, zoom }) => {
  flow.viewport = { x: 0, y: 0, zoom };
  render(<StoryEditorWindow initialPackId="a" initialScenarioId="one" />);
  if (source === "찾기") {
    fireEvent.click(await screen.findByRole("button", { name: "찾기" }));
    const panel = screen.getByRole("complementary", { name: "찾기" });
    fireEvent.change(within(panel).getByLabelText("이야기에서 찾기"), { target: { value: "첫 장" } });
    fireEvent.click(within(panel).getByRole("button", { name: /첫 장/ }));
  } else {
    fireEvent.click(await screen.findByRole("button", { name: "확인할 곳 1" }));
    fireEvent.click(screen.getByText("빈 대사가 있어요"));
  }
  expect(flow.setCenter).toHaveBeenCalledWith(
    flow.position.x + 112 + Math.min(400, window.innerWidth) / (2 * zoom),
    flow.position.y + 50,
    { duration: 0, zoom },
  );
  expect(flow.viewport.zoom).toBe(zoom);
  expect(screen.getByLabelText("장 제목")).toBeTruthy();
});
