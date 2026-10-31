import { describe, expect, it } from "vitest";
import type { ScenarioChapter, ScenarioDefinition } from "../types";
import {
  buildStoryGraph,
  layoutStoryGraph,
  type StoryGraph,
} from "../components/StoryEditor/storyGraph";

function scenario(chapters: ScenarioChapter[] | null): ScenarioDefinition {
  return {
    id: "story",
    title: "이야기",
    centerId: "actor",
    participants: ["actor"],
    keywords: [],
    requiredFlags: [],
    minAffinity: 0,
    chapters,
    allowIncompleteRepeat: true,
    allowRepeat: false,
    completion: { setFlags: [], memoryTemplate: null },
  };
}
function chapter(id: string, next?: string): ScenarioChapter {
  return {
    id,
    title: id,
    next,
    steps: [{ kind: "line", persona: "actor", expression: "평온", text: id }],
  };
}
function links(graph: StoryGraph): string[] {
  return graph.edges.map((edge) => `${edge.source}>${edge.target}:${edge.kind}`);
}

describe("buildStoryGraph", () => {
  it("생략한 다음 장을 저장 순서로 연결하고 마지막은 끝으로 연결한다", () => {
    const graph = buildStoryGraph(scenario([chapter("a"), chapter("b")]), []);
    expect(links(graph)).toEqual(["chapter:a>chapter:b:next", "chapter:b>end:1:next"]);
    expect(graph.nodes[0]).toMatchObject({
      id: "chapter:a",
      isStart: true,
      firstLine: { text: "a" },
    });
  });

  it("선택지와 시간 초과의 대상 및 명시된 다음 장을 연결한다", () => {
    const a = chapter("a", "c");
    a.steps.push(
      {
        kind: "choice",
        persona: "actor",
        expression: "평온",
        prompt: "?",
        options: [
          { id: "1", label: "선택", goto: "b" },
          { id: "2", label: "계속", goto: "next" },
          { id: "3", label: "끝", goto: "end" },
        ],
      },
      {
        kind: "wait",
        event: "body.clicked",
        timeoutSec: 10,
        onTimeout: { steps: [], then: "nextChapter" },
      },
    );
    const graph = buildStoryGraph(scenario([a, chapter("b"), chapter("c", "end")]), []);
    expect(links(graph)).toContain("chapter:a>chapter:b:choice");
    expect(links(graph)).toContain("chapter:a>end:1:choice");
    expect(links(graph)).toContain("chapter:a>chapter:c:timeout");
    expect(links(graph)).toContain("chapter:a>chapter:c:next");
    expect(graph.nodes[0].hasWait).toBe(true);
  });

  it("장 안에 머무는 next는 선을 만들지 않고 없는 장은 무시한다", () => {
    const a = chapter("a", "missing");
    a.steps.push(
      {
        kind: "choice",
        persona: "actor",
        expression: "평온",
        prompt: "?",
        options: [
          { id: "1", label: "계속", goto: "next" },
          { id: "2", label: "없음", goto: "missing" },
        ],
      },
      {
        kind: "wait",
        event: "body.clicked",
        timeoutSec: 10,
        onTimeout: { steps: [], then: "next" },
      },
    );
    expect(buildStoryGraph(scenario([a]), []).edges).toEqual([]);
  });

  it("모든 선택지가 장을 벗어나면 뒤 단계와 기본 다음 장은 실행되지 않는다", () => {
    const a = chapter("a");
    a.steps.push(
      {
        kind: "choice",
        persona: "actor",
        expression: "평온",
        prompt: "?",
        options: [{ id: "1", label: "끝", goto: "end" }],
      },
      {
        kind: "wait",
        event: "body.clicked",
        timeoutSec: 10,
        onTimeout: { steps: [], then: "end" },
      },
    );
    const graph = buildStoryGraph(scenario([a, chapter("b")]), []);
    expect(graph.edges.filter((edge) => edge.source === "chapter:a")).toMatchObject([
      { kind: "choice", label: "끝" },
    ]);
  });

  it("제안형의 고정 단계와 다른 이야기, 유보를 표시한다", () => {
    const proposal = {
      ...scenario(null),
      revealAffinity: 10,
      acceptNextId: "other",
      declineNextId: "other",
    };
    const other = { ...scenario(null), id: "other", title: "다른 이야기" };
    const graph = buildStoryGraph(proposal, [proposal, other]);
    expect(graph.nodes.map((node) => node.id)).toEqual(
      expect.arrayContaining([
        "proposal:defer",
        "proposal:intro",
        "proposal:accept",
        "proposal:decline",
        "proposal:ending",
      ]),
    );
    expect(graph.nodes.filter((node) => node.kind === "story")).toHaveLength(2);
    expect(graph.edges.filter((edge) => edge.source === "proposal:defer")).toEqual([]);
    expect(links(graph)).toEqual([
      "proposal:intro>proposal:accept:choice",
      "proposal:intro>proposal:decline:choice",
      "proposal:accept>proposal:ending:next",
      "proposal:decline>story:proposal:decline:other:next",
      "proposal:ending>story:proposal:ending:other:next",
    ]);
    expect(buildStoryGraph(scenario(null), []).nodes.map((node) => node.id)).not.toContain(
      "proposal:defer",
    );
  });

  it("다음 이야기가 없으면 수락 후 마무리와 거절이 각각 끝으로 이어진다", () => {
    const graph = buildStoryGraph(scenario(null), []);
    expect(links(graph)).toEqual([
      "proposal:intro>proposal:accept:choice",
      "proposal:intro>proposal:decline:choice",
      "proposal:accept>proposal:ending:next",
      "proposal:decline>end:3:next",
      "proposal:ending>end:4:next",
    ]);
  });
});

describe("layoutStoryGraph", () => {
  function graph(ids: string[], pairs: [string, string][]): StoryGraph {
    return {
      startId: ids[0],
      nodes: ids.map((id) => ({ id, title: id, kind: "chapter" })),
      edges: pairs.map(([source, target], index) => ({
        id: String(index),
        source,
        target,
        kind: "next",
        label: "",
      })),
    };
  }
  it("일직선을 깊이 순으로 왼쪽에서 오른쪽으로 놓는다", () => {
    const positions = layoutStoryGraph(
      graph(
        ["a", "b", "c"],
        [
          ["a", "b"],
          ["b", "c"],
        ],
      ),
    );
    expect(positions).toEqual({ a: { x: 0, y: 0 }, b: { x: 320, y: 0 }, c: { x: 640, y: 0 } });
  });
  it("분기와 합류를 배치하며 같은 깊이는 세로로 놓는다", () => {
    const positions = layoutStoryGraph(
      graph(
        ["a", "b", "c", "d"],
        [
          ["a", "b"],
          ["a", "c"],
          ["b", "d"],
          ["c", "d"],
        ],
      ),
    );
    expect(positions.b.x).toBe(positions.c.x);
    expect(positions.b.y).not.toBe(positions.c.y);
    expect(positions.d.x).toBeGreaterThan(positions.b.x);
  });
  it("순환과 도달하지 못하는 장도 중복 없이 배치한다", () => {
    const positions = layoutStoryGraph(
      graph(
        ["a", "b", "c", "d"],
        [
          ["a", "b"],
          ["b", "a"],
          ["c", "d"],
        ],
      ),
    );
    expect(Object.keys(positions)).toHaveLength(4);
    expect(new Set(Object.values(positions).map(({ x, y }) => `${x}:${y}`)).size).toBe(4);
  });
  it("이어지는 곳이 많은 장 아래에 다른 장을 겹치지 않게 놓는다", () => {
    const pairs: [string, string][] = [["a", "b"], ["a", "c"]];
    for (let index = 0; index < 10; index += 1) {
      pairs.push(["b", `end${index}`]);
    }
    const ids = ["a", "b", "c", ...Array.from({ length: 10 }, (_, index) => `end${index}`)];
    const positions = layoutStoryGraph(graph(ids, pairs));
    expect(positions.c.y - positions.b.y).toBeGreaterThanOrEqual(90 + 10 * 20 + 40);
  });
  it("99장 모두 배치한다", () => {
    const ids = Array.from({ length: 99 }, (_, index) => String(index));
    const positions = layoutStoryGraph(
      graph(
        ids,
        ids.slice(1).map((id, index) => [ids[index], id]),
      ),
    );
    expect(Object.keys(positions)).toHaveLength(99);
    expect(positions["98"].x).toBe(98 * 320);
  });
});
