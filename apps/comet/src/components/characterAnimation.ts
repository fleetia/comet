import { convertFileSrc } from "@tauri-apps/api/core";
import type { AnimationBinding, CharacterAnimation } from "../types";
import { isDesktop } from "../hooks/useSnapshot";

export function animationAssetUrl(characterId: string, assetId: string): string {
  if (!isDesktop()) return "";
  return `${convertFileSrc(characterId, "sprite")}?${new URLSearchParams({ asset: assetId })}`;
}

export function animationBinding(
  animation: CharacterAnimation | null | undefined,
  expression: string,
  trigger: "idle" | "speaking",
): AnimationBinding | null | undefined {
  const override = animation?.overrides[expression];
  if (override && Object.hasOwn(override, trigger)) return override[trigger];
  return animation?.bindings[trigger] ?? undefined;
}
