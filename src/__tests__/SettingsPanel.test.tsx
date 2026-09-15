import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SettingsPanel } from "../components/SettingsPanel";
import { PREVIEW_SNAPSHOT, command } from "../hooks/useSnapshot";
import type { Snapshot } from "../types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(undefined);
});

const READY_4B: Snapshot = {
  ...PREVIEW_SNAPSHOT,
  modelReady: true,
  localModels: PREVIEW_SNAPSHOT.localModels.map((model) =>
    model.id === "qwen3.5-4b" ? { ...model, ready: true, downloadedBytes: model.size } : model,
  ),
};

it("downloads and saves draft 9B while the saved 4B model remains ready", async () => {
  render(<SettingsPanel snapshot={READY_4B} />);
  expect(screen.getByLabelText("로컬 모델")).toHaveProperty("value", "qwen3.5-4b");
  expect(screen.getByRole("button", { name: "모델 준비 완료" })).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("로컬 모델"), { target: { value: "qwen3.5-9b" } });
  expect(screen.getByText("Qwen3.5-9B Q4_K_M · 다운로드 5.68 GB")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "모델 내려받기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("download_model", { model: "qwen3.5-9b" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "설정 저장" })).toHaveProperty("disabled", false),
  );
  fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_settings", {
      settings: { ...READY_4B.settings, localModel: "qwen3.5-9b" },
      apiKey: null,
    }),
  );
});

it("does not reuse another model's progress or error and locks selection during its active transfer", () => {
  const { rerender } = render(<SettingsPanel snapshot={READY_4B} />);
  fireEvent.change(screen.getByLabelText("로컬 모델"), { target: { value: "qwen3.5-9b" } });
  rerender(
    <SettingsPanel
      snapshot={{
        ...READY_4B,
        runtime: {
          ...READY_4B.runtime,
          download: {
            model: "qwen3.5-4b",
            received: 1000,
            total: 2740937888,
            status: "error",
            error: "4B 파일 오류",
          },
        },
      }}
    />,
  );
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.queryByText("4B 파일 오류")).toBeNull();
  expect(screen.getByRole("button", { name: "모델 내려받기" })).toHaveProperty("disabled", false);
  rerender(
    <SettingsPanel
      snapshot={{
        ...READY_4B,
        runtime: {
          ...READY_4B.runtime,
          download: {
            model: "qwen3.5-4b",
            received: 1000,
            total: 2740937888,
            status: "downloading",
            error: null,
          },
        },
      }}
    />,
  );
  expect(screen.getByLabelText("로컬 모델")).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "모델 내려받기" })).toHaveProperty("disabled", true);
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.getByText(/Qwen3.5-4B 파일을 준비하고 있어요/)).toBeTruthy();
});

it("shows the selected model's verification and resumes only its own partial download", async () => {
  const verifying: Snapshot = {
    ...READY_4B,
    settings: { ...READY_4B.settings, localModel: "qwen3.5-9b" },
    modelReady: false,
    runtime: {
      ...READY_4B.runtime,
      download: {
        model: "qwen3.5-9b",
        received: 5680522464,
        total: 5680522464,
        status: "verifying",
        error: null,
      },
    },
  };
  const { rerender } = render(<SettingsPanel snapshot={verifying} />);
  expect(screen.getByLabelText("로컬 모델")).toHaveProperty("disabled", true);
  expect(screen.getByRole("progressbar")).toHaveProperty("value", 100);
  expect(screen.getByRole("button", { name: "모델 파일 확인 중" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByRole("button", { name: "다운로드 중단" })).toHaveProperty("disabled", false);
  const partial: Snapshot = {
    ...verifying,
    runtime: { ...verifying.runtime, download: null },
    localModels: verifying.localModels.map((model) =>
      model.id === "qwen3.5-9b" ? { ...model, downloadedBytes: 1000000000 } : model,
    ),
  };
  rerender(<SettingsPanel snapshot={partial} />);
  expect(screen.getByLabelText("로컬 모델")).toHaveProperty("disabled", false);
  expect(screen.getByRole("progressbar")).toHaveProperty("value", 18);
  fireEvent.click(screen.getByRole("button", { name: "이어받기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("download_model", { model: "qwen3.5-9b" }),
  );
  await waitFor(() => expect(screen.getByLabelText("로컬 모델")).toHaveProperty("disabled", false));
  rerender(
    <SettingsPanel
      snapshot={{
        ...partial,
        runtime: {
          ...partial.runtime,
          download: {
            model: "qwen3.5-9b",
            received: 1000000000,
            total: 5680522464,
            status: "error",
            error: "9B 파일 오류",
          },
        },
      }}
    />,
  );
  expect(screen.getByRole("alert").textContent).toBe("9B 파일 오류");
  fireEvent.change(screen.getByLabelText("로컬 모델"), { target: { value: "qwen3.5-4b" } });
  expect(screen.queryByRole("progressbar")).toBeNull();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("button", { name: "모델 준비 완료" })).toHaveProperty("disabled", true);
});
