import { expect, test } from "./tauri";
import type { Playback } from "../src/types";

// When the alert time is crossed (see widgets::reminders tests), the host publishes the
// reminder as a character line linked to the calendar. This checks what the balloon shows.
const ALERT_AT = new Date("2026-11-03T10:00:00+09:00").getTime();
const line: Playback = {
  id: "reminder-1",
  persona: "a",
  expression: "neutral",
  text: "등록한 일정이나 할 일의 시간이 가까워졌어요. 주간 회의",
  source: "widget",
  endsAt: ALERT_AT + 8_000,
  displayStartedAt: ALERT_AT,
  link: { instanceId: "calendar", kind: "calendar", label: "캘린더" },
  lineIndex: 0,
  lineCount: 1,
};

test("a reminder published at its alert time shows in the character balloon and opens the calendar", async ({
  page,
  tauri,
}) => {
  await page.clock.install({ time: ALERT_AT });
  const preview = await (async () => {
    await page.goto("/");
    return tauri.previewSnapshot();
  })();
  tauri.handle("get_snapshot", () => preview);
  tauri.handle("resize_balloon", () => ({ orbitAnchor: null }));
  await tauri.open("balloon");
  await expect.poll(() => tauri.called("get_snapshot").length).toBeGreaterThan(0);
  await expect(page.getByText(line.text)).toHaveCount(0);

  await tauri.emit("app-state", { ...preview, playback: line });
  const speech = page.getByRole("button", { name: `캘린더 열기: ${line.text}` });
  await expect(speech).toBeVisible();
  await speech.click();
  expect(tauri.called("open_playback_link")).toEqual([{ playbackId: line.id }]);
});
