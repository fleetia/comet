import { afterEach, expect, it, vi } from "vitest";
import { act as reactAct, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToyTool } from "./ToyTools";
import type { WidgetView } from "../types";
import { PREVIEW_SNAPSHOT } from "../../hooks/useSnapshot";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function collection(
  decorations: { id: number; itemId: string; x: number; y: number }[],
): WidgetView {
  return {
    id: "collection",
    kind: "collection",
    installed: true,
    enabled: true,
    revision: 1,
    version: 1,
    data: { items: [{ itemId: "sock", name: "양말", quantity: 1 }], decorations },
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
  };
}

it("moves the focused decoration with arrow keys within the existing position bounds", () => {
  const act = vi.fn().mockResolvedValue(true);
  render(<ToyTool widget={collection([{ id: 1, itemId: "sock", x: 98, y: 2 }])} act={act} />);
  const decoration = screen.getByRole("button", { name: "양말 소품 선택" });
  fireEvent.keyDown(decoration, { key: "ArrowRight" });
  expect(act).toHaveBeenLastCalledWith("move", { id: 1, x: 100, y: 2 });
  expect(screen.getByRole("button", { name: "양말 소품 선택", pressed: true })).toBeTruthy();
  fireEvent.keyDown(decoration, { key: "ArrowUp" });
  expect(act).toHaveBeenLastCalledWith("move", { id: 1, x: 98, y: 0 });
  fireEvent.keyDown(decoration, { key: "Enter" });
  expect(act).toHaveBeenCalledTimes(2);
});

it("restores decoration focus lost during a move so arrow keys can continue", async () => {
  let finish: ((value: boolean) => void) | undefined;
  let frame: FrameRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  const act = vi.fn(
    () =>
      new Promise<boolean>((resolve) => {
        finish = resolve;
      }),
  );
  const widget = collection([{ id: 1, itemId: "sock", x: 50, y: 50 }]);
  const view = render(
    <fieldset>
      <ToyTool widget={widget} act={act} />
    </fieldset>,
  );
  const control = screen.getByRole("button", { name: "양말 소품 선택" });
  control.focus();
  fireEvent.keyDown(control, { key: "ArrowLeft" });
  // Model WebKit moving focus to the body when the containing fieldset is disabled.
  control.blur();
  view.rerender(
    <fieldset disabled>
      <ToyTool widget={widget} act={act} />
    </fieldset>,
  );
  expect(document.activeElement).toBe(document.body);
  view.rerender(
    <fieldset>
      <ToyTool widget={collection([{ id: 1, itemId: "sock", x: 45, y: 50 }])} act={act} />
    </fieldset>,
  );
  await reactAct(async () => finish?.(true));
  expect(frame).toBeTypeOf("function");
  frame?.(0);
  expect(document.activeElement).toBe(control);
  fireEvent.keyDown(control, { key: "ArrowUp" });
  expect(act).toHaveBeenLastCalledWith("move", { id: 1, x: 45, y: 45 });
});

it.each(["another control", "removed decoration"])(
  "does not restore decoration focus after a move when focus belongs to %s",
  async (destination) => {
    let finish: ((value: boolean) => void) | undefined;
    let frame: FrameRequestCallback | undefined;
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      frame = callback;
      return 1;
    });
    const act = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    const view = render(
      <>
        <ToyTool widget={collection([{ id: 1, itemId: "sock", x: 50, y: 50 }])} act={act} />
        <button>다른 조작</button>
      </>,
    );
    const control = screen.getByRole("button", { name: "양말 소품 선택" });
    control.focus();
    fireEvent.keyDown(control, { key: "ArrowLeft" });
    if (destination === "another control") {
      screen.getByRole("button", { name: "다른 조작" }).focus();
    } else {
      view.rerender(
        <>
          <ToyTool widget={collection([])} act={act} />
          <button>다른 조작</button>
        </>,
      );
    }
    const focus = vi.spyOn(control, "focus");
    const active = document.activeElement;
    await reactAct(async () => finish?.(true));
    expect(frame).toBeTypeOf("function");
    frame?.(0);
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(active);
  },
);

it("removes movement controls when the selected decoration is put away", () => {
  const act = vi.fn().mockResolvedValue(true);
  const view = render(
    <ToyTool widget={collection([{ id: 1, itemId: "sock", x: 50, y: 50 }])} act={act} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "양말 소품 선택" }));
  expect(screen.getByRole("button", { name: "선택한 소품 가운데로" })).toBeTruthy();
  view.rerender(<ToyTool widget={collection([])} act={act} />);
  expect(screen.queryByRole("button", { name: "선택한 소품 가운데로" })).toBeNull();
  fireEvent.pointerUp(screen.getByRole("group", { name: "수집품 배치" }));
  expect(act).not.toHaveBeenCalled();
});

it.each([
  ["heads", "tails", "앞면 / 뒷면"],
  ["scissors", "rock", "가위 / 바위"],
  ["paper", "scissors", "보 / 가위"],
  ["6", "3", "6 / 3"],
])("labels small-match outcomes %s and %s without changing action values", (a, b, label) => {
  const act = vi.fn().mockResolvedValue(true);
  const widget: WidgetView = {
    ...collection([]),
    id: "small-match",
    kind: "small-match",
    data: { a, b, result: "무승부" },
  };
  render(<ToyTool widget={widget} act={act} />);
  expect(screen.getByText(label)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "앞면" }));
  expect(act).toHaveBeenLastCalledWith("coin", { choice: "heads" });
  fireEvent.click(screen.getByRole("button", { name: "가위" }));
  expect(act).toHaveBeenLastCalledWith("rps", { choice: "scissors" });
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
    ...collection([]),
    id: "interaction",
    kind: "interaction",
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
      ...collection([]),
      id: "fortune",
      kind: "fortune",
      data: { text: storedText, ...(draws === undefined ? {} : { draws }) },
    };
    render(<ToyTool widget={widget} act={act} />);
    expect(screen.getByRole("status").textContent).toBe(expected);
    fireEvent.click(screen.getByRole("button", { name: "운세 뽑기" }));
    expect(act).toHaveBeenCalledWith("draw");
  },
);

it("disables targeted interaction until a companion is available", () => {
  const act = vi.fn().mockResolvedValue(true);
  const widget: WidgetView = {
    ...collection([]),
    id: "interaction",
    kind: "interaction",
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
