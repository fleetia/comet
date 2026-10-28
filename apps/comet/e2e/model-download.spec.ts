import type { Page } from "@playwright/test";
import { expect, test, type FakeTauri } from "./tauri";
import type { Snapshot } from "../src/types";

type DownloadProgress = NonNullable<Snapshot["runtime"]["download"]>;

// A tiny fake catalog entry: progress is driven by app-state events like the native download task.
const SIZE = 6_000_000;

async function modelBackend(page: Page, tauri: FakeTauri) {
  let snapshot: Snapshot = await (async () => {
    await page.goto("/");
    const preview = await tauri.previewSnapshot();
    return {
      ...preview,
      localModels: preview.localModels.map((model) =>
        model.id === preview.settings.localModel
          ? { ...model, size: SIZE, ready: false, downloadedBytes: 0 }
          : model,
      ),
    };
  })();
  const selected = snapshot.settings.localModel;
  tauri.handle("get_snapshot", () => snapshot);
  tauri.handle("get_settings_section", () => "model");
  const publish = async (
    download: DownloadProgress | null,
    model?: { ready: boolean; downloadedBytes: number },
  ) => {
    snapshot = {
      ...snapshot,
      runtime: { ...snapshot.runtime, download },
      localModels: model
        ? snapshot.localModels.map((value) =>
            value.id === selected ? { ...value, ...model } : value,
          )
        : snapshot.localModels,
    };
    await tauri.emit("app-state", snapshot);
  };
  const progress = (received: number, status: DownloadProgress["status"]): DownloadProgress => ({
    model: selected,
    received,
    total: SIZE,
    status,
    error: status === "cancelled" ? "취소됨" : null,
  });
  return { publish, progress };
}

const panel = (page: Page) => page.getByRole("tabpanel", { name: "AI 연결" });
const ring = (page: Page) => page.getByRole("progressbar", { name: "모델 다운로드 진행률" });

test("downloading from the catalog moves through progress and verification to ready", async ({
  page,
  tauri,
}) => {
  const { publish, progress } = await modelBackend(page, tauri);
  tauri.handle("download_model", () => publish(progress(0, "downloading")));
  await tauri.open("settings");
  await panel(page).getByRole("button", { name: "내려받기" }).click();
  expect(tauri.called("download_model")).toHaveLength(1);
  await expect(panel(page).getByRole("button", { name: "멈추기" })).toBeVisible();

  await publish(progress(SIZE / 2, "downloading"));
  await expect(ring(page)).toHaveAttribute("aria-valuenow", "50");
  await expect(ring(page)).toContainText("내려받는 중");
  await publish(progress(SIZE, "verifying"));
  await expect(ring(page)).toContainText("파일 확인 중");
  await publish(progress(SIZE, "ready"), { ready: true, downloadedBytes: SIZE });

  await expect(ring(page)).toHaveAttribute("aria-valuenow", "100");
  await expect(ring(page)).toContainText("준비됨");
  await expect(ring(page)).toContainText("대화할 수 있어요");
  await expect(panel(page).getByRole("button", { name: /멈추기|내려받기|이어받기/ })).toHaveCount(
    0,
  );
  await expect(panel(page).getByRole("button", { name: "확인하기" })).toBeEnabled();
});

test("cancelling mid-download returns the controls and keeps only resumable progress", async ({
  page,
  tauri,
}) => {
  const { publish, progress } = await modelBackend(page, tauri);
  tauri.handle("download_model", () => publish(progress(0, "downloading")));
  // The native task stops, keeps the partial file for resuming and releases the download slot.
  tauri.handle("cancel_download", async () => {
    await publish(progress(SIZE / 3, "cancelled"), { ready: false, downloadedBytes: SIZE / 3 });
  });
  await tauri.open("settings");
  await panel(page).getByRole("button", { name: "내려받기" }).click();
  await publish(progress(SIZE / 3, "downloading"));
  await expect(ring(page)).toHaveAttribute("aria-valuenow", "33");

  await panel(page).getByRole("button", { name: "멈추기" }).click();
  expect(tauri.called("cancel_download")).toHaveLength(1);
  await expect(panel(page).getByRole("button", { name: "멈추기" })).toBeHidden();
  const resume = panel(page).getByRole("button", { name: "이어받기" });
  await expect(resume).toBeEnabled();
  await expect(ring(page)).toContainText("모델 준비 필요");
  await expect(ring(page)).not.toContainText("준비됨");
  await expect(panel(page).getByRole("button", { name: "확인하기" })).toBeDisabled();

  // Resuming is a new download request, not a replay of the cancelled one.
  await resume.click();
  expect(tauri.called("download_model")).toHaveLength(2);
});
