import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StoryPanel } from "../components/StoryEditor/StoryPanel";
import { PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";
import type { ScenarioDefinition } from "../types";

const actor = PREVIEW_SNAPSHOT.characters.installed[0].definition;
const initial: ScenarioDefinition = {
  id: "story",
  title: "이야기",
  centerId: actor.sourceId,
  participants: [actor.sourceId],
  keywords: [],
  requiredFlags: [],
  minAffinity: 0,
  allowIncompleteRepeat: false,
  allowRepeat: false,
  completion: { setFlags: [], memoryTemplate: null },
  chapters: [
    {
      id: "chapter",
      title: "첫 장",
      steps: [{ kind: "line", persona: actor.sourceId, expression: "평온", text: "" }],
    },
  ],
};
function Harness(): React.JSX.Element {
  const [scenario, setScenario] = useState(initial);
  return (
    <StoryPanel
      scenario={scenario}
      chapterId="chapter"
      actors={[actor]}
      onChange={setScenario}
      onClose={() => {}}
      onCreateChapter={() => {}}
      onDeleteChapter={() => {}}
      onSetStart={() => {}}
    />
  );
}
afterEach(cleanup);

it("대사에서 Enter는 다음 줄을 만들고 Shift+Enter는 줄바꿈을 넣는다", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  const first = screen.getByLabelText("단계 1 대사");
  expect(document.activeElement).toBe(first);
  await user.type(first, "첫 줄{shift>}{enter}{/shift}둘째 줄");
  expect((first as HTMLTextAreaElement).value).toBe("첫 줄\n둘째 줄");
  await user.keyboard("{Enter}");
  expect(screen.getByLabelText("단계 2 대사")).toBeTruthy();
  expect(document.activeElement).toBe(screen.getByLabelText("단계 2 대사"));
});

it("빈 대사의 / 메뉴에서 입력 단계를 추가하고 이름 저장 후 대사를 쓴다", async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await user.keyboard("/");
  await user.click(screen.getByRole("menuitem", { name: "입력" }));
  const kind = screen.getByLabelText("단계 1 입력 종류");
  fireEvent.change(kind, { target: { value: "name" } });
  fireEvent.change(screen.getByLabelText("단계 1 이름을 알 때 대사"), {
    target: { value: "다시 만났네" },
  });
  await user.click(screen.getByRole("button", { name: "이름을 저장한 뒤 대사 추가" }));
  const saved = screen.getByLabelText("단계 1 이름을 저장한 뒤 대사") as HTMLTextAreaElement;
  await user.type(saved, "반가워");
  expect(saved.value).toBe("반가워");
});

it("선택지와 시간이 지난 뒤 이어질 장을 바꾸고 연결을 끊는다", () => {
  function Links(): React.JSX.Element {
    const [scenario, setScenario] = useState<ScenarioDefinition>({
      ...initial,
      chapters: [
        {
          id: "chapter",
          title: "첫 장",
          next: "other",
          steps: [
            {
              kind: "choice",
              persona: actor.sourceId,
              expression: "평온",
              prompt: "선택해요",
              options: [{ id: "yes", label: "좋아요", goto: "next" }],
            },
            {
              kind: "wait",
              event: "body.clicked",
              timeoutSec: 90,
              onTimeout: { steps: [], then: "next" },
            },
          ],
        },
        { id: "other", title: "둘째 장", next: "end", steps: [] },
      ],
    });
    return (
      <>
        <StoryPanel
          scenario={scenario}
          chapterId="chapter"
          actors={[actor]}
          onChange={setScenario}
          onClose={() => {}}
          onCreateChapter={() => {}}
          onDeleteChapter={() => {}}
          onSetStart={() => {}}
        />
        <output data-testid="draft">{JSON.stringify(scenario.chapters)}</output>
      </>
    );
  }
  render(<Links />);
  fireEvent.change(screen.getByLabelText("좋아요 이어질 장"), { target: { value: "other" } });
  fireEvent.change(screen.getByLabelText("시간이 지나면 이어질 장"), {
    target: { value: "other" },
  });
  fireEvent.change(screen.getByLabelText("다음 장"), { target: { value: "" } });
  const chapters = JSON.parse(screen.getByTestId("draft").textContent ?? "[]");
  expect(chapters[0].steps[0].options[0].goto).toBe("other");
  expect(chapters[0].steps[1].onTimeout.then).toBe("other");
  expect(chapters[0].next).toBe("");
  expect(screen.getByLabelText("다음 장")).toHaveProperty("value", "");
});
