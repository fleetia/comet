import { useLayoutEffect, useMemo, useState } from "react";
import { layoutStoryGraph, type StoryGraph, type StoryGraphNode } from "./storyGraph";

export type StoryPositions = Record<string, { x: number; y: number }>;

function storageKey(packId: string, scenarioId: string): string {
  return `comet:story-positions:${JSON.stringify([packId, scenarioId])}`;
}

export function readStoryPositions(packId: string, scenarioId: string): StoryPositions {
  try {
    const raw = localStorage.getItem(storageKey(packId, scenarioId));
    if (!raw) return {};
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const entries: [string, { x: number; y: number }][] = [];
    for (const [id, position] of Object.entries(value)) {
      if (!position || typeof position !== "object" || Array.isArray(position)) continue;
      const { x, y } = position as Record<string, unknown>;
      if (
        typeof x === "number" &&
        Number.isFinite(x) &&
        typeof y === "number" &&
        Number.isFinite(y)
      ) {
        entries.push([id, { x, y }]);
      }
    }
    return Object.fromEntries(entries);
  } catch {
    return {};
  }
}

export function writeStoryPositions(
  packId: string,
  scenarioId: string,
  positions: StoryPositions,
  columnWidth?: number,
): void {
  try {
    localStorage.setItem(storageKey(packId, scenarioId), JSON.stringify(
      columnWidth == null ? positions : { ...positions, $layoutWidth: columnWidth },
    ));
  } catch {
    return;
  }
}

export function clearStoryPositions(packId: string, scenarioId: string): void {
  try {
    localStorage.removeItem(storageKey(packId, scenarioId));
  } catch {
    return;
  }
}

function positionKey(graph: StoryGraph, node: StoryGraphNode): string {
  if (node.kind !== "end") return node.id;
  const edge = graph.edges.find((item) => item.target === node.id);
  if (!edge) return node.id;
  return edge.ref
    ? `end:${edge.id}`
    : `end:${JSON.stringify([edge.source, edge.kind, edge.label])}`;
}

function keyedLayout(graph: StoryGraph, columnWidth = 280): StoryPositions {
  const layout = layoutStoryGraph(graph, columnWidth);
  return Object.fromEntries(graph.nodes.map((node) => [positionKey(graph, node), layout[node.id]]));
}
export function useStoryPositions(
  graph: StoryGraph,
  packId: string,
  scenarioId: string,
): {
  positions: StoryPositions;
  savePosition: (id: string, position: { x: number; y: number }) => void;
  tidy: () => void;
} {
  const [storedPositions, setStoredPositions] = useState(() =>
    readStoryPositions(packId, scenarioId),
  );
  const [columnWidth, setColumnWidth] = useState(() => {
    try {
      const raw = localStorage.getItem(storageKey(packId, scenarioId));
      const value: unknown = raw ? JSON.parse(raw) : null;
      const savedWidth = value && typeof value === "object" && "$layoutWidth" in value
        ? value.$layoutWidth
        : undefined;
      return savedWidth === 280 || Object.keys(storedPositions).length === 0 ? 280 : 320;
    } catch {
      return Object.keys(storedPositions).length === 0 ? 280 : 320;
    }
  });
  const [rememberedPositions, setRememberedPositions] = useState<StoryPositions>(() => ({
    ...keyedLayout(graph, columnWidth),
    ...storedPositions,
  }));
  const positions = useMemo(() => {
    const next = { ...rememberedPositions };
    for (const node of graph.nodes) {
      const key = positionKey(graph, node);
      if (next[key]) continue;
      const rightmost = Math.max(-320, ...Object.values(next).map((position) => position.x));
      next[key] = { x: rightmost + 320, y: 0 };
    }
    return next;
  }, [graph, rememberedPositions]);

  useLayoutEffect(() => {
    setRememberedPositions((current) => {
      const missing = Object.entries(positions).filter(([id]) => !current[id]);
      return missing.length === 0 ? current : { ...current, ...Object.fromEntries(missing) };
    });
  }, [positions]);
  const visiblePositions = useMemo(
    () =>
      Object.fromEntries(graph.nodes.map((node) => [node.id, positions[positionKey(graph, node)]])),
    [graph, positions],
  );

  function savePosition(id: string, position: { x: number; y: number }): void {
    const next = { ...storedPositions, [id]: position };
    setStoredPositions(next);
    const node = graph.nodes.find((item) => item.id === id);
    const key = node ? positionKey(graph, node) : id;
    setRememberedPositions((current) => ({ ...current, [key]: position }));
    writeStoryPositions(packId, scenarioId, next, columnWidth);
  }

  function tidy(): void {
    clearStoryPositions(packId, scenarioId);
    setStoredPositions({});
    setColumnWidth(280);
    setRememberedPositions((current) => ({ ...current, ...keyedLayout(graph) }));
  }

  return {
    positions: visiblePositions,
    savePosition,
    tidy,
  };
}
