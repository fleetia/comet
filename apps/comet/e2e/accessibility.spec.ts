import type { Locator, Page } from "@playwright/test";
import { expect, test } from "./tauri";
import type { GeneratedWidget, Workshop } from "../src/widgets/GeneratedWidgets/types";

// Native modal dialogs make the page inert; Tab may visit browser chrome (body) but never the page behind.
async function expectTabTrapped(
  page: Page,
  dialog: Locator,
  key: "Tab" | "Shift+Tab",
): Promise<void> {
  const visited = new Set<string>();
  for (let step = 0; step < 8; step += 1) {
    await page.keyboard.press(key);
    const place = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) return "body";
      return active.closest("dialog[open]")
        ? `dialog:${active.textContent?.trim()}`
        : `outside:${active.outerHTML.slice(0, 80)}`;
    });
    expect(place, `${key} step ${step}`).not.toMatch(/^outside:/);
    visited.add(place);
  }
  // Every enabled button is reachable; Chromium may also stop on a scrollable body region.
  for (const name of await dialog.locator("button:not([disabled])").allTextContents()) {
    expect([...visited], `${key} reaches ${name}`).toContain(`dialog:${name.trim()}`);
  }
}

test("settings: keyboard reaches General, traps focus in the reset dialog and restores its opener", async ({
  page,
  tauri,
}) => {
  tauri.handle("get_snapshot", () => tauri.previewSnapshot());
  await tauri.open("settings");
  const firstTab = page.getByRole("tab", { name: "친구들" });
  await expect(firstTab).toBeVisible();

  await firstTab.focus();
  await page.keyboard.press("End");
  const general = page.getByRole("tab", { name: "일반" });
  await expect(general).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(general).toHaveAttribute("aria-selected", "true");

  const reset = page.getByRole("button", { name: "초기화", exact: true });
  for (
    let step = 0;
    step < 40 && !(await reset.evaluate((node) => node === document.activeElement));
    step += 1
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(reset).toBeFocused();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog", { name: "comet을 초기화할까요?" });
  await expect(dialog).toBeVisible();
  await expectTabTrapped(page, dialog, "Tab");
  await expectTabTrapped(page, dialog, "Shift+Tab");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(reset).toBeFocused();
  expect(tauri.called("reset_app")).toHaveLength(0);

  // Back to the original section with the keyboard alone.
  await general.focus();
  await page.keyboard.press("Home");
  await page.keyboard.press("Enter");
  await expect(firstTab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("tabpanel")).toBeVisible();
});

const counter: GeneratedWidget = {
  id: "counter",
  definition: {
    name: "뜨개 단수",
    description: "뜨개질 단수",
    source: "",
    initialState: { count: 0 },
  },
  state: { count: 4 },
  revision: 1,
  installed: true,
  reaction: false,
  status: "ready",
  error: null,
  installation: { origin: "manual", model: null, installedAt: 0 },
  updatedAt: null,
};
const workshop: Workshop = {
  widgets: [counter],
  automatic: false,
  runtime: "",
  generationEligibility: {
    allowed: true,
    reason: "",
    model: "test",
    parameterBillions: null,
    source: "unknown",
  },
};

test("widget editing: the remove dialog traps focus and Cancel and Escape both restore the opener", async ({
  page,
  tauri,
}) => {
  tauri.handle("get_snapshot", () => tauri.previewSnapshot());
  tauri.handle("get_widgets", () => ({ catalog: [], widgets: [], onboardingDone: true }));
  tauri.handle("get_widget_runtime", () => ({ widgets: [] }));
  tauri.handle("get_generated_widgets", () => workshop);
  tauri.handle("get_settings_section", () => "widgets");
  await tauri.open("widgets");

  await page
    .getByRole("button", { name: /뜨개 단수/ })
    .first()
    .click();
  const settings = page.getByRole("region", { name: "뜨개 단수 설정" });
  const remove = settings.getByRole("button", { name: "위젯 삭제" });
  await remove.focus();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expectTabTrapped(page, dialog, "Tab");
  await expectTabTrapped(page, dialog, "Shift+Tab");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "취소" }).focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeHidden();
  await expect(remove).toBeFocused();
  expect(tauri.calls.map((call) => call.name)).not.toContain("remove_generated_widget");
});
