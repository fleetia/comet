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

export type StoryExitRef = {
  chapterId: string;
  kind: "next" | "choice" | "timeout";
  stepIndex?: number;
  optionIndex?: number;
};

export type StoryProblem = {
  chapterId: string;
  kind:
    | "missing-exit"
    | "missing-chapter"
    | "empty-line"
    | "unreachable"
    | "unreachable-cycle"
    | "missing-accept-keywords"
    | "missing-decline-keywords"
    | "invalid-reveal-affinity";
  blocking: boolean;
};

export const STORY_CHAPTER_LIMIT = 99;

function exitId(ref: StoryExitRef): string {
  return `exit:${encodeURIComponent(ref.chapterId)}:${ref.kind}:${ref.stepIndex ?? -1}:${ref.optionIndex ?? -1}`;
}

function chapterExits(chapter: ScenarioChapter): { ref: StoryExitRef; target: string }[] {
  const exits: { ref: StoryExitRef; target: string }[] = [
    { ref: { chapterId: chapter.id, kind: "next" }, target: chapter.next ?? "end" },
  ];
  chapter.steps.forEach((step, stepIndex) => {
    if (step.kind === "choice") {
      step.options.forEach((option, optionIndex) => {
        exits.push({
          ref: { chapterId: chapter.id, kind: "choice", stepIndex, optionIndex },
          target: option.goto,
        });
      });
    } else if (step.kind === "wait") {
      exits.push({
        ref: { chapterId: chapter.id, kind: "timeout", stepIndex },
        target: step.onTimeout.then,
      });
    }
  });
  return exits;
}

export function setStoryExit(
  scenario: ScenarioDefinition,
  ref: StoryExitRef,
  target: string,
): ScenarioDefinition {
  if (!scenario.chapters) return scenario;
  return {
    ...scenario,
    chapters: scenario.chapters.map((chapter) => {
      if (chapter.id !== ref.chapterId) return chapter;
      if (ref.kind === "next") return { ...chapter, next: target };
      return {
        ...chapter,
        steps: chapter.steps.map((step, index) => {
          if (index !== ref.stepIndex) return step;
          if (ref.kind === "choice" && step.kind === "choice") {
            return {
              ...step,
              options: step.options.map((option, optionIndex) =>
                optionIndex === ref.optionIndex ? { ...option, goto: target } : option,
              ),
            };
          }
          if (ref.kind === "timeout" && step.kind === "wait") {
            return { ...step, onTimeout: { ...step.onTimeout, then: target } };
          }
          return step;
        }),
      };
    }),
  };
}

export function createStoryChapter(
  scenario: ScenarioDefinition,
  chapter: ScenarioChapter,
): ScenarioDefinition {
  if (!scenario.chapters || scenario.chapters.length >= STORY_CHAPTER_LIMIT) return scenario;
  return { ...scenario, chapters: [...scenario.chapters, chapter] };
}

export function incomingStoryExits(
  scenario: ScenarioDefinition,
  chapterId: string,
): StoryExitRef[] {
  return normalizeStoryChapters(scenario.chapters ?? [])
    .filter((chapter) => chapter.id !== chapterId)
    .flatMap((chapter) =>
      chapterExits(chapter)
        .filter(
          ({ target }) =>
            target === chapterId || (target === "nextChapter" && chapter.next === chapterId),
        )
        .map(({ ref }) => ref),
    );
}

export function deleteStoryChapter(
  scenario: ScenarioDefinition,
  chapterId: string,
): ScenarioDefinition {
  if (
    !scenario.chapters ||
    scenario.chapters.length <= 1 ||
    !scenario.chapters.some((chapter) => chapter.id === chapterId)
  )
    return scenario;
  const normalized = { ...scenario, chapters: normalizeStoryChapters(scenario.chapters) };
  const refs = incomingStoryExits(normalized, chapterId);
  const disconnected = refs.reduce<ScenarioDefinition>(
    (current, ref) => setStoryExit(current, ref, ""),
    normalized,
  );
  return {
    ...disconnected,
    chapters: disconnected.chapters?.filter((chapter) => chapter.id !== chapterId),
  };
}

export function setStoryStart(scenario: ScenarioDefinition, chapterId: string): ScenarioDefinition {
  if (!scenario.chapters || !scenario.chapters.some((chapter) => chapter.id === chapterId))
    return scenario;
  return { ...scenario, chapters: normalizeStoryChapters(scenario.chapters, chapterId) };
}

export function findStoryProblems(scenario: ScenarioDefinition): StoryProblem[] {
  if (!scenario.chapters) {
    const problems: StoryProblem[] = [];
    for (const stage of ["intro", "accept", "decline", "ending", "defer"] as const) {
      const lines = scenario[stage] ?? [];
      if ((stage !== "defer" && lines.length === 0) || lines.some((line) => !line.text.trim())) {
        problems.push({ chapterId: stage, kind: "empty-line", blocking: true });
      }
    }
    if (!(scenario.acceptKeywords ?? []).some((keyword) => keyword.trim())) {
      problems.push({ chapterId: "intro", kind: "missing-accept-keywords", blocking: false });
    }
    if (!(scenario.declineKeywords ?? []).some((keyword) => keyword.trim())) {
      problems.push({ chapterId: "intro", kind: "missing-decline-keywords", blocking: false });
    }
    if (
      scenario.revealAffinity != null &&
      (scenario.revealAffinity < 0 || scenario.revealAffinity > scenario.minAffinity)
    ) {
      problems.push({ chapterId: "defer", kind: "invalid-reveal-affinity", blocking: true });
    }
    return problems;
  }
  const chapters = normalizeStoryChapters(scenario.chapters);
  const ids = new Set(chapters.map((chapter) => chapter.id));
  const problems: StoryProblem[] = [];
  for (const chapter of chapters) {
    for (const { ref, target } of chapterExits(chapter)) {
      if (target === "")
        problems.push({ chapterId: chapter.id, kind: "missing-exit", blocking: true });
      else if (
        target !== "end" &&
        !(ref.kind !== "next" && target === "next") &&
        !(ref.kind === "timeout" && target === "nextChapter") &&
        !ids.has(target)
      ) {
        problems.push({ chapterId: chapter.id, kind: "missing-chapter", blocking: true });
      }
    }
    for (const step of chapter.steps) {
      if (
        (step.kind === "line" && !step.text.trim()) ||
        (step.kind === "ask" && step.input === "name" && step.saved && !step.saved.text.trim())
      ) {
        problems.push({ chapterId: chapter.id, kind: "empty-line", blocking: true });
      }
      if (step.kind === "wait") {
        for (const child of step.onTimeout.steps) {
          if (child.kind === "line" && !child.text.trim())
            problems.push({ chapterId: chapter.id, kind: "empty-line", blocking: true });
        }
      }
    }
  }
  const graph = buildStoryGraph({ ...scenario, chapters }, []);
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, string[]>();
  for (const { source, target } of graph.edges) {
    outgoing.set(source, [...(outgoing.get(source) ?? []), target]);
    incoming.set(target, [...(incoming.get(target) ?? []), source]);
  }
  function traverse(startId: string | undefined, edges: Map<string, string[]>): Set<string> {
    const visited = new Set<string>();
    const pending = startId ? [startId] : [];
    while (pending.length > 0) {
      const id = pending.pop();
      if (!id || visited.has(id)) continue;
      visited.add(id);
      pending.push(...(edges.get(id) ?? []));
    }
    return visited;
  }
  const reachable = traverse(graph.startId, outgoing);
  const grouped = new Set<string>();
  for (const chapter of chapters) {
    const id = `chapter:${chapter.id}`;
    if (reachable.has(id) || grouped.has(id)) continue;
    const forward = traverse(id, outgoing);
    const backward = traverse(id, incoming);
    const component = new Set([...forward].filter((nodeId) => backward.has(nodeId)));
    for (const nodeId of component) grouped.add(nodeId);
    const hasExternalIncoming = [...component].some((nodeId) =>
      (incoming.get(nodeId) ?? []).some((source) => !component.has(source)),
    );
    if (hasExternalIncoming) continue;
    const isCycle = component.size > 1 || (outgoing.get(id) ?? []).includes(id);
    problems.push({
      chapterId: chapter.id,
      kind: isCycle ? "unreachable-cycle" : "unreachable",
      blocking: false,
    });
  }
  return problems;
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
  ref?: StoryExitRef;
  targetState?: "local" | "missing" | "invalid";
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
    ref?: StoryExitRef,
  ): void => {
    edges.push({
      id: ref ? exitId(ref) : `edge:${edges.length}`,
      source,
      target,
      kind,
      label,
      ref,
    });
  };
  const addEnd = (
    source: string,
    kind: StoryGraphEdge["kind"],
    label: string,
    ref?: StoryExitRef,
  ): void => {
    const id = `end:${edges.length}`;
    nodes.push({ id, kind: "end", title: "끝" });
    addEdge(source, id, kind, label, ref);
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
      const localExits: StoryGraphExit[] = [];
      const connect = (target: string, ref: StoryExitRef, label: string): void => {
        const resolved = target === "nextChapter" ? next : target;
        if (resolved === "next" || resolved === "" || (resolved !== "end" && !ids.has(resolved))) {
          localExits.push({
            id: exitId(ref),
            source,
            kind: ref.kind,
            label: resolved === "next" ? `${label || "선택지"} · 다음 단계` : label,
            ref,
            targetState: resolved === "next" ? "local" : resolved === "" ? "missing" : "invalid",
          });
        } else if (resolved === "end") {
          addEnd(source, ref.kind, label, ref);
        } else {
          addEdge(source, chapterId(resolved), ref.kind, label, ref);
        }
      };
      let canContinue = true;
      for (const [stepIndex, step] of chapter.steps.entries()) {
        if (step.kind === "choice") {
          for (const [optionIndex, option] of step.options.entries()) {
            connect(
              option.goto,
              { chapterId: chapter.id, kind: "choice", stepIndex, optionIndex },
              option.label,
            );
          }
          if (!step.options.some((option) => option.goto === "next")) {
            canContinue = false;
            break;
          }
        } else if (step.kind === "wait") {
          connect(
            step.onTimeout.then,
            { chapterId: chapter.id, kind: "timeout", stepIndex },
            "시간이 지나면",
          );
        }
      }
      if (canContinue) {
        connect(next, { chapterId: chapter.id, kind: "next" }, "다음 장");
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

export function layoutStoryGraph(graph: StoryGraph, columnWidth = 280): Record<string, { x: number; y: number }> {
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
      positions[id] = { x: depth * columnWidth, y };
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
