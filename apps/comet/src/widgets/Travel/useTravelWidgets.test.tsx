import { act, renderHook, waitFor } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { afterEach, expect, it, vi } from "vitest";
import { command } from "../../hooks/useSnapshot";
import type { WidgetView } from "../types";
import { useTravelWidgets } from "./useTravelWidgets";

vi.mock("../../hooks/useSnapshot", () => ({ isDesktop: () => true, command: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));

const widgets: WidgetView[] = [{
  id: "travel", kind: "travel", version: 1, reaction: true, revision: 1,
  data: {}, error: null, status: "enabled", missing: [], packageBytes: 0,
}];

afterEach(() => vi.clearAllMocks());

it("reports a failed lookup and reloads without treating it as an empty trip list", async () => {
  vi.mocked(command).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce({ revision: 1, travels: [] });
  const { result } = renderHook(() => useTravelWidgets(widgets));
  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(result.current.widgets[0].data).toMatchObject({ line: { title: "여행 정보를 불러오지 못했어요" } });
  act(() => result.current.reload());
  await waitFor(() => expect(result.current.status).toBe("ready"));
  expect(result.current.widgets[0].data).toMatchObject({ line: { title: "다가오는 여행이 없어요" } });
});

it("subscribes before reading and keeps a newer diary event over an older response", async () => {
  let subscribe: ((cleanup: () => void) => void) | undefined;
  let receive: ((event: { payload: unknown }) => void) | undefined;
  vi.mocked(listen).mockImplementationOnce((_name, handler) => {
    receive = handler as typeof receive;
    return new Promise((resolve) => { subscribe = resolve; });
  });
  let finishRead: ((value: unknown) => void) | undefined;
  vi.mocked(command).mockImplementationOnce(() => new Promise((resolve) => { finishRead = resolve; }));
  const { result } = renderHook(() => useTravelWidgets(widgets));
  expect(command).not.toHaveBeenCalled();
  await act(async () => { subscribe?.(() => undefined); });
  await waitFor(() => expect(command).toHaveBeenCalledWith("get_diary"));
  await act(async () => {
    receive?.({ payload: { revision: 2, travels: [{ id: "trip", title: "새 여행", startDate: "2099-01-01", endDate: "2099-01-02", timeZone: "Asia/Seoul", currency: "KRW", budget: 0, finished: false }] } });
    finishRead?.({ revision: 1, travels: [] });
  });
  expect(result.current.widgets[0].data).toMatchObject({ line: { title: "새 여행" } });
});

it("offers a retry when the diary event subscription fails", async () => {
  vi.mocked(listen).mockRejectedValueOnce(new Error("구독 실패"));
  vi.mocked(command).mockResolvedValueOnce({ revision: 1, travels: [] });
  const { result } = renderHook(() => useTravelWidgets(widgets));
  await waitFor(() => expect(result.current.status).toBe("error"));
  expect(command).not.toHaveBeenCalled();
  act(() => result.current.reload());
  await waitFor(() => expect(result.current.status).toBe("ready"));
});
