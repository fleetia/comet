import type {
  AnimationAsset,
  AnimationAssetInfo,
  AnimationBinding,
  AnimationClip,
  AnimationFrame,
  CharacterAnimation,
} from "../../types";

export const EMPTY_ANIMATION: CharacterAnimation = { clips: [], bindings: {}, overrides: {} };
export const MAX_ANIMATION_FRAMES = 64;
export const MAX_ANIMATION_CLIPS = 32;

export function sequenceFrames(assets: AnimationAsset[]): AnimationFrame[] {
  return assets.map(({ assetId, width, height }) => ({ assetId, x: 0, y: 0, width, height }));
}

export function sheetFrames(
  asset: AnimationAsset,
  width: number,
  height: number,
  count: number,
): AnimationFrame[] {
  if (![width, height, count].every((value) => Number.isInteger(value) && value > 0)) {
    throw new Error("칸 너비·높이와 프레임 수는 1 이상의 정수로 입력해 주세요.");
  }
  const columns = Math.floor(asset.width / width);
  const rows = Math.floor(asset.height / height);
  if (count > MAX_ANIMATION_FRAMES || count > columns * rows) {
    throw new Error("프레임 수가 시트의 칸 수 또는 동작당 64장을 넘어요.");
  }
  return Array.from({ length: count }, (_, index) => ({
    assetId: asset.assetId,
    x: (index % columns) * width,
    y: Math.floor(index / columns) * height,
    width,
    height,
  }));
}

export function appendFrames(clip: AnimationClip, frames: AnimationFrame[]): AnimationClip {
  const next = [...clip.frames, ...frames];
  if (next.length > MAX_ANIMATION_FRAMES) {
    throw new Error("한 동작에는 프레임을 64장까지 넣을 수 있어요.");
  }
  const first = next[0];
  if (first && next.some(({ width, height }) => width !== first.width || height !== first.height)) {
    throw new Error("한 동작의 모든 프레임은 너비와 높이가 같아야 해요.");
  }
  return { ...clip, frames: next };
}

export function defaultBinding(
  clipId: string,
  situation: "idle" | "speaking" | "click",
): AnimationBinding {
  return { clipId, repeat: situation !== "click", intervalMs: situation === "idle" ? 3000 : 0 };
}

export function removeAnimationClip(animation: CharacterAnimation, id: string): CharacterAnimation {
  function clearBinding(
    binding: AnimationBinding | null | undefined,
  ): AnimationBinding | null | undefined {
    return binding?.clipId === id ? null : binding;
  }
  return {
    clips: animation.clips.filter((clip) => clip.id !== id),
    bindings: Object.fromEntries(
      Object.entries(animation.bindings).map(([key, binding]) => [key, clearBinding(binding)]),
    ),
    overrides: Object.fromEntries(
      Object.entries(animation.overrides).map(([expression, bindings]) => [
        expression,
        Object.fromEntries(
          Object.entries(bindings).map(([key, binding]) => [key, clearBinding(binding)]),
        ),
      ]),
    ),
  };
}

export function animationError(
  animation: CharacterAnimation | null | undefined,
  assets: Record<string, AnimationAssetInfo>,
): string | null {
  if (!animation) {
    return null;
  }
  if (animation.clips.length > MAX_ANIMATION_CLIPS) {
    return "동작은 캐릭터마다 32개까지 만들 수 있어요.";
  }
  for (const clip of animation.clips) {
    if (
      !clip.name.trim() ||
      clip.name.trim() !== clip.name ||
      /\p{Cc}/u.test(clip.name) ||
      Array.from(clip.name).length > 80
    ) {
      return "동작 이름을 앞뒤 공백 없이 1~80자로 입력해 주세요.";
    }
    if (!Number.isInteger(clip.fps) || clip.fps < 1 || clip.fps > 30) {
      return "재생 속도는 초당 1~30프레임으로 입력해 주세요.";
    }
    if (clip.frames.length === 0 || clip.frames.length > MAX_ANIMATION_FRAMES) {
      return "동작마다 프레임을 1~64장 추가해 주세요.";
    }
    const first = clip.frames[0];
    for (const frame of clip.frames) {
      const asset = assets[frame.assetId];
      if (
        !asset ||
        ![frame.x, frame.y, frame.width, frame.height].every(Number.isInteger) ||
        frame.x < 0 ||
        frame.y < 0 ||
        frame.width <= 0 ||
        frame.height <= 0 ||
        frame.width !== first.width ||
        frame.height !== first.height ||
        frame.x + frame.width > asset.width ||
        frame.y + frame.height > asset.height
      ) {
        return "프레임 이미지와 영역을 확인해 주세요. 한 동작의 프레임 크기는 같아야 해요.";
      }
    }
  }
  const bindings = [
    ...Object.values(animation.bindings),
    ...Object.values(animation.overrides).flatMap(Object.values),
  ];
  if (
    bindings.some(
      (binding) =>
        binding &&
        (!animation.clips.some((clip) => clip.id === binding.clipId) ||
          !Number.isInteger(binding.intervalMs) ||
          binding.intervalMs < 0 ||
          binding.intervalMs > 60_000),
    )
  ) {
    return "연결할 동작과 반복 간격(0~60초)을 확인해 주세요.";
  }
  const referenced = new Set(
    animation.clips.flatMap((clip) => clip.frames.map((frame) => frame.assetId)),
  );
  const bytes = [...referenced].reduce(
    (total, id) => total + assets[id].width * assets[id].height * 4,
    0,
  );
  return bytes > 64 * 1024 * 1024
    ? "캐릭터의 이미지 크기 합계가 64 MiB를 넘어요. 이미지 크기를 줄여 주세요."
    : null;
}
