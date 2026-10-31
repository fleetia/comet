import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SceneStepFields } from "../components/CharacterEditor/SceneStepFields";
import { PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";
import type { ScenarioStep } from "../types";

afterEach(cleanup);

it.each([false, true])(
  "removes the saved-name line when changing input kind to text (panel: %s)",
  (showSaved) => {
    const actor = PREVIEW_SNAPSHOT.characters.installed[0].definition;
    const saved = { expression: "평온", text: "반가워" };
    const step: ScenarioStep = {
      kind: "ask",
      id: "name",
      persona: actor.sourceId,
      expression: "평온",
      prompt: "이름이 뭐야?",
      input: "name",
      known: "다시 만났네",
      saved,
    };
    const onChange = vi.fn();
    render(
      <SceneStepFields
        step={step}
        label="단계 1"
        definitions={[actor]}
        chapters={[]}
        onChange={onChange}
        showSaved={showSaved}
      />,
    );
    fireEvent.change(screen.getByLabelText("단계 1 입력 종류"), { target: { value: "text" } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ input: "text", known: null }));
    expect(onChange.mock.calls[0][0]).not.toHaveProperty("saved");
  },
);

it("edits and retains an optional wait appearance when the event changes", () => {
  const actor = PREVIEW_SNAPSHOT.characters.installed[0].definition;
  const step: ScenarioStep = {
    kind: "wait", event: "body.clicked", timeoutSec: 60,
    appearance: { persona: actor.sourceId, expression: "평온", motion: { mode: "static" } },
    onTimeout: { steps: [], then: "next" },
  };
  const onChange = vi.fn();
  render(<SceneStepFields step={step} label="단계 1" definitions={[actor]} chapters={[]} onChange={onChange} />);
  expect((screen.getByLabelText("단계 1 표정") as HTMLSelectElement).value).toBe("평온");
  expect((screen.getByLabelText("단계 1 동작") as HTMLSelectElement).value).toBe("static");
  fireEvent.change(screen.getByLabelText("단계 1 기다릴 이벤트"), { target: { value: "body.moved" } });
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ event: "body.moved", appearance: step.appearance }));
  fireEvent.change(screen.getByLabelText("단계 1 대기 표정 화자"), { target: { value: "" } });
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ appearance: undefined }));
});
