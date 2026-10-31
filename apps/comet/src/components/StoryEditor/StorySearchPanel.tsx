import { useState, type JSX } from "react";
import { Button, TextInput } from "@comet/ui";
import type { ScenarioDefinition } from "../../types";
import type { ProposalStage } from "./ProposalStoryPanel";
import * as s from "./storyEditor.css";

type SearchResult = { chapterId: string; title: string; text: string; stepIndex?: number };

function searchStory(scenario: ScenarioDefinition, query: string): SearchResult[] {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const results: SearchResult[] = [];
  const add = (chapterId: string, title: string, text: string, stepIndex?: number): void => {
    if (text.toLocaleLowerCase().includes(needle))
      results.push({ chapterId, title, text, stepIndex });
  };
  if (scenario.chapters != null) {
    for (const chapter of scenario.chapters) {
      const title = chapter.title || "새 장";
      add(chapter.id, title, chapter.title);
      chapter.steps.forEach((step, index) => {
        if (step.kind === "line") add(chapter.id, title, step.text, index);
        if (step.kind === "ask" || step.kind === "choice") {
          add(chapter.id, title, step.prompt, index);
        }
        if (step.kind === "ask" && step.input === "name") {
          if (step.known) add(chapter.id, title, step.known, index);
          if (step.saved) add(chapter.id, title, step.saved.text, index);
        }
        if (step.kind === "choice") {
          step.options.forEach((option) => add(chapter.id, title, option.label, index));
        }
        if (step.kind === "wait") {
          step.onTimeout.steps.forEach((child) => {
            if (child.kind === "line") add(chapter.id, title, child.text, index);
          });
        }
      });
    }
  } else {
    const stages: [ProposalStage, string][] = [
      ["defer", "유보"],
      ["intro", "제안"],
      ["accept", "수락"],
      ["decline", "거절"],
      ["ending", "마무리"],
    ];
    for (const [stage, title] of stages) {
      if (stage === "defer" && scenario.revealAffinity == null && !scenario.defer?.length) continue;
      add(stage, title, title);
      scenario[stage]?.forEach((line, index) => add(stage, title, line.text, index));
    }
  }
  return results;
}

export function StorySearchPanel({
  scenario,
  onSelect,
  onClose,
}: {
  scenario: ScenarioDefinition;
  onSelect: (result: SearchResult) => void;
  onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState("");
  const results = searchStory(scenario, query);
  return (
    <aside className={s.problemsPanel} aria-label="찾기">
      <div className={s.problemsHeader}>
        <strong>찾기</strong>
        <Button variant="ghost" onClick={onClose}>
          닫기
        </Button>
      </div>
      <TextInput
        fill
        aria-label="이야기에서 찾기"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {query.trim() && <p>{results.length}곳</p>}
      <ul className={s.problemsList}>
        {results.map((result, index) => (
          <li key={`${result.chapterId}:${result.stepIndex ?? "title"}:${index}`}>
            <button type="button" onClick={() => onSelect(result)}>
              <strong>{result.title}</strong>
              <span>{result.text}</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
