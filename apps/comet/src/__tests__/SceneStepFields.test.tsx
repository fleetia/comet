import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { SceneStepFields } from "../components/CharacterEditor/SceneStepFields";
import { PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";
import type { ScenarioStep } from "../types";

afterEach(cleanup);

it.each([false, true])(
  "handles the saved-name line when changing input kind (panel: %s)",
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
    const result = onChange.mock.calls[0][0];
    if (showSaved) {
      expect(result).not.toHaveProperty("saved");
    } else {
      expect(result.saved).toEqual(saved);
    }
  },
);
