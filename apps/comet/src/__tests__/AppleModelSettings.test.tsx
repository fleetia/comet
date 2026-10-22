import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AppleModelSettings } from "../components/ModelSettings/AppleModelSettings";
import { useSettingsDraft } from "../hooks/useSettingsDraft";
import { command, PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";
import type { AppleModelStatus } from "../types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
afterEach(cleanup);
beforeEach(() => vi.mocked(command).mockReset());
const unavailable: AppleModelStatus = {
  available: false,
  reason: "modelNotReady",
  message: "Apple 모델이 아직 준비되지 않았어요.",
  locale: "ko-KR",
};
const available: AppleModelStatus = {
  ...unavailable,
  available: true,
  reason: "available",
  message: "한국어를 사용할 수 있어요.",
};

function Settings(): React.JSX.Element {
  const draft = useSettingsDraft(PREVIEW_SNAPSHOT.settings, "model");
  return (
    <AppleModelSettings
      initialStatus={unavailable}
      draft={draft}
      inspectorHeader={<h1>Apple 설정</h1>}
      supportingContent={null}
      footer={<output>{draft.notice}</output>}
    />
  );
}

it("finishes the current availability check after StrictMode remounts the effect", async () => {
  vi.mocked(command).mockResolvedValue(available);
  render(
    <StrictMode>
      <Settings />
    </StrictMode>,
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "확인하기" })).toHaveProperty("disabled", false),
  );
  expect(screen.queryByText("사용 가능 상태 확인 중…")).toBeNull();
});

it("rechecks availability on focus without saving or invoking inference until requested", async () => {
  vi.mocked(command).mockResolvedValueOnce(unavailable).mockResolvedValueOnce(available);
  render(<Settings />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "다시 확인" })).toHaveProperty("disabled", false),
  );
  const test = screen.getByRole("button", { name: "확인하기" });
  expect(test).toHaveProperty("disabled", true);
  expect(screen.queryByRole("progressbar")).toBeNull();
  fireEvent(window, new Event("focus"));
  await waitFor(() => expect(test).toHaveProperty("disabled", false));
  expect(vi.mocked(command).mock.calls.map(([name]) => name)).toEqual([
    "apple_model_status",
    "apple_model_status",
  ]);
  vi.mocked(command).mockResolvedValueOnce({ reply: "반가워!", elapsedMs: 500 });
  fireEvent.click(test);
  expect(await screen.findByText("0.5초 · 반가워!")).toBeTruthy();
  expect(command).toHaveBeenLastCalledWith("test_apple_model", undefined);
});

it("shows a failed availability check and disables inference instead of retaining readiness", async () => {
  vi.mocked(command)
    .mockResolvedValueOnce(available)
    .mockRejectedValueOnce(new Error("상태를 확인하지 못했어요."));
  render(<Settings />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "확인하기" })).toHaveProperty("disabled", false),
  );
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "다시 확인" })));
  expect(screen.getByRole("alert").textContent).toBe("상태를 확인하지 못했어요.");
  expect(screen.getByRole("button", { name: "확인하기" })).toHaveProperty("disabled", true);
});
