import type { Locator, Page } from "@playwright/test";
import { expect, test, type FakeTauri } from "./tauri";

const AI_ERROR =
  "AI 연결을 아직 쓸 수 없어요. 설정한 모델 파일을 찾지 못했어요: 모델을 다시 내려받거나 다른 AI로 바꿔 주세요.";

// The native host resizes the input window to the measured capsule; mirror that so clipping is real.
async function openInputSurface(
  page: Page,
  tauri: FakeTauri,
  error: string | null = null,
): Promise<void> {
  tauri.handle("get_snapshot", async () => {
    const snapshot = await tauri.previewSnapshot();
    return {
      ...snapshot,
      panel: { persona: "a", mode: "input" },
      runtime: { ...snapshot.runtime, error },
    };
  });
  tauri.handle("get_conversations", () => []);
  tauri.handle("resize_balloon", async ({ width, height }) => {
    await page.setViewportSize({
      width: Math.min(520, Math.max(48, Number(width))),
      height: Math.min(520, Math.max(32, Number(height))),
    });
    return { orbitAnchor: null };
  });
  await page.setViewportSize({ width: 520, height: 520 });
  await tauri.open("conversation-input");
  await expect.poll(() => tauri.called("resize_balloon").length).toBeGreaterThan(0);
}

async function expectInsideWindow(page: Page, target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  const box = (await target.boundingBox())!;
  const viewport = page.viewportSize()!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height + 0.5);
  // Text blocks must not be cut by their own overflow; a scrolling textarea is checked by caret instead.
  const clipped = await target.evaluate(
    (node) =>
      node.tagName !== "TEXTAREA" &&
      (node.scrollWidth > node.clientWidth + 1 || node.scrollHeight > node.clientHeight + 1),
  );
  expect(clipped).toBe(false);
}

// Document start/end of a textarea on each desktop platform.
const START = process.platform === "darwin" ? "Meta+ArrowUp" : "Control+Home";
const END = process.platform === "darwin" ? "Meta+ArrowDown" : "Control+End";

const background = (target: Locator) =>
  target.evaluate((node) => getComputedStyle(node).backgroundColor);

async function expectPressFeedback(page: Page, button: Locator): Promise<void> {
  await expect(button).toBeEnabled();
  await page.mouse.move(0, 0);
  const rest = await background(button);
  await button.hover();
  await expect.poll(() => background(button), { timeout: 2000 }).not.toBe(rest);
  const hover = await background(button);
  await page.mouse.down();
  await expect.poll(() => background(button), { timeout: 2000 }).not.toBe(hover);
  // Release outside so the press does not trigger the action.
  await page.mouse.move(0, 0);
  await page.mouse.up();
}

test("the AI connection action shows distinct rest, hover and pressed states", async ({
  page,
  tauri,
}) => {
  await openInputSurface(page, tauri, AI_ERROR);
  await expectPressFeedback(page, page.getByRole("button", { name: "AI 연결 열기" }));
  expect(tauri.called("open_model_settings")).toHaveLength(0);
});

test("the send button shows distinct rest, hover and pressed states", async ({ page, tauri }) => {
  // Known gap (2026-10-29): the design-system InputCapsule send button has no hover or pressed style.
  test.fail();
  await openInputSurface(page, tauri);
  await page.getByRole("textbox").fill("안녕");
  await expectPressFeedback(page, page.getByRole("button", { name: "보내기" }));
});

test("the input error and the AI connection action stay inside the measured window", async ({
  page,
  tauri,
}) => {
  await openInputSurface(page, tauri, AI_ERROR);
  const alert = page.getByRole("alert").filter({ hasText: AI_ERROR });
  await expect(alert).toHaveText(AI_ERROR);
  // Wait until the window has been fitted to the content that includes the error.
  await expect.poll(async () => page.viewportSize()!.height).toBeGreaterThan(80);
  await expectInsideWindow(page, alert);
  await expectInsideWindow(page, page.getByRole("button", { name: "AI 연결 열기" }));
  await expectInsideWindow(page, page.getByRole("textbox"));
  await expectInsideWindow(page, page.getByRole("button", { name: "보내기" }));
});

test("a multi-line draft stays a one-row input whose first and last lines are reachable and editable", async ({
  page,
  tauri,
}) => {
  await openInputSurface(page, tauri);
  const field = page.getByRole("textbox");
  await expect(field).toHaveAttribute("rows", "1");
  await field.click();
  await page.keyboard.type("첫 줄");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("가운데 줄");
  await page.keyboard.press("Shift+Enter");
  await page.keyboard.type("끝 줄");
  await expect(field).toHaveValue("첫 줄\n가운데 줄\n끝 줄");
  expect(tauri.called("send_message")).toHaveLength(0);

  const caret = () =>
    field.evaluate((node: HTMLTextAreaElement) => ({
      start: node.selectionStart,
      top: node.scrollTop,
      bottom: Math.ceil(node.scrollTop + node.clientHeight) >= node.scrollHeight - 1,
    }));

  await page.keyboard.press(START);
  await expect.poll(caret).toMatchObject({ start: 0, top: 0 });
  await page.keyboard.type("✏️");
  await expect(field).toHaveValue("✏️첫 줄\n가운데 줄\n끝 줄");

  await page.keyboard.press(END);
  await expect.poll(caret).toMatchObject({ bottom: true });
  await page.keyboard.type("!");
  await expect(field).toHaveValue("✏️첫 줄\n가운데 줄\n끝 줄!");

  // The wheel scrolls the same lines without changing the draft.
  await field.hover();
  await page.mouse.wheel(0, -200);
  await expect.poll(caret).toMatchObject({ top: 0 });
  await expectInsideWindow(page, field);
  await expectInsideWindow(page, page.getByRole("button", { name: "보내기" }));
  await expect(field).toHaveValue("✏️첫 줄\n가운데 줄\n끝 줄!");
});
