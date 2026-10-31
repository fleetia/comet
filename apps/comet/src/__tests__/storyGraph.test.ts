import { describe, expect, it } from "vitest";
import type { ScenarioChapter, ScenarioDefinition } from "../types";
import {
  buildStoryGraph,
  createStoryChapter,
  deleteStoryChapter,
  findStoryProblems,
  incomingStoryExits,
  setStoryExit,
  setStoryStart,
  layoutStoryGraph,
  normalizeStoryChapters,
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

describe("normalizeStoryChapters", () => {
  it("모든 분기와 시간 초과 경로를 유지하며 시작 장을 맨 앞으로 옮긴다", () => {
    const a = chapter("a");
    a.steps.push({
      kind: "choice",
      persona: "actor",
      expression: "평온",
      prompt: "?",
      options: [
        { id: "one", label: "계속", goto: "next" },
        { id: "two", label: "마지막", goto: "c" },
        { id: "three", label: "끝", goto: "end" },
      ],
    });
    const b = chapter("b");
    b.steps.push({
      kind: "wait",
      event: "body.clicked",
      timeoutSec: 10,
      onTimeout: { steps: [], then: "nextChapter" },
    });
    const original = [a, b, chapter("c", "end"), chapter("d")];
    const normalized = normalizeStoryChapters(original, "b");

    expect(normalized.map(({ id, next }) => [id, next])).toEqual([
      ["b", "c"],
      ["a", "b"],
      ["c", "end"],
      ["d", "end"],
    ]);
    expect(original[0].next).toBeUndefined();

    function paths(chapters: ScenarioChapter[], start: string): string[] {
      const graph = buildStoryGraph(scenario(chapters), []);
      function visit(id: string, seen: Set<string>): string[] {
        if (id.startsWith("end:")) {
          return ["end"];
        }
        if (seen.has(id)) {
          return [`${id}:cycle`];
        }
        const nextSeen = new Set(seen).add(id);
        const outgoing = graph.edges.filter((edge) => edge.source === id);
        return outgoing.flatMap((edge) =>
          visit(edge.target, nextSeen).map((path) => `${id}:${edge.kind}>${path}`),
        );
      }
      return visit(`chapter:${start}`, new Set()).sort();
    }
    for (const { id } of original) {
      expect(paths(normalized, id)).toEqual(paths(original, id));
    }
    expect(paths(original, "a")).toHaveLength(4);
  });

  it("명시된 종료와 생략된 마지막 장을 구분하고 저장 후 다시 불러와도 유지한다", () => {
    const original = [chapter("a", "end"), chapter("b"), chapter("c")];
    const saved = normalizeStoryChapters(original);
    expect(saved.map(({ next }) => next)).toEqual(["end", "c", "end"]);
    const loaded: ScenarioChapter[] = JSON.parse(JSON.stringify(saved));
    expect(normalizeStoryChapters(loaded)).toEqual(saved);
    expect(normalizeStoryChapters([])).toEqual([]);
  });
});

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

  it("다음 단계 선택지는 선 없이 각 출구에 표시하고 이후 실행되지 않는 단계는 제외한다", () => {
    const a = chapter("a");
    a.steps.push(
      {
        kind: "choice",
        persona: "actor",
        expression: "평온",
        prompt: "?",
        options: [
          { id: "one", label: "계속", goto: "next" },
          { id: "two", label: "", goto: "next" },
          { id: "three", label: "끝", goto: "end" },
        ],
      },
      {
        kind: "choice",
        persona: "actor",
        expression: "평온",
        prompt: "?",
        options: [{ id: "four", label: "마침", goto: "end" }],
      },
      {
        kind: "choice",
        persona: "actor",
        expression: "평온",
        prompt: "?",
        options: [{ id: "five", label: "닿지 않음", goto: "next" }],
      },
    );
    const graph = buildStoryGraph(scenario([a]), []);
    expect(graph.nodes[0].localExits).toMatchObject([
      { kind: "choice", label: "계속 · 다음 단계" },
      { kind: "choice", label: "선택지 · 다음 단계" },
    ]);
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.every((edge) => edge.target.startsWith("end:"))).toBe(true);
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
    const pairs: [string, string][] = [
      ["a", "b"],
      ["a", "c"],
    ];
    for (let index = 0; index < 10; index += 1) {
      pairs.push(["b", `end${index}`]);
    }
    const ids = ["a", "b", "c", ...Array.from({ length: 10 }, (_, index) => `end${index}`)];
    const positions = layoutStoryGraph(graph(ids, pairs));
    expect(positions.c.y - positions.b.y).toBeGreaterThanOrEqual(90 + 10 * 20 + 40);
  });
  it("장 안에서 이어지는 선택지의 높이도 배치에 반영한다", () => {
    const value = graph(
      ["a", "b", "c"],
      [
        ["a", "b"],
        ["a", "c"],
      ],
    );
    value.nodes[1].localExits = Array.from({ length: 10 }, (_, index) => ({
      id: String(index),
      source: "b",
      kind: "choice",
      label: "다음 단계",
    }));
    const positions = layoutStoryGraph(value);
    expect(positions.c.y - positions.b.y).toBeGreaterThanOrEqual(100 + 10 * 24);
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

describe("장과 이어지는 곳 편집", () => {
  it("다음 장, 선택지, 시간이 지난 뒤의 연결을 바꾸고 끊는다", () => {
    const first = chapter("a", "b");
    first.steps.push(
      {
        kind: "choice",
        persona: "actor",
        expression: "평온",
        prompt: "?",
        options: [
          { id: "one", label: "계속", goto: "next" },
          { id: "two", label: "다음", goto: "next" },
        ],
      },
      {
        kind: "wait",
        event: "body.clicked",
        timeoutSec: 10,
        onTimeout: { steps: [], then: "nextChapter" },
      },
    );
    const original = scenario([first, chapter("b", "end"), chapter("c", "end")]);
    const next = { chapterId: "a", kind: "next" } as const;
    const choice = { chapterId: "a", kind: "choice", stepIndex: 1, optionIndex: 0 } as const;
    const timeout = { chapterId: "a", kind: "timeout", stepIndex: 2 } as const;
    const updated = setStoryExit(
      setStoryExit(setStoryExit(original, next, "c"), choice, "b"),
      timeout,
      "",
    );
    const graph = buildStoryGraph(updated, []);
    expect(links(graph)).toContain("chapter:a>chapter:c:next");
    expect(links(graph)).toContain("chapter:a>chapter:b:choice");
    expect(graph.nodes[0].localExits).toContainEqual(
      expect.objectContaining({ ref: timeout, targetState: "missing" }),
    );
    expect(original.chapters?.[0].next).toBe("b");
    const disconnected = setStoryExit(updated, choice, "");
    expect(
      findStoryProblems(disconnected).filter((problem) => problem.kind === "missing-exit"),
    ).toHaveLength(2);
  });

  it("들어오는 연결을 세고 삭제하면 끊으며 이전 상태는 복원할 수 있다", () => {
    const a = chapter("a", "b");
    a.steps.push({
      kind: "wait",
      event: "body.clicked",
      timeoutSec: 5,
      onTimeout: { steps: [], then: "nextChapter" },
    });
    const original = scenario([a, chapter("b", "end"), chapter("c", "b")]);
    expect(incomingStoryExits(original, "b")).toHaveLength(3);
    const deleted = deleteStoryChapter(original, "b");
    expect(deleted.chapters?.map(({ id }) => id)).toEqual(["a", "c"]);
    expect(deleted.chapters?.[0].next).toBe("");
    expect(deleted.chapters?.[1].next).toBe("");
    expect(deleted.chapters?.[0].steps[1]).toMatchObject({ onTimeout: { then: "" } });
    expect(original.chapters?.[0].next).toBe("b");
    expect(deleteStoryChapter(scenario([chapter("only")]), "only").chapters).toHaveLength(1);
  });

  it("시작 장을 옮길 때 생략된 다음 장의 기존 의미를 유지한다", () => {
    const original = scenario([chapter("a"), chapter("b"), chapter("c")]);
    const updated = setStoryStart(original, "c");
    expect(updated.chapters?.map(({ id, next }) => [id, next])).toEqual([
      ["c", "end"],
      ["a", "b"],
      ["b", "c"],
    ]);
    expect(original.chapters?.[0].next).toBeUndefined();
  });

  it("새 장을 만들고 99장에서 더 만들지 않는다", () => {
    const original = scenario([chapter("a", "end")]);
    expect(createStoryChapter(original, chapter("b", "end")).chapters).toHaveLength(2);
    const full = scenario(Array.from({ length: 99 }, (_, index) => chapter(String(index), "end")));
    expect(createStoryChapter(full, chapter("extra", "end"))).toBe(full);
  });

  it("저장을 막는 각 문제와 도달 불가 경고를 구분한다", () => {
    const a = chapter("a", "");
    a.steps[0] = { kind: "line", persona: "actor", expression: "평온", text: "  " };
    a.steps.push({
      kind: "choice",
      persona: "actor",
      expression: "평온",
      prompt: "?",
      options: [{ id: "one", label: "계속", goto: "missing" }],
    });
    const problems = findStoryProblems(scenario([a, chapter("b", "end")]));
    expect(problems).toContainEqual({ chapterId: "a", kind: "missing-exit", blocking: true });
    expect(problems).toContainEqual({ chapterId: "a", kind: "missing-chapter", blocking: true });
    expect(problems).toContainEqual({ chapterId: "a", kind: "empty-line", blocking: true });
    expect(problems).toContainEqual({ chapterId: "b", kind: "unreachable", blocking: false });
    expect(findStoryProblems(scenario(null))).toEqual([
      { chapterId: "intro", kind: "empty-line", blocking: true },
      { chapterId: "accept", kind: "empty-line", blocking: true },
      { chapterId: "decline", kind: "empty-line", blocking: true },
      { chapterId: "ending", kind: "empty-line", blocking: true },
      { chapterId: "intro", kind: "missing-accept-keywords", blocking: false },
      { chapterId: "intro", kind: "missing-decline-keywords", blocking: false },
    ]);
    const line = { persona: "actor", expression: "평온", text: "안녕" };
    expect(
      findStoryProblems({
        ...scenario(null),
        intro: [line],
        accept: [line],
        decline: [line],
        ending: [line],
        acceptKeywords: ["좋아"],
        declineKeywords: ["다음에"],
      }),
    ).toEqual([]);
  });

  it("제안형의 빈 대사와 노출 친밀도는 막고 빈 분기 표현은 경고한다", () => {
    const line = { persona: "actor", expression: "평온", text: "안녕" };
    const problems = findStoryProblems({
      ...scenario(null),
      intro: [line],
      accept: [line],
      decline: [line],
      ending: [line],
      defer: [{ ...line, text: "  " }],
      minAffinity: 20,
      revealAffinity: 21,
      acceptKeywords: [],
      declineKeywords: [],
    });
    expect(problems).toContainEqual({ chapterId: "defer", kind: "empty-line", blocking: true });
    expect(problems).toContainEqual({
      chapterId: "defer",
      kind: "invalid-reveal-affinity",
      blocking: true,
    });
    expect(problems).toContainEqual({
      chapterId: "intro",
      kind: "missing-accept-keywords",
      blocking: false,
    });
    expect(problems).toContainEqual({
      chapterId: "intro",
      kind: "missing-decline-keywords",
      blocking: false,
    });
  });
});
