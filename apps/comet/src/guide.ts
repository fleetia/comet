import { invoke } from "@tauri-apps/api/core";
import type { GuidePage } from "./types";

export type GuideOpenError = { message: string; path: string };

export function openGuide(page: GuidePage): Promise<void> {
  return invoke<void>("open_guide", { page });
}
