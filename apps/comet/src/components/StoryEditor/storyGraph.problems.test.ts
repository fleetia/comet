import { describe, expect, it } from "vitest";
import type { ScenarioChapter, ScenarioDefinition } from "../../types";
import { findStoryProblems } from "./storyGraph";

function scenario(chapters: ScenarioChapter[]): ScenarioDefinition {
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

function chapter(id: string, next: string, choices: string[] = []): ScenarioChapter {
  return {
    id,
    title: id,
    next,
    steps: choices.length
      ? [{
          kind: "choice",
          persona: "actor",
          expression: "평온",
          prompt: "?",
          options: [
            { id: "continue", label: "계속", goto: "next" },
            ...choices.map((target) => ({ id: target, label: target, goto: target })),
          ],
        }]
      : [],
  };
}

describe("findStoryProblems의 도달 불가 원인", () => {
  it("끊긴 경로의 첫 장만 표시하고 뒤따르는 장과 순환은 표시하지 않는다", () => {
    const problems = findStoryProblems(scenario([
      chapter("start", "end"),
      chapter("root", "following"),
      chapter("following", "cycle-a"),
      chapter("cycle-a", "cycle-b"),
      chapter("cycle-b", "cycle-a"),
    ]));

    expect(problems.filter((problem) => problem.kind.startsWith("unreachable"))).toEqual([
      { chapterId: "root", kind: "unreachable", blocking: false },
    ]);
  });

  it("진입할 수 없는 순환 묶음마다 대표 장 한 개만 표시한다", () => {
    const problems = findStoryProblems(scenario([
      chapter("start", "reachable-a"),
      chapter("reachable-a", "reachable-b"),
      chapter("reachable-b", "reachable-a"),
      chapter("cycle-a", "cycle-b", ["later-a"]),
      chapter("cycle-b", "cycle-a"),
      chapter("later-a", "later-b"),
      chapter("later-b", "later-a"),
      chapter("self", "self"),
    ]));

    expect(problems.filter((problem) => problem.kind.startsWith("unreachable"))).toEqual([
      { chapterId: "cycle-a", kind: "unreachable-cycle", blocking: false },
      { chapterId: "self", kind: "unreachable-cycle", blocking: false },
    ]);
  });

  it("저장을 막는 문제와 도달 불가 경고를 구분한다", () => {
    const problems = findStoryProblems(scenario([
      chapter("start", "", ["missing", "empty"]),
      chapter("missing", "absent"),
      {
        ...chapter("empty", "end"),
        steps: [{ kind: "line", persona: "actor", expression: "평온", text: "  " }],
      },
      chapter("orphan", "end"),
    ]));

    expect(problems).toEqual([
      { chapterId: "start", kind: "missing-exit", blocking: true },
      { chapterId: "missing", kind: "missing-chapter", blocking: true },
      { chapterId: "empty", kind: "empty-line", blocking: true },
      { chapterId: "orphan", kind: "unreachable", blocking: false },
    ]);
  });
});
