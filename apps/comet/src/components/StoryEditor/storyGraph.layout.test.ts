import { describe, expect, it } from "vitest";
import { layoutStoryGraph, type StoryGraph, type StoryGraphEdge } from "./storyGraph";

function graph(ids: string[], edges: [string, string, StoryGraphEdge["kind"]][]): StoryGraph {
  return {
    startId: ids[0],
    nodes: ids.map((id) => ({ id, title: id, kind: "chapter" })),
    edges: edges.map(([source, target, kind], index) => ({
      id: String(index),
      source,
      target,
      kind,
      label: "",
    })),
  };
}

describe("layoutStoryGraph의 깊이와 순서", () => {
  it("합류하는 장을 양쪽 경로보다 뒤에 둔다", () => {
    const positions = layoutStoryGraph(
      graph(
        ["start", "connect", "finish"],
        [
          ["start", "finish", "choice"],
          ["start", "connect", "next"],
          ["connect", "finish", "next"],
        ],
      ),
    );

    expect(positions.finish.x).toBeGreaterThan(positions.start.x);
    expect(positions.finish.x).toBeGreaterThan(positions.connect.x);
    expect(positions.finish.x).toBe(640);
  });

  it("같은 깊이에서 다음 장을 선택지와 시간 초과 분기보다 위에 둔다", () => {
    const positions = layoutStoryGraph(
      graph(
        ["start", "choice", "timeout", "next"],
        [
          ["start", "choice", "choice"],
          ["start", "timeout", "timeout"],
          ["start", "next", "next"],
        ],
      ),
    );

    expect(positions.next.x).toBe(positions.choice.x);
    expect(positions.next.x).toBe(positions.timeout.x);
    expect(positions.next.y).toBeLessThan(positions.choice.y);
    expect(positions.next.y).toBeLessThan(positions.timeout.y);
  });

  it("순환에서 현재 경로로 되돌아가는 연결을 무시하고 끝난다", () => {
    const positions = layoutStoryGraph(
      graph(
        ["a", "b", "c"],
        [
          ["a", "b", "next"],
          ["b", "c", "next"],
          ["c", "a", "choice"],
        ],
      ),
    );

    expect(positions).toEqual({ a: { x: 0, y: 0 }, b: { x: 320, y: 0 }, c: { x: 640, y: 0 } });
  });

  it("99장에 지름길이 많아도 가장 긴 경로로 배치한다", () => {
    const ids = Array.from({ length: 99 }, (_, index) => String(index));
    const edges: [string, string, StoryGraphEdge["kind"]][] = [];
    for (let index = 0; index < ids.length - 1; index += 1) {
      edges.push([ids[index], ids[index + 1], "next"]);
      if (index + 2 < ids.length) {
        edges.push([ids[index], ids[index + 2], "choice"]);
      }
    }

    const positions = layoutStoryGraph(graph(ids, edges));

    expect(Object.keys(positions)).toHaveLength(99);
    expect(positions["98"].x).toBe(98 * 320);
  });
});
