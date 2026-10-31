import type { ScenarioChapter, ScenarioDefinition, SceneLine } from "../../types";

export function normalizeStoryChapters(
  chapters: ScenarioChapter[],
  startId = chapters[0]?.id,
): ScenarioChapter[] {
  const normalized = chapters.map((chapter, index) => ({
    ...chapter,
    next: chapter.next ?? chapters[index + 1]?.id ?? "end",
  }));
  const startIndex = normalized.findIndex((chapter) => chapter.id === startId);
  if (startIndex <= 0) {
    return normalized;
  }
  return [
    normalized[startIndex],
    ...normalized.slice(0, startIndex),
    ...normalized.slice(startIndex + 1),
  ];
}

export type StoryGraphNode = {
  id: string;
  kind: "chapter" | "end" | "story";
  title: string;
  firstLine?: SceneLine;
  isStart?: boolean;
  hasWait?: boolean;
  storyId?: string;
  localExits?: StoryGraphExit[];
};

export type StoryGraphExit = {
  id: string;
  source: string;
  kind: "next" | "choice" | "timeout";
  label: string;
};

export type StoryGraphEdge = StoryGraphExit & { target: string };

export type StoryGraph = {
  nodes: StoryGraphNode[];
  edges: StoryGraphEdge[];
  startId?: string;
};

export function buildStoryGraph(
  scenario: ScenarioDefinition,
  scenarios: ScenarioDefinition[],
): StoryGraph {
  const nodes: StoryGraphNode[] = [];
  const edges: StoryGraphEdge[] = [];
  const chapterId = (id: string): string => `chapter:${id}`;
  const addEdge = (
    source: string,
    target: string,
    kind: StoryGraphEdge["kind"],
    label: string,
  ): void => {
    edges.push({ id: `edge:${edges.length}`, source, target, kind, label });
  };
  const addEnd = (source: string, kind: StoryGraphEdge["kind"], label: string): void => {
    const id = `end:${edges.length}`;
    nodes.push({ id, kind: "end", title: "끝" });
    addEdge(source, id, kind, label);
  };

  if (scenario.chapters != null) {
    const chapters = scenario.chapters;
    const ids = new Set(chapters.map((chapter) => chapter.id));
    for (const [index, chapter] of chapters.entries()) {
      const firstLine = chapter.steps.find((step) => step.kind === "line");
      nodes.push({
        id: chapterId(chapter.id),
        kind: "chapter",
        title: chapter.title || "새 장",
        firstLine,
        isStart: index === 0,
        hasWait: chapter.steps.some((step) => step.kind === "wait"),
      });
    }
    for (const [index, chapter] of chapters.entries()) {
      const source = chapterId(chapter.id);
      const next = chapter.next ?? chapters[index + 1]?.id ?? "end";
      const connect = (target: string, kind: StoryGraphEdge["kind"], label: string): void => {
        const resolved = target === "nextChapter" ? next : target;
        if (resolved === "next") {
          return;
        }
        if (resolved === "end") {
          addEnd(source, kind, label);
        } else if (ids.has(resolved)) {
          addEdge(source, chapterId(resolved), kind, label);
        }
      };
      let canContinue = true;
      const localExits: StoryGraphExit[] = [];
      for (const [stepIndex, step] of chapter.steps.entries()) {
        if (step.kind === "choice") {
          for (const [optionIndex, option] of step.options.entries()) {
            if (option.goto === "next") {
              localExits.push({
                id: `local:${chapter.id}:${stepIndex}:${optionIndex}`,
                source,
                kind: "choice",
                label: `${option.label || "선택지"} · 다음 단계`,
              });
            }
            connect(option.goto, "choice", option.label);
          }
          if (!step.options.some((option) => option.goto === "next")) {
            canContinue = false;
            break;
          }
        } else if (step.kind === "wait") {
          connect(step.onTimeout.then, "timeout", "시간이 지나면");
        }
      }
      if (canContinue) {
        connect(next, "next", "다음 장");
      }
      const node = nodes[index];
      if (localExits.length > 0) {
        node.localExits = localExits;
      }
    }
    return { nodes, edges, startId: chapters[0] && chapterId(chapters[0].id) };
  }

  const stages = [
    ...(scenario.revealAffinity != null || (scenario.defer?.length ?? 0) > 0
      ? ([["defer", "유보"]] as const)
      : []),
    ["intro", "제안"],
    ["accept", "수락"],
    ["decline", "거절"],
    ["ending", "마무리"],
  ] as const;
  for (const [key, title] of stages) {
    nodes.push({
      id: `proposal:${key}`,
      kind: "chapter",
      title,
      firstLine: scenario[key]?.[0],
      isStart: key === "intro",
    });
  }
  const connectStory = (source: string, storyId: string, label: string): void => {
    const story = scenarios.find((item) => item.id === storyId);
    if (!story) {
      return;
    }
    const id = `story:${source}:${storyId}`;
    nodes.push({ id, kind: "story", title: story.title || "새 이야기", storyId });
    addEdge(source, id, "next", label);
  };
  addEdge("proposal:intro", "proposal:accept", "choice", "수락 표현");
  addEdge("proposal:intro", "proposal:decline", "choice", "거절 표현");
  addEdge("proposal:accept", "proposal:ending", "next", "마무리");
  if (scenario.declineNextId) {
    connectStory("proposal:decline", scenario.declineNextId, "다음 이야기");
  } else {
    addEnd("proposal:decline", "next", "끝");
  }
  if (scenario.acceptNextId) {
    connectStory("proposal:ending", scenario.acceptNextId, "다음 이야기");
  } else {
    addEnd("proposal:ending", "next", "끝");
  }
  return { nodes, edges, startId: "proposal:intro" };
}

export function layoutStoryGraph(graph: StoryGraph): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {};
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const exits = new Map<string, StoryGraphEdge[]>();
  for (const edge of graph.edges) {
    const outgoing = exits.get(edge.source) ?? [];
    outgoing.push(edge);
    exits.set(edge.source, outgoing);
  }
  for (const outgoing of exits.values()) {
    outgoing.sort((a, b) => Number(b.kind === "next") - Number(a.kind === "next"));
  }
  const depths = new Map<string, number>();
  const rows = new Map<number, number>();
  const visited = new Set<string>();
  const roots = [graph.startId, ...graph.nodes.map((node) => node.id)];

  for (const root of roots) {
    if (!root || !nodes.has(root) || visited.has(root)) {
      continue;
    }

    const active = new Set<string>();
    const component = new Set<string>();
    const order: string[] = [];
    const postorder: string[] = [];
    const forward = new Map<string, string[]>();
    function visit(id: string): void {
      visited.add(id);
      component.add(id);
      active.add(id);
      order.push(id);
      for (const edge of exits.get(id) ?? []) {
        if (!nodes.has(edge.target) || active.has(edge.target)) {
          continue;
        }
        if (visited.has(edge.target) && !component.has(edge.target)) {
          continue;
        }
        const targets = forward.get(id) ?? [];
        targets.push(edge.target);
        forward.set(id, targets);
        if (!visited.has(edge.target)) {
          visit(edge.target);
        }
      }
      active.delete(id);
      postorder.push(id);
    }
    visit(root);
    depths.set(root, 0);
    for (const id of postorder.reverse()) {
      const depth = depths.get(id) ?? 0;
      for (const target of forward.get(id) ?? []) {
        depths.set(target, Math.max(depths.get(target) ?? 0, depth + 1));
      }
    }
    for (const id of order) {
      const depth = depths.get(id) ?? 0;
      const y = rows.get(depth) ?? 0;
      positions[id] = { x: depth * 320, y };
      const node = nodes.get(id);
      const height =
        node?.kind === "end"
          ? 40
          : 100 + ((exits.get(id)?.length ?? 0) + (node?.localExits?.length ?? 0)) * 24;
      rows.set(depth, y + height + 56);
    }
  }
  return positions;
}
