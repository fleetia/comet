import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToyTool } from "./ToyTools";
import type { WidgetView } from "../types";
import { PREVIEW_SNAPSHOT } from "../../hooks/useSnapshot";

afterEach(cleanup);

function toyWidget(kind: string): WidgetView {
  return {
    id: kind,
    kind,
    reaction: true,
    revision: 1,
    version: 1,
    data: {},
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
  };
}

it.each([
  ["heads", "tails", "앞면 / 뒷면"],
  ["scissors", "rock", "가위 / 바위"],
  ["paper", "scissors", "보 / 가위"],
  ["6", "3", "6 / 3"],
])("preserves saved outcomes %s and %s while switching one game at a time", (a, b, _label) => {
  const act = vi.fn().mockResolvedValue(true);
  const widget: WidgetView = {
    ...toyWidget("small-match"),
    data: { a, b, result: "무승부" },
  };
  render(<ToyTool widget={widget} act={act} />);
  expect(screen.getByRole("status").textContent).toBe("무승부");
  fireEvent.click(screen.getByRole("button", { name: "같이 놀기" }));
  fireEvent.click(screen.getByRole("button", { name: "동전 던지기" }));
  fireEvent.click(screen.getByRole("button", { name: "앞면" }));
  expect(act).toHaveBeenLastCalledWith("coin", { choice: "heads" });
  fireEvent.click(screen.getByRole("button", { name: "같이 놀기" }));
  fireEvent.click(screen.getByRole("button", { name: "가위바위보 놀이" }));
  fireEvent.click(screen.getByRole("button", { name: "가위" }));
  expect(act).toHaveBeenLastCalledWith("rps", { choice: "scissors" });
});

it("preserves a legacy result and reaches all three game actions through the play menu", () => {
  const act = vi.fn().mockResolvedValue(true);
  const widget: WidgetView = {
    ...toyWidget("small-match"),
    data: { game: "legacy", a: "3", b: "5", result: "  저장한 결과\n그대로  " },
  };
  render(<ToyTool widget={widget} act={act} />);
  expect(screen.getByRole("status").textContent).toBe("  저장한 결과\n그대로  ");
  fireEvent.click(screen.getByRole("button", { name: "주사위 굴리기" }));
  expect(act).toHaveBeenLastCalledWith("dice", {});
  fireEvent.click(screen.getByRole("button", { name: "같이 놀기" }));
  fireEvent.click(screen.getByRole("button", { name: "동전 던지기" }));
  fireEvent.click(screen.getByRole("button", { name: "뒷면" }));
  expect(act).toHaveBeenLastCalledWith("coin", { choice: "tails" });
  fireEvent.click(screen.getByRole("button", { name: "같이 놀기" }));
  fireEvent.click(screen.getByRole("button", { name: "가위바위보 놀이" }));
  fireEvent.click(screen.getByRole("button", { name: "보" }));
  expect(act).toHaveBeenLastCalledWith("rps", { choice: "paper" });
});

it("keeps the selected companion while following current roster slots", () => {
  const act = vi.fn().mockResolvedValue(true);
  const installed = PREVIEW_SNAPSHOT.characters.installed.slice(0, 2).map((character, index) => ({
    ...character,
    definition: { ...character.definition, name: index === 0 ? "별꼬리" : "나디르" },
  }));
  const first = installed[0].id;
  const second = installed[1].id;
  let characters = { installed, active: [first] };
  function roster(active: string[]): void {
    characters = { installed, active };
  }
  const widget: WidgetView = {
    ...toyWidget("interaction"),
    data: { snacks: 6, touches: 0 },
  };
  roster([first]);
  const view = render(<ToyTool widget={widget} act={act} characters={characters} />);
  expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual(["A · 별꼬리"]);
  fireEvent.click(screen.getByRole("button", { name: "쓰다듬기" }));
  expect(act).toHaveBeenLastCalledWith("stroke", { character: "A", owner: first });
  roster([first, second]);
  view.rerender(<ToyTool widget={widget} act={act} characters={characters} />);
  fireEvent.change(screen.getByRole("combobox", { name: "함께할 캐릭터" }), {
    target: { value: "B" },
  });
  fireEvent.click(screen.getByRole("button", { name: "간식 나누기" }));
  expect(act).toHaveBeenLastCalledWith("snack", { character: "B", owner: second });
  roster([second, first]);
  view.rerender(<ToyTool widget={widget} act={act} characters={characters} />);
  expect(screen.getByRole("combobox", { name: "함께할 캐릭터" })).toHaveProperty("value", "A");
  fireEvent.click(screen.getByRole("button", { name: "콕 찌르기" }));
  expect(act).toHaveBeenLastCalledWith("poke", { character: "A", owner: second });
  roster([first]);
  view.rerender(<ToyTool widget={widget} act={act} characters={characters} />);
  expect(screen.queryByRole("option", { name: /나디르/ })).toBeNull();
  expect(screen.getByRole("combobox", { name: "함께할 캐릭터" })).toHaveProperty("value", "A");
});

it.each([
  { draws: 0, storedText: "가상 장난 운세입니다.", expected: "운세를 뽑으면 여기에 보여요." },
  { draws: 1, storedText: "  오늘의 운세\n그대로  ", expected: "  오늘의 운세\n그대로  " },
  {
    draws: undefined,
    storedText: "가상 장난 운세입니다.",
    expected: "운세를 뽑으면 여기에 보여요.",
  },
  { draws: undefined, storedText: "  원본 운세\n그대로  ", expected: "  원본 운세\n그대로  " },
])(
  "shows fortune guidance from draw count while preserving results ($draws)",
  ({ draws, storedText, expected }) => {
    const act = vi.fn().mockResolvedValue(true);
    const widget: WidgetView = {
      ...toyWidget("fortune"),
      data: { text: storedText, ...(draws === undefined ? {} : { draws }) },
    };
    render(<ToyTool widget={widget} act={act} />);
    expect(screen.getByRole("status").textContent).toBe(expected);
    fireEvent.click(screen.getByRole("button", { name: "운세 뽑기" }));
    expect(act).toHaveBeenCalledWith("draw", {});
  },
);

it("disables targeted interaction until a companion is available", () => {
  const act = vi.fn().mockResolvedValue(true);
  const widget: WidgetView = {
    ...toyWidget("interaction"),
    data: { snacks: 6 },
  };
  const view = render(<ToyTool widget={widget} act={act} />);
  expect(screen.getByRole("button", { name: "쓰다듬기" })).toHaveProperty("disabled", true);
  view.rerender(<ToyTool widget={widget} act={act} characters={{ installed: [], active: [] }} />);
  expect(screen.getByRole("option", { name: "함께 지내는 캐릭터가 없어요" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "간식 나누기" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "쓰다듬기" }));
  expect(act).not.toHaveBeenCalled();
});

it("starts with the play selector and renders only the chosen game balloon", () => {
  render(<ToyTool widget={toyWidget("small-match")} act={vi.fn().mockResolvedValue(true)} />);
  expect(screen.queryByText("주사위 한 판이에요.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "동전 던지기" }));
  expect(screen.getByText("앞면? 뒷면? 골라 봐요.")).toBeTruthy();
  expect(screen.queryByText("가위바위보!")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "같이 놀기" }));
  expect(screen.queryByText("앞면? 뒷면? 골라 봐요.")).toBeNull();
});

it("follows a game picked from the character menu while the window is open", () => {
  const act = vi.fn().mockResolvedValue(true);
  const view = render(<ToyTool widget={toyWidget("small-match")} act={act} />);
  expect(screen.queryByText("앞면? 뒷면? 골라 봐요.")).toBeNull();
  view.rerender(
    <ToyTool
      widget={{ ...toyWidget("small-match"), revision: 2, data: { game: "coin" } }}
      act={act}
    />,
  );
  expect(screen.getByText("앞면? 뒷면? 골라 봐요.")).toBeTruthy();
  expect(act).not.toHaveBeenCalled();
});

it("routes game and fortune actions to the selected companion identity", () => {
  const act = vi.fn().mockResolvedValue(true);
  const characters = {
    ...PREVIEW_SNAPSHOT.characters,
    active: PREVIEW_SNAPSHOT.characters.installed.slice(0, 2).map((item) => item.id),
  };
  const second = characters.active[1];
  const view = render(
    <ToyTool
      widget={{ ...toyWidget("small-match"), data: { game: "dice" } }}
      act={act}
      characters={characters}
    />,
  );
  fireEvent.change(screen.getByRole("combobox", { name: "함께할 캐릭터" }), {
    target: { value: second },
  });
  fireEvent.click(screen.getByRole("button", { name: "주사위 굴리기" }));
  expect(act).toHaveBeenLastCalledWith("dice", { character: "B", owner: second });
  view.rerender(<ToyTool widget={toyWidget("fortune")} act={act} characters={characters} />);
  fireEvent.change(screen.getByRole("combobox", { name: "함께할 캐릭터" }), {
    target: { value: second },
  });
  fireEvent.click(screen.getByRole("button", { name: "운세 뽑기" }));
  expect(act).toHaveBeenLastCalledWith("draw", { character: "B", owner: second });
});
