import { expect, test, type FakeTauri } from "./tauri";

const travel = {
  id: "osaka",
  title: "오사카 여행",
  destination: "오사카",
  startDate: "2026-11-20",
  endDate: "2026-11-22",
  timeZone: "Asia/Tokyo",
  currency: "KRW",
  budget: 1_000_000,
  finished: false,
};
const draft = {
  kind: "stay",
  title: "난바 호텔",
  vendor: "예약 사이트",
  confirmation: "AB12345",
  status: "paid",
  amount: "320000",
  currency: "KRW",
  startDate: "2026-11-20",
  endDate: "2026-11-22",
};
const voucher = { id: "v1", name: "voucher.pdf", file: "v1.pdf" };

// A diary backend whose bookings and ledger change only through update_diary.
function travelBackend(tauri: FakeTauri, drafting: () => unknown) {
  let state: Record<string, unknown> = {
    revision: 1,
    travels: [travel],
    travelPlans: [],
    travelBookings: [] as unknown[],
    travelExpenses: [],
    travelPeople: [],
    travelTransfers: [],
    travelPhotos: [],
  };
  tauri.handle("get_planning_window_state", () => ({ generation: 1, active: true }));
  tauri.handle("get_travel_target", () => "osaka");
  tauri.handle("get_widgets", () => ({ catalog: [], widgets: [], onboardingDone: true }));
  tauri.handle("get_diary", () => state);
  tauri.handle("travel_booking_draft", drafting);
  tauri.handle("update_diary", ({ action, input, expectedRevision }) => {
    expect(action).toBe("travel-booking-create");
    expect(expectedRevision).toBe(state.revision);
    const booking = { ...(input as Record<string, unknown>), id: "b1" };
    state = { ...state, revision: Number(state.revision) + 1, travelBookings: [booking] };
    return state;
  });
}

test("an AI draft changes nothing until reviewed and saved, and closing it discards it", async ({
  page,
  tauri,
}) => {
  travelBackend(tauri, () => ({ draft, voucher }));
  await tauri.open("travel");
  await page.getByRole("link", { name: "예약" }).click();
  await expect(page.getByRole("heading", { name: "예약 0건" })).toBeVisible();

  await page.getByRole("button", { name: "확인서로 초안 만들기" }).click();
  const editor = page.getByRole("dialog", { name: "확인서로 만든 예약 초안" });
  await expect(editor).toBeVisible();
  await expect(editor.getByText(/저장해야 기록돼요/)).toBeVisible();
  await expect(editor.getByRole("textbox", { name: "이름", exact: true })).toHaveValue("난바 호텔");
  expect(tauri.called("update_diary")).toHaveLength(0);

  await editor.getByRole("button", { name: "확인서로 만든 예약 초안 닫기" }).click();
  await expect(editor).toBeHidden();
  await expect(page.getByRole("heading", { name: "예약 0건" })).toBeVisible();
  expect(tauri.called("update_diary")).toHaveLength(0);

  await page.getByRole("button", { name: "확인서로 초안 만들기" }).click();
  await expect(editor).toBeVisible();
  // The reviewer corrects a value before saving; only the reviewed value is recorded.
  await editor.getByLabel("예약번호").fill("AB12346");
  await editor.getByRole("button", { name: "저장" }).click();
  await expect(editor).toBeHidden();

  const [saved] = tauri.called("update_diary");
  expect(saved.input).toMatchObject({
    travelId: "osaka",
    title: "난바 호텔",
    confirmation: "AB12346",
    amount: 320000,
    vouchers: [voucher],
  });
  await expect(page.getByRole("heading", { name: "예약 1건" })).toBeVisible();
  await expect(
    page.getByRole("region", { name: "예약 목록" }).getByText("난바 호텔"),
  ).toBeVisible();
});

test("an attachment refused by the on-device model shows guidance and sends nothing elsewhere", async ({
  page,
  tauri,
}) => {
  const refusal =
    "이 기기의 모델은 PDF·이미지를 읽지 못해요. 직접 입력하거나 API·ChatGPT 연결을 사용해 주세요.";
  travelBackend(tauri, () => {
    throw new Error(refusal);
  });
  await tauri.open("travel");
  await page.getByRole("link", { name: "예약" }).click();
  await page.getByRole("button", { name: "확인서로 초안 만들기" }).click();

  await expect(page.getByRole("alert").filter({ hasText: refusal })).toBeVisible();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(page.getByRole("heading", { name: "예약 0건" })).toBeVisible();
  expect(tauri.called("travel_booking_draft")).toHaveLength(1);
  expect(tauri.called("update_diary")).toHaveLength(0);
  const afterRefusal = tauri.calls.slice(
    tauri.calls.findIndex((call) => call.name === "travel_booking_draft") + 1,
  );
  expect(
    afterRefusal
      .map((call) => call.name)
      .filter(
        (name) =>
          !name.startsWith("get_") &&
          name !== "report_analytics_event" &&
          name !== "send_analytics_event",
      ),
  ).toEqual([]);
});
