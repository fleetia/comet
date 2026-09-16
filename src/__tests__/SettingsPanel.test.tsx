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
  fireEvent.click(screen.getByRole("tab", { name: "대화 모델" }));
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
  fireEvent.click(screen.getByRole("tab", { name: "대화 모델" }));
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
  fireEvent.click(screen.getByRole("tab", { name: "대화 모델" }));
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

it("saves API credentials and idle settings, then clears the key input", async () => {
  render(<SettingsPanel snapshot={READY_4B} />);
  fireEvent.click(screen.getByRole("tab", { name: "대화 모델" }));
  fireEvent.click(screen.getByRole("button", { name: /외부 API로/ }));
  fireEvent.change(screen.getByLabelText("API 주소"), {
    target: { value: "https://api.example.com/v1" },
  });
  fireEvent.change(screen.getByLabelText("모델 이름"), { target: { value: "example-model" } });
  fireEvent.change(screen.getByLabelText(/^API 키/), { target: { value: " test-key " } });
  fireEvent.click(screen.getByRole("tab", { name: "기본 동작" }));
  fireEvent.click(screen.getByLabelText("API로 새 잡담 만들기"));
  fireEvent.change(screen.getByLabelText(/이야기 간격/), { target: { value: "0" } });
  expect(screen.getByRole("button", { name: "설정 저장" })).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText(/이야기 간격/), { target: { value: "12" } });
  fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_settings", {
      settings: {
        ...READY_4B.settings,
        mode: "api",
        baseUrl: "https://api.example.com/v1",
        apiModel: "example-model",
        apiIdleEnabled: !READY_4B.settings.apiIdleEnabled,
        idleMinutes: 12,
      },
      apiKey: "test-key",
    }),
  );
  fireEvent.click(screen.getByRole("tab", { name: "대화 모델" }));
  await waitFor(() => expect(screen.getByLabelText(/^API 키/)).toHaveProperty("value", ""));
});

it("keeps API drafts across tabs and snapshots and locks them until saving finishes", async () => {
  let finish: () => void = () => {};
  vi.mocked(command).mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const { rerender } = render(<SettingsPanel snapshot={READY_4B} />);
  expect(screen.getByRole("button", { name: "설정 저장" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("tab", { name: "대화 모델" }));
  fireEvent.click(screen.getByRole("button", { name: /외부 API로/ }));
  fireEvent.change(screen.getByLabelText("API 주소"), {
    target: { value: "https://draft.example/v1" },
  });
  fireEvent.change(screen.getByLabelText(/^API 키/), { target: { value: " draft-key " } });
  fireEvent.click(screen.getByRole("tab", { name: "기본 동작" }));
  rerender(<SettingsPanel snapshot={{ ...READY_4B, settings: { ...READY_4B.settings } }} />);
  fireEvent.click(screen.getByRole("tab", { name: "대화 모델" }));
  expect(screen.getByLabelText("API 주소")).toHaveProperty("value", "https://draft.example/v1");
  expect(screen.getByLabelText(/^API 키/)).toHaveProperty("value", " draft-key ");
  fireEvent.click(screen.getByRole("button", { name: "설정 저장" }));
  expect(screen.getByLabelText("API 주소").matches(":disabled")).toBe(true);
  expect(screen.getByLabelText(/^API 키/).matches(":disabled")).toBe(true);
  expect(screen.getByRole("button", { name: /이 기기에서/ }).matches(":disabled")).toBe(true);
  expect(command).toHaveBeenCalledWith("save_settings", {
    settings: { ...READY_4B.settings, mode: "api", baseUrl: "https://draft.example/v1" },
    apiKey: "draft-key",
  });
  finish();
  await waitFor(() => expect(screen.getByLabelText(/^API 키/)).toHaveProperty("value", ""));
});

it("preserves personal wordbook whitespace while visiting other settings sections", () => {
  const entries = [
    {
      id: "draft",
      title: "인사",
      keywords: ["안녕"],
      enabled: true,
      useForIdle: false,
      lines: [{ persona: "a" as const, expression: "평온", text: "안녕" }],
    },
  ];
  const snapshot = { ...READY_4B, wordbook: entries };
  const { rerender } = render(<SettingsPanel snapshot={snapshot} />);
  fireEvent.click(screen.getByRole("tab", { name: "개인 단어장" }));
  fireEvent.change(screen.getByLabelText("대사 1"), {
    target: { value: "  쓰던 말\n\n다음 줄  " },
  });
  fireEvent.click(screen.getByRole("tab", { name: "기억" }));
  expect(screen.queryByRole("button", { name: "단어장 저장" })).toBeNull();
  rerender(<SettingsPanel snapshot={{ ...snapshot, wordbook: [...entries] }} />);
  fireEvent.click(screen.getByRole("tab", { name: "개인 단어장" }));
  expect(screen.getByLabelText("대사 1")).toHaveProperty("value", "  쓰던 말\n\n다음 줄  ");
});

it("disables autonomous subsettings without clearing their saved choices", () => {
  render(
    <SettingsPanel
      snapshot={{
        ...READY_4B,
        settings: { ...READY_4B.settings, localIdleEnabled: true, apiIdleEnabled: true },
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText(/이야기 간격/), { target: { value: "0" } });
  expect(screen.getByRole("button", { name: "설정 저장" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByLabelText("바탕화면에서 먼저 이야기하기"));
  expect(screen.getByLabelText(/이야기 간격/).matches(":disabled")).toBe(false);
  fireEvent.change(screen.getByLabelText(/이야기 간격/), { target: { value: "12" } });
  expect(screen.getByRole("button", { name: "설정 저장" })).toHaveProperty("disabled", false);
  for (const label of ["로컬 모델로 새 잡담 만들기", "API로 새 잡담 만들기"]) {
    expect(screen.getByLabelText(label).matches(":disabled")).toBe(true);
    expect(screen.getByLabelText(label)).toHaveProperty("checked", true);
  }
  fireEvent.click(screen.getByLabelText("바탕화면에서 먼저 이야기하기"));
  expect(screen.getByLabelText("API로 새 잡담 만들기")).toHaveProperty("disabled", false);
  expect(screen.getByLabelText("API로 새 잡담 만들기")).toHaveProperty("checked", true);
});
