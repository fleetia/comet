import type { Page } from "@playwright/test";
import { expect, test, type FakeTauri } from "./tauri";

type Status = "auth-error" | "permission-needed" | "offline" | "syncing" | "ready";

// A fake calendar provider behind the widget host: each manual refresh is one provider request.
function calendarBackend(
  tauri: FakeTauri,
  initial: { status: Status; error: string },
  outcomes: (string | null)[],
) {
  const connection = {
    id: "google-1",
    name: "개인 캘린더",
    provider: "google",
    status: initial.status as Status,
    error: initial.error as string | null,
    lastSuccessAt: Date.now() - 3 * 60 * 60 * 1000,
  };
  const snapshot = () => ({
    catalog: [
      {
        id: "calendar",
        name: "캘린더",
        description: "",
        category: "",
        version: 1,
        required: [],
        connection: null,
      },
    ],
    onboardingDone: true,
    widgets: [
      {
        id: "calendar",
        kind: "calendar",
        reaction: true,
        revision: 1,
        version: 1,
        missing: [],
        packageBytes: 0,
        error: null,
        status: "enabled",
        data: { connections: [{ ...connection }], events: [], settings: {} },
      },
    ],
  });
  tauri.handle("get_widgets", snapshot);
  tauri.handle("get_snapshot", () => tauri.previewSnapshot());
  tauri.handle("get_settings_section", () => "widgets");
  tauri.handle("get_planner_settings_target", () => "calendar");
  tauri.handle("get_widget_runtime", () => ({ widgets: [] }));
  tauri.handle("get_generated_widgets", () => ({
    widgets: [],
    automatic: false,
    runtime: "",
    generationEligibility: {
      allowed: false,
      reason: "",
      model: "",
      parameterBillions: null,
      source: "unknown",
    },
  }));
  tauri.handle("refresh_calendar", async () => {
    connection.status = "syncing";
    await tauri.emit("widgets-state", snapshot());
    const failure = outcomes.shift() ?? null;
    if (failure) {
      connection.status = "auth-error";
      connection.error = failure;
      await tauri.emit("widgets-state", snapshot());
      throw new Error(failure);
    }
    Object.assign(connection, { status: "ready", error: null, lastSuccessAt: Date.now() });
    await tauri.emit("widgets-state", snapshot());
  });
}

const connectionCard = (page: Page) =>
  page
    .getByRole("region", { name: "캘린더 연결 관리" })
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "개인 캘린더" }) });

const FAILURES = [
  {
    status: "auth-error",
    error: "OS 자격 증명 읽기 권한을 확인한 뒤 다시 갱신해 주세요.",
    badge: "다시 인증 필요",
  },
  { status: "permission-needed", error: "캘린더 접근 권한이 거부됐어요.", badge: "권한 필요" },
  { status: "auth-error", error: "다시 인증하지 못했어요.", badge: "다시 인증 필요" },
] as const;

for (const failure of FAILURES) {
  test(`after "${failure.error}" a manual refresh sends a new request and ends ready`, async ({
    page,
    tauri,
  }) => {
    calendarBackend(tauri, failure, [null]);
    await tauri.open("widgets");
    const card = connectionCard(page);
    await expect(card.getByText(failure.badge)).toBeVisible();
    await expect(card.getByText(/에 받은 정보를 흐리게 보여 줘요/)).toBeVisible();

    await card.getByRole("button", { name: "다시 확인" }).click();
    await expect(card.getByText("연결됨")).toBeVisible();
    await expect(card.getByText(/^읽기만 해요 · .+에 확인$/)).toBeVisible();
    await expect(card.getByRole("button", { name: "다시 확인" })).toBeHidden();
    expect(tauri.called("refresh_calendar")).toEqual([
      { id: "calendar", connectionId: "google-1" },
    ]);
  });
}

test("a reauthorization failure on retry is shown, and the next manual refresh is a new request", async ({
  page,
  tauri,
}) => {
  calendarBackend(tauri, FAILURES[0], ["다시 인증하지 못했어요.", null]);
  await tauri.open("widgets");
  const card = connectionCard(page);

  await card.getByRole("button", { name: "다시 확인" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "다시 인증하지 못했어요." }).first(),
  ).toBeVisible();
  await expect(card.getByText("다시 인증 필요")).toBeVisible();

  await card.getByRole("button", { name: "다시 확인" }).click();
  await expect(card.getByText("연결됨")).toBeVisible();
  expect(tauri.called("refresh_calendar")).toHaveLength(2);
});
