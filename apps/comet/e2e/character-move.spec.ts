import type { Page } from "@playwright/test";
import { expect, test, type FakeTauri } from "./tauri";

// The native side owns the OS drag and saves only a normal drop (see characters::gestures tests).
// This covers the web side's half: which gestures start a move and which cancel it.
async function openBody(page: Page, tauri: FakeTauri) {
  tauri.handle("get_snapshot", () => tauri.previewSnapshot());
  tauri.handle("get_character_gesture_settings", () => ({ doubleClickMs: 250 }));
  await page.setViewportSize({ width: 160, height: 160 });
  await tauri.open(null, { body: "builtin-a" });
  const body = page.getByLabel(/^A( 반응)?$/).first();
  await expect(body).toBeVisible();
  // The gesture listener registers before a move can be handed to the OS.
  await expect
    .poll(() => tauri.called("report_character_motion_preference").length)
    .toBeGreaterThan(0);
  return body;
}

async function drag(page: Page, from: { x: number; y: number }, dx: number): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let step = 1; step <= 4; step += 1) await page.mouse.move(from.x + (dx * step) / 4, from.y);
}

async function center(body: ReturnType<Page["getByLabel"]>) {
  const box = (await body.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test("an armed move hands one drag session to the OS and Escape cancels that session", async ({
  page,
  tauri,
}) => {
  const body = await openBody(page, tauri);
  await tauri.emit("character-move-armed", null);
  await drag(page, await center(body), 30);

  await expect.poll(() => tauri.called("begin_character_drag").length).toBe(1);
  const [{ sessionId }] = tauri.called("begin_character_drag");
  await body.focus();
  await page.keyboard.press("Escape");
  await expect.poll(() => tauri.called("cancel_character_drag")).toEqual([{ sessionId }]);
  await page.mouse.up();
  expect(tauri.called("begin_character_drag")).toHaveLength(1);
});

test("after the OS reports the drop, Escape no longer cancels the finished move", async ({
  page,
  tauri,
}) => {
  const body = await openBody(page, tauri);
  await tauri.emit("character-move-armed", null);
  await drag(page, await center(body), 30);
  await expect.poll(() => tauri.called("begin_character_drag").length).toBe(1);
  const [{ sessionId }] = tauri.called("begin_character_drag");

  await tauri.emit("character-gesture", { sessionId, phase: "ended" });
  await page.mouse.up();
  await body.focus();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  expect(tauri.called("cancel_character_drag")).toHaveLength(0);
});

test("an ordinary stroke is an interaction and never starts a move", async ({ page, tauri }) => {
  const body = await openBody(page, tauri);
  await drag(page, await center(body), 30);
  await page.mouse.up();
  await expect.poll(() => tauri.called("trigger_character_interaction").length).toBeGreaterThan(0);
  expect(tauri.called("begin_character_drag")).toHaveLength(0);
  expect(tauri.called("cancel_character_drag")).toHaveLength(0);
});
