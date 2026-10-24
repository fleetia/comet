import { expect, it, vi } from "vitest";
import { runOrbitAction } from "./orbitActions";

it("opens each play choice on its widget and game and touches the friend from the menu", async () => {
  const perform = vi.fn().mockResolvedValue(true);
  const context = {
    persona: "A",
    character: undefined,
    sleeping: false,
    paused: undefined,
    perform,
  };
  for (const [action, args] of [
    ["play-coin", { kind: "small-match", mode: "coin" }],
    ["play-cups", { kind: "guessing", mode: "cups" }],
    ["play-fortune", { kind: "fortune", mode: null }],
    ["toy-pet", { kind: "pet", mode: null }],
  ] as const) {
    await runOrbitAction(action, context);
    expect(perform).toHaveBeenLastCalledWith("open_play_widget", args);
  }
  await runOrbitAction("stroke", context);
  expect(perform).toHaveBeenLastCalledWith("touch_character_from_menu", {
    persona: "A",
    action: "stroke",
  });
});
