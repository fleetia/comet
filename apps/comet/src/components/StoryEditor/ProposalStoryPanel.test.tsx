import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ScenarioDefinition } from "../../types";
import { ProposalStoryPanel, type ProposalStage } from "./ProposalStoryPanel";

const proposal: ScenarioDefinition = {
  id: "one",
  title: "첫 이야기",
  centerId: "friend",
  participants: ["friend"],
  keywords: [],
  requiredFlags: [],
  minAffinity: 20,
  chapters: null,
  intro: [{ persona: "friend", expression: "평온", text: "함께 갈래?" }],
  accept: [],
  decline: [],
  ending: [],
  allowIncompleteRepeat: false,
  allowRepeat: false,
  completion: { setFlags: [], memoryTemplate: null },
};
const other = { ...proposal, id: "two", title: "두 번째 이야기" };

afterEach(cleanup);

function Panel({
  stage,
  onClose = vi.fn(),
}: {
  stage: ProposalStage;
  onClose?: () => void;
}): React.JSX.Element {
  const [scenario, setScenario] = useState(proposal);
  return (
    <ProposalStoryPanel
      scenario={scenario}
      stage={stage}
      actors={[]}
      scenarios={[scenario, other]}
      onChange={setScenario}
      onClose={onClose}
    />
  );
}

it("제안 대사를 편집하고 Enter로 같은 화자의 다음 대사를 만든다", () => {
  render(<Panel stage="intro" />);
  const first = screen.getByLabelText("제안 1 대사");
  fireEvent.change(first, { target: { value: "같이 놀래?" } });
  fireEvent.keyDown(first, { key: "Enter" });
  expect(screen.getByLabelText("제안 1 대사")).toHaveProperty("value", "같이 놀래?");
  expect(screen.getByLabelText("제안 2 대사")).toHaveProperty("value", "");
  expect(document.activeElement).toBe(screen.getByLabelText("제안 2 대사"));
  fireEvent.click(screen.getAllByText("펼치기")[1]);
  fireEvent.click(screen.getByText("삭제"));
  expect(screen.queryByLabelText("제안 2 대사")).toBeNull();
});

it("유보를 추가하고 노출 친밀도를 제한하며 삭제한다", () => {
  const onClose = vi.fn();
  function Editor(): React.JSX.Element {
    const [scenario, setScenario] = useState(proposal);
    const [stage, setStage] = useState<ProposalStage>("intro");
    return (
      <>
        <button onClick={() => setStage("defer")}>유보 열기</button>
        <ProposalStoryPanel
          scenario={scenario}
          stage={stage}
          actors={[]}
          scenarios={[scenario]}
          onChange={setScenario}
          onClose={onClose}
        />
      </>
    );
  }
  render(<Editor />);
  fireEvent.click(screen.getByText("유보 추가"));
  expect(screen.queryByText("유보 추가")).toBeNull();
  fireEvent.click(screen.getByText("유보 열기"));
  fireEvent.change(screen.getByLabelText("노출 친밀도"), { target: { value: "50" } });
  expect(screen.getByLabelText("노출 친밀도")).toHaveProperty("value", "20");
  fireEvent.click(screen.getByText("대사 추가"));
  expect(screen.getByLabelText("유보 1 대사")).toBeTruthy();
  fireEvent.click(screen.getByText("유보 삭제"));
  expect(onClose).toHaveBeenCalledOnce();
  expect(screen.queryByLabelText("유보 1 대사")).toBeNull();
});

it("마무리에서 같은 팩의 다음 이야기와 완료 효과를 편집한다", () => {
  render(<Panel stage="ending" />);
  fireEvent.change(screen.getByLabelText("이어질 이야기"), { target: { value: "two" } });
  fireEvent.change(screen.getByLabelText("완료 효과 · 남길 조건"), {
    target: { value: "visited" },
  });
  expect(screen.getByLabelText("이어질 이야기")).toHaveProperty("value", "two");
  expect(screen.getByLabelText("완료 효과 · 남길 조건")).toHaveProperty("value", "visited");
});
