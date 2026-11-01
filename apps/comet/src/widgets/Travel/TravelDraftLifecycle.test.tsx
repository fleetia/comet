import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { command } from "../../hooks/useSnapshot";
import { Travel } from "./Travel";

const native = vi.hoisted(() => ({ onCloseRequested: vi.fn(), destroy: vi.fn(), startDragging: vi.fn() }));
const mutate = vi.hoisted(() => vi.fn());
let removedTravelId = "";
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("../../hooks/useSnapshot", () => ({ command: vi.fn(), isDesktop: () => true, errorText: String }));
vi.mock("../useWidgets", () => ({ useWidgets: () => ({ snapshot: { widgets: [] }, reload: vi.fn() }) }));
vi.mock("../Planner/useDiary", () => ({
  useDiary: () => ({
    state: {
      revision: 1,
      travels: ["a", "b"].filter((id) => id !== removedTravelId).map((id) => ({
        id, title: `Trip ${id}`, destination: "", startDate: "2026-11-01", endDate: "2026-11-02",
        timeZone: "Asia/Seoul", currency: "KRW", budget: 0, finished: false,
      })),
    },
    busy: false, mutate, reload: vi.fn(),
  }),
}));
const handlers = new Map<string, (event: { payload: unknown }) => void>();
let finishDraft: (value: unknown) => void;
const result = { draft: { title: "확인서 숙소" }, voucher: { id: "voucher", name: "확인서.pdf", file: "voucher.pdf" } };

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  removedTravelId = "";
  location.hash = "";
  native.onCloseRequested.mockResolvedValue(() => undefined);
  mutate.mockResolvedValue({ revision: 2 });
  vi.mocked(listen).mockImplementation(async (name, callback) => {
    handlers.set(name, callback as (event: { payload: unknown }) => void);
    return () => { handlers.delete(name); };
  });
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_travel_target") return "a" as never;
    if (name === "travel_booking_draft") return new Promise((resolve) => { finishDraft = resolve; });
    return null as never;
  });
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(cleanup);

async function startDraft(): Promise<void> {
  render(<Travel onClose={vi.fn()} />);
  await screen.findByRole("heading", { name: "Trip a" });
  fireEvent.click(screen.getByRole("link", { name: "예약" }));
  fireEvent.click(screen.getByRole("button", { name: "확인서로 초안 만들기" }));
  expect(command).toHaveBeenCalledWith("travel_booking_draft", { travelId: "a" });
}

async function selectTravel(id: string): Promise<void> {
  await waitFor(() => expect(handlers.has("travel-open")).toBe(true));
  act(() => handlers.get("travel-open")!({ payload: id }));
  await screen.findByRole("heading", { name: `Trip ${id}` });
}

it("keeps an edited plan when a booking draft arrives and opens it after discard", async () => {
  await startDraft();
  fireEvent.click(screen.getByRole("link", { name: "일정" }));
  fireEvent.click(screen.getByRole("button", { name: "일정 더하기" }));
  const input = screen.getByPlaceholderText("애월 숙소 체크인") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "작성 중인 일정" } });
  await act(async () => finishDraft(result));
  expect(input.value).toBe("작성 중인 일정");
  expect(screen.getByRole("button", { name: "초안 열기" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "일정 더하기 닫기" }));
  fireEvent.click(screen.getByRole("button", { name: "버리기" }));
  fireEvent.click(screen.getByRole("button", { name: "초안 열기" }));
  expect(screen.getByRole("dialog", { name: "확인서로 만든 예약 초안 · Trip a" })).toBeTruthy();
  expect((screen.getByDisplayValue("확인서 숙소") as HTMLInputElement).value).toBe("확인서 숙소");
});

it("holds a draft for its original trip and keeps its voucher on save", async () => {
  await startDraft();
  await selectTravel("b");
  await act(async () => finishDraft(result));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.getByRole("button", { name: "초안 열기" }).hasAttribute("disabled")).toBe(true);
  await selectTravel("a");
  fireEvent.click(screen.getByRole("button", { name: "초안 열기" }));
  const dialog = screen.getByRole("dialog", { name: "확인서로 만든 예약 초안 · Trip a" });
  fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));
  await waitFor(() => expect(mutate).toHaveBeenCalledWith("travel-booking-create", expect.objectContaining({ travelId: "a", vouchers: [result.voucher] })));
});

it("clears a pending draft when its trip is deleted and allows bookings on another trip", async () => {
  await startDraft();
  await selectTravel("b");
  await act(async () => finishDraft(result));
  fireEvent.click(screen.getByRole("link", { name: "예약" }));
  expect(screen.getByRole("button", { name: "확인서로 초안 만들기" }).hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "예약 더하기" }));
  expect(screen.getByRole("dialog", { name: "예약 더하기 · Trip b" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "예약 더하기 닫기" }));

  removedTravelId = "a";
  act(() => { handlers.get("travel-open")!({ payload: "a" }); });
  await waitFor(() => expect(screen.queryByRole("button", { name: "초안 열기" })).toBeNull());
  fireEvent.click(screen.getByRole("link", { name: "예약" }));
  expect(screen.getByRole("button", { name: "확인서로 초안 만들기" }).hasAttribute("disabled")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "예약 더하기" }));
  expect(screen.getByRole("dialog", { name: "예약 더하기 · Trip b" })).toBeTruthy();
});

it("asks before discarding an untouched AI draft", async () => {
  await startDraft();
  await act(async () => finishDraft(result));
  const draft = screen.getByRole("dialog", { name: "확인서로 만든 예약 초안 · Trip a" });
  fireEvent.click(within(draft).getByRole("button", { name: "확인서로 만든 예약 초안 닫기" }));
  expect(screen.getByRole("dialog", { name: "저장하지 않은 변경을 버릴까요?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "계속 작성" }));
  expect(screen.getByDisplayValue("확인서 숙소")).toBeTruthy();
});

it("saves a plan to the trip where editing started after a travel-open event", async () => {
  render(<Travel onClose={vi.fn()} />);
  await screen.findByRole("heading", { name: "Trip a" });
  fireEvent.click(screen.getByRole("link", { name: "일정" }));
  fireEvent.click(screen.getByRole("button", { name: "일정 더하기" }));
  fireEvent.change(screen.getByPlaceholderText("애월 숙소 체크인"), { target: { value: "계획" } });
  await selectTravel("b");
  const dialog = screen.getByRole("dialog", { name: "일정 더하기 · Trip a" });
  fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));
  await waitFor(() => expect(mutate).toHaveBeenCalledWith("travel-plan-create", expect.objectContaining({ travelId: "a", title: "계획" })));
});

it.each([
  { tab: "예약", add: "예약 더하기", title: "예약 더하기 · Trip a", placeholder: "애월 숙소", action: "travel-booking-create", field: "title" },
  { tab: "비용", add: "쓴 돈 적기", title: "비용 더하기 · Trip a", placeholder: "흑돼지 저녁", action: "travel-expense-create", field: "title" },
  { tab: "사람", add: "사람 더하기", title: "함께 가는 사람 더하기 · Trip a", placeholder: "엄마", action: "travel-person-create", field: "name" },
])("saves $tab to the trip where editing started after a travel-open event", async ({ tab, add, title, placeholder, action, field }) => {
  render(<Travel onClose={vi.fn()} />);
  await screen.findByRole("heading", { name: "Trip a" });
  fireEvent.click(screen.getByRole("link", { name: tab }));
  fireEvent.click(screen.getByRole("button", { name: add }));
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: "기록" } });
  if (tab === "비용") fireEvent.change(screen.getByLabelText("금액"), { target: { value: "1000" } });
  await selectTravel("b");
  const dialog = screen.getByRole("dialog", { name: title });
  fireEvent.click(within(dialog).getByRole("button", { name: "저장" }));
  await waitFor(() => expect(mutate).toHaveBeenCalledWith(action, expect.objectContaining({ travelId: "a", [field]: "기록" })));
});
