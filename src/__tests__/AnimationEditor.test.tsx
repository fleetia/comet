import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CharacterManager } from "../components/CharacterManager/CharacterManager";
import { animationError, appendFrames, sheetFrames } from "../components/AnimationEditor/helpers";
import { command, PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";
import type { AnimationAsset, CharacterAnimation, CharacterDefinition } from "../types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => false,
}));
vi.mock("../hooks/useAnimationFrames", () => ({
  useAnimationFrames: () => ({ frames: null, ready: false, error: null }),
}));

const asset = (id: string, width = 16, height = 16): AnimationAsset => ({
  assetId: id,
  mime: "image/png",
  width,
  height,
  data: `png-${id}`,
});
const first = asset("first");
const second = asset("second");
const third = asset("third");
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(command).mockReset();
  vi.mocked(command).mockImplementation(async (name) =>
    name === "get_character_dialogue" ? { pairScenes: [], wordbook: [] } : undefined,
  );
});
function appearance(): void {
  fireEvent.click(
    within(screen.getByRole("tablist", { name: "캐릭터 편집" })).getByRole("tab", {
      name: "모습·표정",
    }),
  );
}
function chooseCharacter(name: RegExp): void {
  fireEvent.click(within(screen.getByLabelText("설치된 캐릭터")).getByRole("button", { name }));
}
function createClip(): void {
  appearance();
  fireEvent.click(
    within(screen.getByLabelText("애니메이션")).getByRole("button", { name: "동작 추가" }),
  );
  fireEvent.change(screen.getByLabelText("동작 이름"), { target: { value: "깜빡" } });
}
function latestSave(): { definition: CharacterDefinition; animationAssets?: AnimationAsset[] } {
  const args = vi
    .mocked(command)
    .mock.calls.filter(([name]) => name === "save_character")
    .at(-1)?.[1];
  expect(args).toBeTruthy();
  return args as { definition: CharacterDefinition; animationAssets?: AnimationAsset[] };
}

it("saves ordered frames and situation mappings atomically", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "choose_animation_assets") return [first, second, third];
    if (name === "get_character_dialogue") return { pairScenes: [], wordbook: [] };
  });
  render(<CharacterManager embedded snapshot={PREVIEW_SNAPSHOT} />);
  createClip();
  expect(screen.getByLabelText("동작 속도(fps)")).toHaveProperty("value", "8");
  expect(screen.getByText("캐릭터 저장", { selector: "button" })).toHaveProperty("disabled", true);
  fireEvent.click(
    within(screen.getByLabelText("애니메이션")).getByRole("button", {
      name: "PNG/APNG 프레임 추가",
    }),
  );
  await screen.findByLabelText("3번 프레임 선택");
  fireEvent.click(screen.getByLabelText("3번 프레임 앞으로"));
  fireEvent.click(screen.getByLabelText("3번 프레임 삭제"));
  fireEvent.change(screen.getByLabelText("동작 속도(fps)"), { target: { value: "12" } });
  const clipId = (screen.getByLabelText("편집할 동작") as HTMLSelectElement).value;
  fireEvent.change(screen.getByLabelText("평소 동작"), { target: { value: clipId } });
  expect(screen.getByLabelText("평소 반복 간격(초)")).toHaveProperty("value", "3");
  fireEvent.change(screen.getByLabelText("평소 반복 간격(초)"), { target: { value: "2.5" } });
  fireEvent.change(screen.getByLabelText("말하는 동안 동작"), { target: { value: clipId } });
  expect(screen.getByLabelText("말하는 동안 반복 간격(초)")).toHaveProperty("value", "0");
  fireEvent.change(screen.getByLabelText("클릭했을 때 동작"), { target: { value: clipId } });
  fireEvent.change(screen.getByLabelText("기쁨 · 평소 동작"), { target: { value: "$none" } });
  fireEvent.change(screen.getByLabelText("기쁨 · 말하는 동안 동작"), { target: { value: clipId } });
  fireEvent.change(screen.getByLabelText("기쁨 · 말하는 동안 동작"), {
    target: { value: "$inherit" },
  });
  fireEvent.click(screen.getByText("캐릭터 저장", { selector: "button" }));
  await waitFor(() =>
    expect(vi.mocked(command).mock.calls.some(([name]) => name === "save_character")).toBe(true),
  );
  const saved = latestSave();
  expect(saved.animationAssets).toEqual([first, third]);
  expect(saved.definition.animation).toEqual({
    clips: [
      {
        id: clipId,
        name: "깜빡",
        fps: 12,
        frames: [first, third].map(({ assetId, width, height }) => ({
          assetId,
          x: 0,
          y: 0,
          width,
          height,
        })),
      },
    ],
    bindings: {
      idle: { clipId, repeat: true, intervalMs: 2500 },
      speaking: { clipId, repeat: true, intervalMs: 0 },
      click: { clipId, repeat: false, intervalMs: 0 },
    },
    overrides: { 기쁨: { idle: null } },
  });
});

it("preserves animation images through character and tab changes, failed save and cancellation", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "choose_animation_assets") return [first];
    if (name === "get_character_dialogue") return { pairScenes: [], wordbook: [] };
    if (name === "save_character") throw new Error("디스크에 저장하지 못했어요.");
  });
  const dirty = vi.fn();
  render(<CharacterManager embedded snapshot={PREVIEW_SNAPSHOT} onDirtyChange={dirty} />);
  createClip();
  fireEvent.click(
    within(screen.getByLabelText("애니메이션")).getByRole("button", {
      name: "PNG/APNG 프레임 추가",
    }),
  );
  await screen.findByLabelText("1번 프레임 선택");
  fireEvent.change(screen.getByLabelText("동작 속도(fps)"), { target: { value: "12" } });
  chooseCharacter(/^B/);
  expect(screen.getByLabelText("편집할 동작")).toHaveProperty("value", "");
  expect(
    within(screen.getByLabelText("설치된 캐릭터")).getByRole("button", { name: "조합 내보내기" }),
  ).toHaveProperty("disabled", false);
  chooseCharacter(/^A/);
  expect(screen.getByLabelText("동작 속도(fps)")).toHaveProperty("value", "12");
  expect(
    within(screen.getByLabelText("설치된 캐릭터")).getByRole("button", { name: "조합 내보내기" }),
  ).toHaveProperty("disabled", true);
  fireEvent.click(
    within(screen.getByRole("tablist", { name: "캐릭터 편집" })).getByRole("tab", {
      name: "프로필",
    }),
  );
  appearance();
  expect(screen.getByLabelText("동작 이름")).toHaveProperty("value", "깜빡");
  fireEvent.click(screen.getByText("캐릭터 저장", { selector: "button" }));
  await screen.findByText("디스크에 저장하지 못했어요.");
  expect(latestSave().animationAssets).toEqual([first]);
  expect(latestSave().definition.animation?.clips[0].frames[0].assetId).toBe(first.assetId);
  expect(screen.getByLabelText("동작 이름")).toHaveProperty("value", "깜빡");
  expect(dirty).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByText("캐릭터 수정 취소", { selector: "button" }));
  expect(screen.queryByLabelText("동작 이름")).toBeNull();
  expect(dirty).toHaveBeenLastCalledWith(false);
});

it("rejects stale image selections after character navigation and draft cancellation", async () => {
  let resolve: (assets: AnimationAsset[]) => void = () => {};
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "choose_animation_assets")
      return new Promise<AnimationAsset[]>((done) => {
        resolve = done;
      });
    if (name === "get_character_dialogue") return { pairScenes: [], wordbook: [] };
  });
  render(<CharacterManager embedded snapshot={PREVIEW_SNAPSHOT} />);
  createClip();
  fireEvent.click(screen.getByRole("button", { name: "PNG/APNG 프레임 추가" }));
  chooseCharacter(/^B/);
  chooseCharacter(/^A/);
  await act(async () => resolve([first]));
  expect(screen.queryByRole("button", { name: "1번 프레임 선택" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "PNG/APNG 프레임 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 수정 취소" }));
  await act(async () => resolve([second]));
  expect(screen.queryByLabelText("동작 이름")).toBeNull();
  expect(screen.getByRole("button", { name: "캐릭터 저장" })).toHaveProperty("disabled", true);
  expect(vi.mocked(command).mock.calls.filter(([name]) => name === "save_character")).toHaveLength(
    0,
  );
});

it("imports a sheet in row order and rejects unequal sequence dimensions without altering the draft", async () => {
  const sheet = asset("sheet", 48, 32);
  let selected = [sheet];
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "choose_animation_assets") return selected;
    if (name === "get_character_dialogue") return { pairScenes: [], wordbook: [] };
  });
  render(<CharacterManager embedded snapshot={PREVIEW_SNAPSHOT} />);
  createClip();
  fireEvent.change(screen.getByLabelText("시트 칸 너비(px)"), { target: { value: "16" } });
  fireEvent.change(screen.getByLabelText("시트 칸 높이(px)"), { target: { value: "16" } });
  fireEvent.change(screen.getByLabelText("시트 프레임 수"), { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "스프라이트 시트 추가" }));
  await screen.findByRole("button", { name: "5번 프레임 선택" });
  fireEvent.click(screen.getByRole("button", { name: "다음 프레임" }));
  expect(screen.getByText("2 / 5 프레임")).toBeTruthy();
  selected = [asset("wrong-size", 32, 16)];
  fireEvent.click(screen.getByRole("button", { name: "PNG/APNG 프레임 추가" }));
  await screen.findByText("한 동작의 모든 프레임은 너비와 높이가 같아야 해요.");
  expect(screen.queryByRole("button", { name: "6번 프레임 선택" })).toBeNull();
  selected = [first, second];
  fireEvent.click(screen.getByRole("button", { name: "스프라이트 시트 추가" }));
  await screen.findByText(
    "스프라이트 시트는 정지 PNG 한 장만 선택해 주세요. APNG는 프레임 추가로 가져오세요.",
  );
  expect(screen.queryByRole("button", { name: "6번 프레임 선택" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 저장" }));
  await waitFor(() =>
    expect(vi.mocked(command).mock.calls.some(([name]) => name === "save_character")).toBe(true),
  );
  const saved = latestSave();
  expect(saved.animationAssets).toEqual([sheet]);
  expect(saved.definition.animation?.clips[0].frames.map(({ x, y }) => [x, y])).toEqual([
    [0, 0],
    [16, 0],
    [32, 0],
    [0, 16],
    [16, 16],
  ]);
});

it("clears deleted clip mappings and prunes expression overrides when the expression is removed", async () => {
  const animation: CharacterAnimation = {
    clips: [
      {
        id: "blink",
        name: "깜빡",
        fps: 8,
        frames: [{ assetId: "first", x: 0, y: 0, width: 16, height: 16 }],
      },
    ],
    bindings: { idle: { clipId: "blink", repeat: true, intervalMs: 3000 } },
    overrides: { 기쁨: { idle: { clipId: "blink", repeat: false, intervalMs: 0 } } },
  };
  render(
    <CharacterManager
      embedded
      snapshot={{
        ...PREVIEW_SNAPSHOT,
        characters: {
          ...PREVIEW_SNAPSHOT.characters,
          installed: PREVIEW_SNAPSHOT.characters.installed.map((character, index) =>
            index
              ? character
              : {
                  ...character,
                  animationAssets: { first },
                  definition: { ...character.definition, animation },
                },
          ),
        },
      }}
    />,
  );
  appearance();
  fireEvent.click(screen.getByRole("button", { name: "기쁨 표정 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "동작 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 저장" }));
  await waitFor(() =>
    expect(vi.mocked(command).mock.calls.some(([name]) => name === "save_character")).toBe(true),
  );
  expect(latestSave().definition.animation).toBeNull();
  expect(latestSave().animationAssets).toBeUndefined();
});

it("enforces frame count, sheet bounds, speed and decoded asset budget before saving", () => {
  const sheet = asset("big", 4096, 4096);
  expect(() => sheetFrames(sheet, 0, 16, 1)).toThrow();
  expect(() => sheetFrames(first, 16, 16, 2)).toThrow();
  const frame = { assetId: "big", x: 0, y: 0, width: 16, height: 16 };
  expect(() =>
    appendFrames({ id: "x", name: "x", fps: 8, frames: Array(64).fill(frame) }, [frame]),
  ).toThrow("64장");
  const animation: CharacterAnimation = {
    clips: [{ id: "x", name: "x", fps: 8, frames: [frame] }],
    bindings: {},
    overrides: {},
  };
  expect(animationError(animation, { big: sheet })).toBeNull();
  animation.clips[0].fps = 31;
  expect(animationError(animation, { big: sheet })).toContain("1~30");
  animation.clips[0].fps = 8;
  animation.clips[0].frames.push({ ...frame, assetId: "second" });
  expect(animationError(animation, { big: sheet, second })).toContain("64 MiB");
});

it("creates a new character with draft images and ignores image selection finishing after save starts", async () => {
  let pickerCount = 0;
  let resolvePicker: (assets: AnimationAsset[]) => void = () => {};
  let resolveCreate: (
    character: (typeof PREVIEW_SNAPSHOT.characters.installed)[0],
  ) => void = () => {};
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "choose_animation_assets") {
      pickerCount += 1;
      if (pickerCount === 1) return [first];
      return new Promise<AnimationAsset[]>((resolve) => {
        resolvePicker = resolve;
      });
    }
    if (name === "create_character")
      return new Promise((resolve) => {
        resolveCreate = resolve;
      });
    if (name === "get_character_dialogue") return { pairScenes: [], wordbook: [] };
  });
  const dirty = vi.fn();
  render(<CharacterManager embedded snapshot={PREVIEW_SNAPSHOT} onDirtyChange={dirty} />);
  fireEvent.click(screen.getByRole("button", { name: "추가" }));
  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "새 친구" } });
  createClip();
  fireEvent.click(screen.getByRole("button", { name: "PNG/APNG 프레임 추가" }));
  await screen.findByRole("button", { name: "1번 프레임 선택" });
  fireEvent.click(screen.getByRole("button", { name: "PNG/APNG 프레임 추가" }));
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 저장" }));
  const args = vi.mocked(command).mock.calls.find(([name]) => name === "create_character")?.[1] as {
    definition: CharacterDefinition;
    animationAssets: AnimationAsset[];
  };
  expect(args.animationAssets).toEqual([first]);
  await act(async () => resolvePicker([second]));
  expect(screen.queryByRole("button", { name: "2번 프레임 선택" })).toBeNull();
  await act(async () =>
    resolveCreate({
      id: "new-friend",
      packId: null,
      sprites: {},
      definition: args.definition,
      animationAssets: { first },
    }),
  );
  expect(screen.getByLabelText("동작 이름")).toHaveProperty("value", "깜빡");
  expect(screen.getByRole("button", { name: "캐릭터 저장" })).toHaveProperty("disabled", true);
  expect(dirty).toHaveBeenLastCalledWith(false);
});
