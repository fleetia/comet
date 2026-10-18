import { openCharacterPage, selectFriend, openFriendPacks } from "./characterNavigation";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CharacterManager } from "../components/CharacterManager/CharacterManager";
import { CharacterPackSelector } from "../components/CharacterPackSelector/CharacterPackSelector";
import { command, PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";
import type { CharacterCollection, InstalledCharacterPack } from "../types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
afterEach(cleanup);

const characters: CharacterCollection = {
  installed: [
    ...PREVIEW_SNAPSHOT.characters.installed.map((character) => ({ ...character, packId: "pair" })),
    {
      ...PREVIEW_SNAPSHOT.characters.installed[0],
      id: "solo",
      packId: "solo-pack",
      definition: { ...PREVIEW_SNAPSHOT.characters.installed[0].definition, name: "모래" },
    },
  ],
  active: ["builtin-a", "builtin-b"],
};
const packs: InstalledCharacterPack[] = [
  { id: "pair", name: "별 친구", characterIds: ["builtin-a", "builtin-b"] },
  { id: "solo-pack", name: "별 친구", characterIds: ["solo"] },
];
const props = {
  characters,
  disabled: false,
  hasUnsavedChanges: false,
  onPendingChange: vi.fn(),
  onApplied: vi.fn(),
  selectedCharacterId: null,
  onSelectCharacter: vi.fn(),
  onCreate: vi.fn(),
  onImport: vi.fn(),
};

beforeEach(() => {
  vi.mocked(command).mockReset();
  props.onApplied.mockReset();
  props.onPendingChange.mockReset();
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "count_character_memories") return 0;
    if (name === "list_memories")
      return { items: [], total: 0, offset: 0, nextOffset: null, revision: 0 };
    if (name === "get_character_pack_attribution") {
      return { author: "", sourceUrl: "" };
    }
    if (name === "get_character_packs") {
      return packs;
    }
    if (name === "get_character_dialogue") {
      return { pairScenes: [], wordbook: [] };
    }
    return undefined;
  });
});

const pack = (name: string) => screen.findByRole("region", { name });
const applyIn = (region: HTMLElement) =>
  within(region).getByRole("button", { name: "이 팩으로 함께 지내기" });

it("marks the current pack and replaces the roster only after applying another pack once", async () => {
  let finish: () => void = () => {};
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_character_packs") {
      return packs;
    }
    return new Promise<void>((resolve) => {
      finish = resolve;
    });
  });
  const { rerender } = render(<CharacterPackSelector {...props} />);
  const current = await pack("1. 별 친구 · 2명");
  expect(within(current).getByText("지금 함께 지내는 팩")).toBeTruthy();
  expect(within(current).queryByRole("button", { name: "이 팩으로 함께 지내기" })).toBeNull();
  const other = await pack("2. 별 친구 · 1명");
  expect(within(other).getByText(/함께 지낼 순서: 모래/)).toBeTruthy();
  expect(command).toHaveBeenCalledTimes(1);
  const apply = applyIn(other);
  fireEvent.click(apply);
  fireEvent.click(apply);
  expect(vi.mocked(command).mock.calls).toEqual([
    ["get_character_packs"],
    ["apply_character_pack", { packId: "solo-pack" }],
  ]);
  expect(within(other).getByRole("button", { name: /모래/ })).toHaveProperty("disabled", true);
  expect(props.onPendingChange).toHaveBeenCalledWith(true);
  finish();
  await screen.findByText("별 친구 팩으로 바꿨어요.");
  expect(props.onApplied).toHaveBeenCalledWith("solo");
  expect(props.onPendingChange).toHaveBeenLastCalledWith(false);
  rerender(<CharacterPackSelector {...props} characters={{ ...characters, active: ["solo"] }} />);
  expect(within(await pack("2. 별 친구 · 1명")).getByText("지금 함께 지내는 팩")).toBeTruthy();
  expect(applyIn(await pack("1. 별 친구 · 2명"))).toHaveProperty("disabled", false);
});

it("treats a mixed or reordered roster as different from the pack order", async () => {
  render(
    <CharacterPackSelector
      {...props}
      characters={{ ...characters, active: ["builtin-b", "builtin-a"] }}
    />,
  );
  const region = await pack("1. 별 친구 · 2명");
  expect(within(region).getByText(/함께 지낼 순서: A → B/)).toBeTruthy();
  expect(applyIn(region)).toHaveProperty("disabled", false);
});

it("keeps the pack available after an apply failure and allows a retry without claiming success", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_character_packs") {
      return packs;
    }
    throw new Error("팩을 적용하지 못했어요.");
  });
  render(<CharacterPackSelector {...props} />);
  fireEvent.click(applyIn(await pack("2. 별 친구 · 1명")));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "팩을 적용하지 못했어요.");
  expect(applyIn(await pack("2. 별 친구 · 1명"))).toHaveProperty("disabled", false);
  expect(props.onApplied).not.toHaveBeenCalled();
  expect(props.onPendingChange).toHaveBeenLastCalledWith(false);
  expect(screen.queryByRole("status")).toBeNull();
});

it("recovers a failed list request and explains the empty state", async () => {
  vi.mocked(command)
    .mockRejectedValueOnce(new Error("목록을 읽지 못했어요."))
    .mockResolvedValue([]);
  render(<CharacterPackSelector {...props} />);
  await screen.findByRole("alert");
  fireEvent.click(screen.getByRole("button", { name: "팩 목록 다시 불러오기" }));
  expect(await screen.findByText(/설치한 캐릭터 팩이 없어요/)).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("refreshes changed membership and ignores late list results", async () => {
  let finishOld: (value: InstalledCharacterPack[]) => void = () => {};
  vi.mocked(command).mockImplementationOnce(
    () =>
      new Promise<InstalledCharacterPack[]>((resolve) => {
        finishOld = resolve;
      }),
  );
  const { rerender } = render(<CharacterPackSelector {...props} />);
  await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  rerender(
    <CharacterPackSelector
      {...props}
      characters={{ ...characters, installed: [...characters.installed] }}
    />,
  );
  expect(command).toHaveBeenCalledTimes(1);
  const remaining = { ...characters, installed: characters.installed.slice(0, 2) };
  vi.mocked(command).mockResolvedValue([packs[0]]);
  rerender(<CharacterPackSelector {...props} characters={remaining} />);
  await pack("1. 별 친구 · 2명");
  finishOld(packs);
  await waitFor(() =>
    expect(screen.queryByRole("region", { name: "2. 별 친구 · 1명" })).toBeNull(),
  );
});

it("reports the picked friend and routes the other sources to their pages", async () => {
  const onSelectCharacter = vi.fn();
  const onCreate = vi.fn();
  const onImport = vi.fn();
  render(
    <CharacterPackSelector
      {...props}
      selectedCharacterId="solo"
      onSelectCharacter={onSelectCharacter}
      onCreate={onCreate}
      onImport={onImport}
    />,
  );
  const other = await pack("2. 별 친구 · 1명");
  const tile = within(other).getByRole("button", { name: /모래/ });
  expect(tile.getAttribute("aria-pressed")).toBe("true");
  expect(tile.textContent).toContain("쉬는 중");
  fireEvent.click(within(await pack("1. 별 친구 · 2명")).getByRole("button", { name: /^A/ }));
  expect(onSelectCharacter).toHaveBeenCalledWith("builtin-a");
  const sources = screen.getByRole("group", { name: "친구를 데려올 곳" });
  expect(
    within(sources).getByRole("button", { name: "캐릭터 팩에서" }).getAttribute("aria-pressed"),
  ).toBe("true");
  fireEvent.click(within(sources).getByRole("button", { name: "새로 만들기" }));
  fireEvent.click(within(sources).getByRole("button", { name: "파일에서" }));
  fireEvent.click(screen.getByRole("button", { name: "팩 추가…" }));
  expect(onCreate).toHaveBeenCalledTimes(1);
  expect(onImport).toHaveBeenCalledTimes(2);
  expect(vi.mocked(command).mock.calls).toEqual([["get_character_packs"]]);
});

it("adds only the picked resting friend to the roster from the add page", async () => {
  render(<CharacterManager embedded snapshot={{ ...PREVIEW_SNAPSHOT, characters }} />);
  openFriendPacks();
  const join = screen.getByRole("button", { name: "함께 지내기" });
  expect(join).toHaveProperty("disabled", true);
  fireEvent.click(within(await pack("1. 별 친구 · 2명")).getByRole("button", { name: /^A/ }));
  expect(screen.getByRole("button", { name: "함께 지내는 중" })).toHaveProperty("disabled", true);
  fireEvent.click(within(await pack("2. 별 친구 · 1명")).getByRole("button", { name: /모래/ }));
  const add = screen.getByRole("button", { name: "모래와 함께 지내기" });
  expect(vi.mocked(command).mock.calls.some(([name]) => name === "apply_character_roster")).toBe(
    false,
  );
  fireEvent.click(add);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("apply_character_roster", {
      ids: ["builtin-a", "builtin-b", "solo"],
    }),
  );
  expect(vi.mocked(command).mock.calls.some(([name]) => name === "apply_character_pack")).toBe(
    false,
  );
});

it("blocks pack application for a draft on another character and unlocks after cancelling", async () => {
  render(<CharacterManager embedded snapshot={{ ...PREVIEW_SNAPSHOT, characters }} />);
  openCharacterPage("프로필");
  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "수정 중인 A" } });
  selectFriend(/^B/);
  openFriendPacks();
  expect(applyIn(await pack("2. 별 친구 · 1명"))).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "함께 지내기" })).toHaveProperty("disabled", true);
  expect(screen.getByText(/수정 중인 캐릭터와 대사를 저장하거나 취소/)).toBeTruthy();
  fireEvent.click(
    within(screen.getByRole("navigation", { name: "친구 추가 경로" })).getByRole("button", {
      name: "친구들로 돌아가기",
    }),
  );
  selectFriend(/^수정 중인 A/);
  openCharacterPage("프로필");
  expect(screen.getByLabelText("이름")).toHaveProperty("value", "수정 중인 A");
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 수정 취소" }));
  openFriendPacks();
  expect(applyIn(await pack("2. 별 친구 · 1명"))).toHaveProperty("disabled", false);
});

it("locks character and dialogue edits during an unresolved pack switch", async () => {
  let finish: () => void = () => {};
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "count_character_memories") return 0;
    if (name === "list_memories")
      return { items: [], total: 0, offset: 0, nextOffset: null, revision: 0 };
    if (name === "get_character_pack_attribution") {
      return { author: "", sourceUrl: "" };
    }
    if (name === "get_character_packs") {
      return packs;
    }
    if (name === "apply_character_pack") {
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    }
    return { pairScenes: [], wordbook: [] };
  });
  render(<CharacterManager embedded snapshot={{ ...PREVIEW_SNAPSHOT, characters }} />);
  openCharacterPage("프로필");
  openCharacterPage("대사·반응");
  fireEvent.click(screen.getByRole("button", { name: "키워드" }));
  await screen.findByRole("textbox", { name: "제목" });
  openFriendPacks();
  fireEvent.click(applyIn(await pack("2. 별 친구 · 1명")));
  expect(screen.getByLabelText("이름").matches(":disabled")).toBe(true);
  expect(screen.getByLabelText("등록 대사 대상").matches(":disabled")).toBe(true);
  finish();
  await waitFor(() => expect(screen.getByLabelText("이름")).toHaveProperty("value", "모래"));
});
