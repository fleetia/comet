import type { Page } from "@playwright/test";
import { expect, test, type FakeTauri } from "./tauri";

const CATALOG = Object.entries({ "focus-timer": "집중 타이머", todo: "할 일" }).map(
  ([id, name]) => ({
    id,
    name,
    description: "",
    category: "",
    version: 1,
    required: [],
    connection: null,
  }),
);

function widget(id: string, kind: string, data: Record<string, unknown>) {
  return {
    id,
    kind,
    reaction: true,
    revision: 3,
    version: 1,
    missing: [],
    packageBytes: 0,
    error: null,
    status: "enabled",
    data,
  };
}

async function openFocusBubble(page: Page, tauri: FakeTauri) {
  const desktop = {
    revision: 5,
    editing: false,
    mode: "stack",
    order: ["focus"],
    anchor: "top-right",
    width: 370,
    overlapped: true,
    oneExpanded: true,
    positions: {},
    shapes: {},
    snapToGrid: false,
    showGuides: true,
  };
  tauri.handle("get_widget_desktop", () => desktop);
  tauri.handle("get_widgets", () => ({
    catalog: CATALOG,
    onboardingDone: true,
    widgets: [
      widget("focus", "focus-timer", { status: "idle", durationMs: 60000, remainingMs: 60000 }),
      widget("todo", "todo", { items: [{ id: "task", title: "원고 마무리", completedAt: null }] }),
    ],
  }));
  tauri.handle("get_widget_runtime", () => ({ widgets: [] }));
  await tauri.open("widget-stack");
  await page
    .getByRole("group", { name: "접어 둔 위젯" })
    .getByRole("button", { name: /집중/ })
    .click();
  const bubble = page.getByRole("dialog");
  await expect(bubble).toBeVisible();
  await bubble.getByText("이번 집중 연결").click();
  const select = bubble.getByLabel("연결할 할 일");
  await expect(select).toBeVisible();
  return { bubble, select };
}

// Opens the real native list from the keyboard, as a user would.
async function openList(page: Page, select: ReturnType<Page["locator"]>): Promise<void> {
  await select.focus();
  await page.keyboard.press(process.platform === "darwin" ? "Space" : "Alt+ArrowDown");
  await expect.poll(() => select.evaluate((node) => node.matches(":open"))).toBe(true);
}

// The window losing focus to another app; the WebView only sees `blur` on window.
const blurWindow = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new FocusEvent("blur")));

test("the bubble stays open when the window blurs while the task list is open", async ({
  page,
  tauri,
}) => {
  const { bubble, select } = await openFocusBubble(page, tauri);
  await openList(page, select);
  await blurWindow(page);
  await expect(bubble).toBeVisible();
  await expect(select).toBeVisible();
});

test("a blur with the task list closed dismisses the bubble as before", async ({ page, tauri }) => {
  const { bubble, select } = await openFocusBubble(page, tauri);
  await select.focus();
  await blurWindow(page);
  await expect(bubble).toBeHidden();
});

for (const dismissal of ["outside press", "Escape"] as const) {
  test(`after the list closes following a blur, ${dismissal} still closes the bubble`, async ({
    page,
    tauri,
  }) => {
    const { bubble, select } = await openFocusBubble(page, tauri);
    await openList(page, select);
    await blurWindow(page);
    await expect(bubble).toBeVisible();

    // Headless Chromium does not route keys into the native popup; Tab closes it like leaving it does.
    await page.keyboard.press("Tab");
    await expect.poll(() => select.evaluate((node) => node.matches(":open"))).toBe(false);
    await page.evaluate(() => window.dispatchEvent(new FocusEvent("focus")));
    await expect(bubble).toBeVisible();

    if (dismissal === "Escape") {
      await page.keyboard.press("Escape");
    } else {
      const box = (await bubble.boundingBox())!;
      const viewport = page.viewportSize()!;
      await page.mouse.click(box.x > 20 ? 5 : viewport.width - 5, viewport.height - 5);
    }
    await expect(bubble).toBeHidden();
  });
}
