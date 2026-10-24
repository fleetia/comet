import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CharacterOrbit } from "./CharacterOrbit";
import { PREVIEW_SNAPSHOT } from "../../previewSnapshot";

const base = { name: "별꼬리", paused: false, sleeping: false, busy: false };
let previousMotion: string | undefined;
beforeEach(() => {
  previousMotion = document.documentElement.dataset.cometMotion;
  document.documentElement.dataset.cometMotion = "reduced";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  if (previousMotion === undefined) delete document.documentElement.dataset.cometMotion;
  else document.documentElement.dataset.cometMotion = previousMotion;
});

it("preserves the main DOM and fans interaction and pause choices from their parent nodes", async () => {
  const action = vi.fn();
  const view = render(<CharacterOrbit {...base} onAction={action} onClose={vi.fn()} />);
  const chat = screen.getByRole("button", { name: "말 걸기" });
  const marker = view.container.querySelector("[data-character-orbit-anchor]");
  const interact = screen.getByRole("button", { name: "교감" });
  fireEvent.click(interact);
  expect(screen.getByRole("button", { name: "말 걸기" })).toBe(chat);
  expect(interact.getAttribute("aria-expanded")).toBe("true");
  expect(view.container.firstElementChild?.getAttribute("style")).toContain("width: 600px");
  fireEvent.click(screen.getByRole("button", { name: "간식 주기" }));
  expect(action).toHaveBeenCalledExactlyOnceWith("snack");
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "자동 잡담 쉬기" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "자동 잡담 쉬기" }));
  expect(screen.getByRole("group", { name: "별꼬리 교감" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "말 걸기" })).toBe(chat);
  expect(view.container.querySelector("[data-character-orbit-anchor]")).toBe(marker);
  expect(view.container.firstElementChild?.getAttribute("style")).toContain("width: 640px");
  fireEvent.click(screen.getByRole("button", { name: "자동 잡담 쉬기 접기" }));
  await waitFor(() =>
    expect(view.container.querySelector('[data-character-orbit-branch="pause"]')).toBeNull(),
  );
  expect(document.activeElement).toBe(screen.getByRole("button", { name: "자동 잡담 쉬기" }));
  fireEvent.click(screen.getByRole("button", { name: "교감 접기" }));
  await waitFor(() => expect(screen.queryByRole("group", { name: "별꼬리 교감" })).toBeNull());
  expect(screen.getByRole("button", { name: "말 걸기" })).toBe(chat);
  expect(document.activeElement).toBe(interact);
  fireEvent.click(screen.getByRole("button", { name: "설정" }));
  await waitFor(() => expect(action).toHaveBeenLastCalledWith("settings"));
});

it("locks orbit actions while the previous action is pending", () => {
  const action = vi.fn();
  render(<CharacterOrbit {...base} busy onAction={action} onClose={vi.fn()} />);
  const chat = screen.getByRole("button", { name: "말 걸기" });
  expect(chat).toHaveProperty("disabled", true);
  fireEvent.click(chat);
  expect(action).not.toHaveBeenCalled();
});

it("reserves a hidden character anchor without cloning the sprite or fallback", () => {
  const props = {
    ...base,
    character: PREVIEW_SNAPSHOT.characters.installed[0],
    onAction: vi.fn(),
    onClose: vi.fn(),
  };
  const view = render(<CharacterOrbit {...props} />);
  const marker = view.container.querySelector("[data-character-orbit-anchor]");
  expect(marker?.getAttribute("aria-hidden")).toBe("true");
  expect(marker?.childNodes).toHaveLength(0);
  expect(view.container.querySelector("img")).toBeNull();
  expect(screen.queryByText("(・_・)")).toBeNull();
  view.rerender(<CharacterOrbit {...props} anchor={{ x: 24, y: 400 }} />);
  expect(view.container.querySelector("[data-orbit-body-ring]")?.getAttribute("cx")).toBe("24");
  expect(view.container.querySelector("[data-orbit-body-ring]")?.getAttribute("cy")).toBe("400");
  expect(view.container.querySelector("[data-character-orbit-anchor]")).toBe(marker);
});

it("keeps the measurement marker available before native placement is ready", () => {
  const props = { ...base, onAction: vi.fn(), onClose: vi.fn() };
  const view = render(<CharacterOrbit {...props} ready={false} />);
  const marker = view.container.querySelector("[data-character-orbit-anchor]");
  expect(marker).not.toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
  view.rerender(<CharacterOrbit {...props} ready />);
  expect(view.container.querySelector("[data-character-orbit-anchor]")).toBe(marker);
  expect(screen.getByRole("button", { name: "말 걸기" })).toBeTruthy();
  expect(screen.queryByRole("navigation", { name: "궤도 위치" })).toBeNull();
});

it("returns through window Escape from child to main before closing", async () => {
  const close = vi.fn();
  render(<CharacterOrbit {...base} onAction={vi.fn()} onClose={close} />);
  fireEvent.click(screen.getByRole("button", { name: "교감" }));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole("group", { name: "별꼬리 교감" })).toBeNull());
  expect(screen.getByRole("group", { name: "별꼬리 함께하기" })).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
});

it("ignores composing/consumed Escape and cleans up the window listener", async () => {
  const close = vi.fn();
  const view = render(<CharacterOrbit {...base} onAction={vi.fn()} onClose={close} />);
  fireEvent.click(screen.getByRole("button", { name: "교감" }));
  fireEvent.click(screen.getByRole("button", { name: "자동 잡담 쉬기" }));
  fireEvent.keyDown(window, { key: "Escape", isComposing: true });
  const consumed = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
  consumed.preventDefault();
  fireEvent(window, consumed);
  expect(screen.getByRole("button", { name: "1시간" })).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() => expect(screen.queryByRole("button", { name: "1시간" })).toBeNull());
  expect(screen.getByRole("group", { name: "별꼬리 교감" })).toBeTruthy();
  expect(close).not.toHaveBeenCalled();
  view.unmount();
  const afterUnmount = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
  fireEvent(window, afterUnmount);
  expect(afterUnmount.defaultPrevented).toBe(false);
  expect(close).not.toHaveBeenCalled();
});

it("applies pause choices after the child folds, keeping both parent groups", async () => {
  const action = vi.fn();
  const props = { ...base, onAction: action, onClose: vi.fn() };
  const view = render(<CharacterOrbit {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "교감" }));
  fireEvent.click(screen.getByRole("button", { name: "자동 잡담 쉬기" }));
  fireEvent.click(screen.getByRole("button", { name: "1시간" }));
  await waitFor(() => expect(action).toHaveBeenCalledExactlyOnceWith("pause-hour"));
  expect(screen.getByRole("button", { name: "말 걸기" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "별꼬리 교감" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "자동 잡담 쉬기" }));
  fireEvent.click(screen.getByRole("button", { name: "다시 시작할 때까지" }));
  await waitFor(() => expect(action).toHaveBeenLastCalledWith("pause-restart"));
  view.rerender(<CharacterOrbit {...props} paused />);
  fireEvent.click(screen.getByRole("button", { name: "다시 시작" }));
  expect(action).toHaveBeenLastCalledWith("pause");
});

it("ignores an initial closeRequest and restores a menu when an external close fails", async () => {
  const close = vi.fn().mockResolvedValue(false);
  const props = { ...base, onAction: vi.fn(), onClose: close };
  const view = render(<CharacterOrbit {...props} closeRequest={4} />);
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "교감" }));
  view.rerender(<CharacterOrbit {...props} closeRequest={5} />);
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "말 걸기" })).toHaveProperty("disabled", false),
  );
  expect(screen.queryByRole("group", { name: "별꼬리 교감" })).toBeNull();
  view.rerender(<CharacterOrbit {...props} closeRequest={5} />);
  expect(close).toHaveBeenCalledOnce();
});

it("restores the menu after a failed action and prevents duplicate submissions", async () => {
  let resolve: (value: boolean) => void = () => {};
  const action = vi.fn(
    () =>
      new Promise<boolean>((done) => {
        resolve = done;
      }),
  );
  render(<CharacterOrbit {...base} onAction={action} onClose={vi.fn()} />);
  const settings = screen.getByRole("button", { name: "설정" });
  fireEvent.click(settings);
  fireEvent.click(settings);
  await waitFor(() => expect(action).toHaveBeenCalledExactlyOnceWith("settings"));
  await act(async () => resolve(false));
  expect(screen.getByRole("button", { name: "설정" })).toHaveProperty("disabled", false);
});

describe("full exit motion", () => {
  beforeEach(() => {
    delete document.documentElement.dataset.cometMotion;
    vi.useFakeTimers();
  });
  it("folds pause then interaction then main before invoking the action, within one second", async () => {
    const action = vi.fn();
    const view = render(<CharacterOrbit {...base} onAction={action} onClose={vi.fn()} />);
    const main = screen.getByRole("button", { name: "말 걸기" });
    fireEvent.click(screen.getByRole("button", { name: "교감" }));
    fireEvent.click(screen.getByRole("button", { name: "자동 잡담 쉬기" }));
    // Let the entrance settle before checking the complete reverse sequence.
    await act(async () => vi.advanceTimersByTimeAsync(1200));
    const exitStarted = Date.now();
    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    expect(action).not.toHaveBeenCalled();
    expect(main).toHaveProperty("disabled", true);
    expect(
      view.container.querySelector('[data-character-orbit-branch="interaction"]'),
    ).not.toBeNull();
    await act(async () => vi.advanceTimersToNextTimerAsync());
    expect(view.container.querySelector('[data-character-orbit-branch="pause"]')).toBeNull();
    expect(action).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersToNextTimerAsync());
    expect(view.container.querySelector('[data-character-orbit-branch="interaction"]')).toBeNull();
    expect(action).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersToNextTimerAsync());
    expect(action).toHaveBeenCalledExactlyOnceWith("settings");
    expect(Date.now() - exitStarted).toBeLessThanOrEqual(1000);
  });
  it("cancels the delayed action when the menu unmounts during exit", async () => {
    const action = vi.fn();
    const view = render(<CharacterOrbit {...base} onAction={action} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "설정" }));
    view.unmount();
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    expect(action).not.toHaveBeenCalled();
  });
});

describe("같이 놀기", () => {
  it("fans games, then toys, and closes the menu when a game opens", async () => {
    const action = vi.fn();
    const view = render(<CharacterOrbit {...base} onAction={action} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "같이 놀기" }));
    expect(screen.getByRole("group", { name: "별꼬리 같이 놀기" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "같이 놀기" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
    for (const name of [
      "주사위 굴리기",
      "동전 던지기",
      "가위바위보",
      "숫자 맞히기",
      "컵 찾기",
      "장난 운세",
    ])
      expect(screen.getByRole("button", { name })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "장난감 꺼내기" }));
    expect(view.container.firstElementChild?.getAttribute("style")).toContain("width: 800px");
    for (const name of ["공", "종이비행기", "비눗방울", "작은 펫"])
      expect(screen.getByRole("button", { name })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "종이비행기" }));
    await waitFor(() => expect(action).toHaveBeenCalledExactlyOnceWith("toy-paper-plane"));
    expect(screen.queryByRole("group", { name: "별꼬리 같이 놀기" })).toBeNull();
  });

  it("swaps the 교감 ring for the play ring instead of stacking them", async () => {
    render(<CharacterOrbit {...base} onAction={vi.fn()} onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "교감" }));
    fireEvent.click(screen.getByRole("button", { name: "같이 놀기" }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "별꼬리 교감" })).toBeNull());
    expect(screen.getByRole("group", { name: "별꼬리 같이 놀기" })).toBeTruthy();
  });

  it("strokes and pokes in place like the other 교감 touches", async () => {
    const action = vi.fn();
    render(
      <CharacterOrbit
        {...base}
        character={PREVIEW_SNAPSHOT.characters.installed[0]}
        onAction={action}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "교감" }));
    fireEvent.click(screen.getByRole("button", { name: "쓰다듬기" }));
    await waitFor(() => expect(action).toHaveBeenCalledWith("stroke"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "콕 찌르기" })).toHaveProperty("disabled", false),
    );
    fireEvent.click(screen.getByRole("button", { name: "콕 찌르기" }));
    await waitFor(() => expect(action).toHaveBeenLastCalledWith("poke"));
    expect(screen.getByRole("group", { name: "별꼬리 교감" })).toBeTruthy();
  });

  it("opens the outer ring with Enter, walks it with arrows and returns with Escape", async () => {
    render(<CharacterOrbit {...base} onAction={vi.fn()} onClose={vi.fn()} />);
    const play = screen.getByRole("button", { name: "같이 놀기" });
    play.focus();
    fireEvent.click(play);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "주사위 굴리기" })),
    );
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "동전 던지기" }));
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("group", { name: "별꼬리 같이 놀기" })).toBeNull(),
    );
    expect(document.activeElement).toBe(play);
  });
});
