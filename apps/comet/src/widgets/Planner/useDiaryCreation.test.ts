// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PREPARATION_DRAFT_KEY } from "../PreparationTool/PreparationCreate";
import { useDiaryCreation } from "./useDiaryCreation";
import type { DiaryWidgetActions } from "./useDiaryWidgetActions";

const requestKey = "comet:diary:preparation-request";
const request = {
  requestId: "request-1",
  instanceId: "preparation-1",
  expectedRevision: 1,
  action: "create",
  input: { title: "준비" },
};

beforeEach(() => localStorage.clear());
afterEach(cleanup);

it("preserves a closed uncertain request until its restored envelope is discarded", () => {
  localStorage.setItem(PREPARATION_DRAFT_KEY, JSON.stringify({ title: "준비" }));
  localStorage.setItem(requestKey, JSON.stringify(request));
  const actions: DiaryWidgetActions = {
    busy: false,
    pending: { current: false },
    latestWidgets: { current: [] },
    run: async (operation) => ({ value: await operation() }),
    execute: vi.fn(),
    act: vi.fn(),
    ensureWidget: vi.fn(),
  };
  const props = {
    actions,
    mutate: vi.fn(),
    page: undefined,
    day: "2026-11-02",
    reload: vi.fn(),
    onPageCreated: vi.fn(),
    onEnvelopeCreated: vi.fn(),
  };
  const view = renderHook(() => useDiaryCreation(props));
  expect(view.result.current.creating).toBe("envelope");

  act(() => view.result.current.closeEnvelope());
  expect(localStorage.getItem(PREPARATION_DRAFT_KEY)).not.toBeNull();
  expect(JSON.parse(localStorage.getItem(requestKey) ?? "null")).toEqual(request);
  expect(view.result.current.envelopeCreateRequest.current).toEqual(request);

  act(() => view.result.current.discard());
  expect(localStorage.getItem(PREPARATION_DRAFT_KEY)).not.toBeNull();
  expect(JSON.parse(localStorage.getItem(requestKey) ?? "null")).toEqual(request);
  expect(view.result.current.envelopeCreateRequest.current).toEqual(request);

  act(() => view.result.current.start("page"));
  act(() => view.result.current.discard());
  expect(localStorage.getItem(PREPARATION_DRAFT_KEY)).not.toBeNull();
  expect(JSON.parse(localStorage.getItem(requestKey) ?? "null")).toEqual(request);
  expect(view.result.current.envelopeCreateRequest.current).toEqual(request);

  view.unmount();
  const restored = renderHook(() => useDiaryCreation(props));
  expect(restored.result.current.creating).toBe("envelope");
  act(() => restored.result.current.discard());
  expect(localStorage.getItem(PREPARATION_DRAFT_KEY)).toBeNull();
  expect(localStorage.getItem(requestKey)).toBeNull();
  expect(restored.result.current.envelopeCreateRequest.current).toBeNull();
  expect(restored.result.current.creating).toBeNull();
});
