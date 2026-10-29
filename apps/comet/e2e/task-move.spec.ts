import type { Locator, Page } from "@playwright/test";
import { expect, test, type FakeTauri } from "./tauri";

const widget = (data: unknown) => ({
  id: "todo",
  kind: "todo",
  reaction: true,
  revision: 1,
  version: 1,
  missing: [],
  packageBytes: 0,
  error: null,
  status: "enabled",
  data,
});

// The diary window's minimum size (window_lifecycle.rs `min_inner_size`).
const MIN_WINDOW = { width: 720, height: 520 };

async function openTodos(page: Page, tauri: FakeTauri): Promise<void> {
  tauri.handle("get_planning_window_state", () => ({ generation: 1, active: true }));
  tauri.handle("get_snapshot", () => tauri.previewSnapshot());
  tauri.handle("get_widgets", () => ({
    catalog: [],
    onboardingDone: true,
    widgets: [
      widget({
        items: [
          { id: "inbox", title: "날짜 없는 할 일" },
          { id: "later", title: "예정된 할 일", plannedDate: "2099-01-05" },
        ],
      }),
    ],
  }));
  tauri.handle("get_diary", () => ({ revision: 1 }));
  tauri.handle("get_planner_tab", () => "today");
  tauri.handle("get_planner_note_target", () => null);
  tauri.handle("get_planner_view_target", () => null);
  await page.setViewportSize(MIN_WINDOW);
  await tauri.open("planner");
  await page
    .getByRole("link", { name: "할 일" })
    .or(page.getByRole("button", { name: "할 일" }))
    .first()
    .click();
}

async function expectInsideWindow(target: Locator): Promise<void> {
  await expect(target).toBeVisible();
  const box = (await target.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(MIN_WINDOW.width + 0.5);
  expect(box.y + box.height).toBeLessThanOrEqual(MIN_WINDOW.height + 0.5);
}

// The OS draws the native date picker popup itself; this covers the dialog and field it opens from.
test("the move dialog and its date field stay inside the smallest diary window", async ({
  page,
  tauri,
}) => {
  await openTodos(page, tauri);
  // Dropping on a group without one date asks for the new date.
  const data = await page.evaluateHandle(() => new DataTransfer());
  await page
    .locator("[draggable=true]")
    .filter({ hasText: "날짜 없는 할 일" })
    .dispatchEvent("dragstart", { dataTransfer: data });
  const upcoming = page.getByRole("region", { name: "예정 할 일" });
  await upcoming.dispatchEvent("dragover", { dataTransfer: data });
  await upcoming.dispatchEvent("drop", { dataTransfer: data });

  const dialog = page.getByRole("dialog", { name: "할 일 옮기기" });
  await expectInsideWindow(dialog);
  const date = dialog.getByLabel("새 계획 날짜");
  await expectInsideWindow(date);
  await date.focus();
  await expect(date).toBeFocused();
  await date.fill("2026-11-03");
  const submit = dialog.getByRole("button", { name: "선택한 날로 옮기기" });
  await expectInsideWindow(submit);
  await submit.click();

  await expect
    .poll(() => tauri.called("execute_widget").map(({ request }) => request))
    .toContainEqual(
      expect.objectContaining({ action: "plan", input: { ids: ["inbox"], date: "2026-11-03" } }),
    );
});
