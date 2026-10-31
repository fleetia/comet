import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import {
  clearStoryPositions,
  readStoryPositions,
  useStoryPositions,
  writeStoryPositions,
} from "./storyPositions";
import type { StoryGraph } from "./storyGraph";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("story positions", () => {
  it("stores positions separately for each pack and story and clears only the chosen story", () => {
    const first = { "chapter:a": { x: 12, y: -30 } };
    const second = { "chapter:a": { x: 80, y: 20 } };
    writeStoryPositions("pack", "story", first);
    writeStoryPositions("pack", "other", second);
    writeStoryPositions("other", "story", second);

    expect(readStoryPositions("pack", "story")).toEqual(first);
    expect(readStoryPositions("pack", "other")).toEqual(second);
    expect(readStoryPositions("other", "story")).toEqual(second);
    clearStoryPositions("pack", "story");
    expect(readStoryPositions("pack", "story")).toEqual({});
    expect(readStoryPositions("pack", "other")).toEqual(second);
    expect(readStoryPositions("other", "story")).toEqual(second);
  });

  it("ignores invalid stored data and retains valid positions", () => {
    writeStoryPositions("pack", "story", { a: { x: 1, y: 2 } });
    const key = localStorage.key(0);
    if (!key) throw new Error("missing positions key");
    localStorage.setItem(key, '{"a":{"x":1,"y":2},"b":{"x":"bad","y":3}}');
    expect(readStoryPositions("pack", "story")).toEqual({ a: { x: 1, y: 2 } });
    localStorage.setItem(key, "{");
    expect(readStoryPositions("pack", "story")).toEqual({});
  });

  it("continues with automatic positions when storage operations fail", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("unavailable");
      },
      setItem: () => {
        throw new Error("unavailable");
      },
      removeItem: () => {
        throw new Error("unavailable");
      },
    });
    expect(readStoryPositions("pack", "story")).toEqual({});
    expect(() => writeStoryPositions("pack", "story", { a: { x: 1, y: 2 } })).not.toThrow();
    expect(() => clearStoryPositions("pack", "story")).not.toThrow();
  });
});

describe("열린 이야기의 위치", () => {
  const connected: StoryGraph = {
    startId: "a",
    nodes: ["a", "b", "c"].map((id) => ({ id, title: id, kind: "chapter" })),
    edges: [
      { id: "ab", source: "a", target: "b", kind: "next", label: "" },
      { id: "bc", source: "b", target: "c", kind: "next", label: "" },
    ],
  };

  it("저장 위치와 줄바꿈된 자동 위치가 겹치면 저장 위치를 유지하고 정돈은 새 배치를 쓴다", () => {
    const ids = ["a", "b", "c", "d", "e", "f", "g"];
    const longStory: StoryGraph = {
      startId: ids[0],
      nodes: ids.map((id) => ({ id, title: id, kind: "chapter" })),
      edges: ids.slice(1).map((id, index) => ({
        id, source: ids[index], target: id, kind: "next", label: "",
      })),
    };
    writeStoryPositions("pack", "story", { f: { x: 0, y: 0 } }, 280);
    const { result } = renderHook(() => useStoryPositions(longStory, "pack", "story"));

    expect(result.current.positions.f).toEqual({ x: 0, y: 0 });
    expect(result.current.positions.a).toEqual({ x: 0, y: 180 });
    expect(readStoryPositions("pack", "story")).toEqual({ f: { x: 0, y: 0 } });

    act(() => result.current.tidy());
    expect(result.current.positions.a).toEqual({ x: 0, y: 0 });
    expect(result.current.positions.f).toEqual({ x: 0, y: 180 });
    expect(readStoryPositions("pack", "story")).toEqual({});
  });

  it("저장된 끝 노드도 그대로 두고 자동 노드 사이의 연쇄 충돌을 피한다", () => {
    const ids = Array.from({ length: 11 }, (_, index) => String(index));
    const longStory: StoryGraph = {
      startId: ids[0],
      nodes: [
        ...ids.map((id) => ({ id, title: id, kind: "chapter" as const })),
        { id: "end:0", title: "끝", kind: "end" },
      ],
      edges: [
        ...ids.slice(1).map((id, index) => ({
          id, source: ids[index], target: id, kind: "next" as const, label: "",
        })),
        { id: "end-edge", source: "10", target: "end:0", kind: "next", label: "" },
      ],
    };
    writeStoryPositions("pack", "story", { "end:0": { x: 0, y: 0 } }, 280);
    const { result } = renderHook(() => useStoryPositions(longStory, "pack", "story"));

    expect(result.current.positions["end:0"]).toEqual({ x: 0, y: 0 });
    expect(result.current.positions["0"]).toEqual({ x: 0, y: 96 });
    expect(result.current.positions["5"]).toEqual({ x: 0, y: 276 });
    expect(result.current.positions["10"]).toEqual({ x: 0, y: 456 });
  });

  it("자동 배치 간격이 바뀌어도 저장한 위치를 그대로 불러온다", () => {
    const saved = { b: { x: 320, y: 42 } };
    writeStoryPositions("pack", "story", saved);
    const { result } = renderHook(() => useStoryPositions(connected, "pack", "story"));

    expect(result.current.positions.b).toEqual(saved.b);
    expect(result.current.positions.c).toEqual({ x: 640, y: 0 });
    expect(readStoryPositions("pack", "story")).toEqual(saved);
  });

  it("새 자동 배치에서 위치를 저장해도 다시 열 때 나머지 간격을 유지한다", () => {
    const first = renderHook(() => useStoryPositions(connected, "pack", "story"));
    act(() => first.result.current.savePosition("b", { x: 290, y: 42 }));
    first.unmount();

    const reopened = renderHook(() => useStoryPositions(connected, "pack", "story"));
    expect(reopened.result.current.positions.b).toEqual({ x: 290, y: 42 });
    expect(reopened.result.current.positions.c).toEqual({ x: 560, y: 0 });
  });

  it("연결 끊기와 장 삭제 후에도 위치를 유지하고 되돌린 장은 원래 자리에 놓는다", () => {
    const { result, rerender } = renderHook(
      ({ graph }) => useStoryPositions(graph, "pack", "story"),
      {
        initialProps: { graph: connected },
      },
    );
    const initial = { ...result.current.positions };
    const disconnected = { ...connected, edges: connected.edges.slice(1) };
    rerender({ graph: disconnected });
    expect(result.current.positions).toEqual(initial);

    const deleted = {
      ...disconnected,
      nodes: disconnected.nodes.filter((node) => node.id !== "b"),
      edges: [],
    };
    rerender({ graph: deleted });
    expect(result.current.positions.a).toEqual(initial.a);
    expect(result.current.positions.c).toEqual(initial.c);
    rerender({ graph: disconnected });
    expect(result.current.positions).toEqual(initial);

    act(() => result.current.tidy());
    expect(result.current.positions).not.toEqual(initial);
    expect(result.current.positions.a).toEqual({ x: 0, y: 0 });
    expect(result.current.positions.b).toEqual({ x: 0, y: 156 });
  });

  it("새 장은 빈 자리에 추가하고 끌어 놓은 위치를 저장한다", () => {
    const { result, rerender } = renderHook(
      ({ graph }) => useStoryPositions(graph, "pack", "story"),
      {
        initialProps: { graph: connected },
      },
    );
    const initial = { ...result.current.positions };
    rerender({
      graph: {
        ...connected,
        nodes: [...connected.nodes, { id: "d", title: "d", kind: "chapter" }],
      },
    });
    expect(result.current.positions.a).toEqual(initial.a);
    expect(result.current.positions.b).toEqual(initial.b);
    expect(result.current.positions.c).toEqual(initial.c);
    expect(result.current.positions.d.x).toBeGreaterThan(initial.c.x);

    act(() => result.current.savePosition("d", { x: 25, y: 60 }));
    expect(result.current.positions.d).toEqual({ x: 25, y: 60 });
    expect(readStoryPositions("pack", "story")).toEqual({ d: { x: 25, y: 60 } });
  });

  it("앞 연결을 끊어 끝 노드의 ID가 바뀌어도 같은 끝은 제자리에 남는다", () => {
    const withEnds: StoryGraph = {
      ...connected,
      nodes: [...connected.nodes, { id: "end:2", kind: "end", title: "끝" }],
      edges: [
        ...connected.edges,
        {
          id: "exit:c:next:-1:-1",
          source: "c",
          target: "end:2",
          kind: "next",
          label: "끝",
          ref: { chapterId: "c", kind: "next" },
        },
      ],
    };
    const { result, rerender } = renderHook(
      ({ graph }) => useStoryPositions(graph, "pack", "story"),
      {
        initialProps: { graph: withEnds },
      },
    );
    const originalEnd = result.current.positions["end:2"];
    rerender({
      graph: {
        ...withEnds,
        nodes: withEnds.nodes.map((node) =>
          node.id === "end:2" ? { ...node, id: "end:1" } : node,
        ),
        edges: withEnds.edges
          .slice(1)
          .map((edge) => (edge.target === "end:2" ? { ...edge, target: "end:1" } : edge)),
      },
    });
    expect(result.current.positions["end:1"]).toEqual(originalEnd);
  });
});
