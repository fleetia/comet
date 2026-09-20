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
};

beforeEach(() => {
  vi.mocked(command).mockReset();
  props.onApplied.mockReset();
  props.onPendingChange.mockReset();
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_character_packs") {
      return packs;
    }
    if (name === "get_character_dialogue") {
      return { pairScenes: [], wordbook: [] };
    }
    return undefined;
  });
});

it("previews the selected installation and replaces the roster only after applying once", async () => {
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
  const select = await screen.findByLabelText("설치한 캐릭터 팩");
  expect(select).toHaveProperty("value", "pair");
  expect(screen.getByRole("button", { name: "함께 지내는 중" })).toHaveProperty("disabled", true);
  fireEvent.change(select, { target: { value: "solo-pack" } });
  expect(screen.getByText("함께 지낼 순서: 모래")).toBeTruthy();
  expect(command).toHaveBeenCalledTimes(1);
  const apply = screen.getByRole("button", { name: "이 팩으로 함께 지내기" });
  fireEvent.click(apply);
  fireEvent.click(apply);
  expect(vi.mocked(command).mock.calls).toEqual([
    ["get_character_packs"],
    ["apply_character_pack", { packId: "solo-pack" }],
  ]);
  expect(select).toHaveProperty("disabled", true);
  expect(props.onPendingChange).toHaveBeenCalledWith(true);
  finish();
  await screen.findByText("별 친구 팩으로 바꿨어요.");
  expect(props.onApplied).toHaveBeenCalledWith("solo");
  expect(props.onPendingChange).toHaveBeenLastCalledWith(false);
  rerender(<CharacterPackSelector {...props} characters={{ ...characters, active: ["solo"] }} />);
  expect(screen.getByRole("button", { name: "함께 지내는 중" })).toHaveProperty("disabled", true);
});

it("treats a mixed or reordered roster as different from the pack order", async () => {
  render(
    <CharacterPackSelector
      {...props}
      characters={{ ...characters, active: ["builtin-b", "builtin-a"] }}
    />,
  );
  fireEvent.change(await screen.findByLabelText("설치한 캐릭터 팩"), { target: { value: "pair" } });
  expect(screen.getByText("함께 지낼 순서: A → B")).toBeTruthy();
  expect(screen.getByRole("button", { name: "이 팩으로 함께 지내기" })).toHaveProperty(
    "disabled",
    false,
  );
});

it("retains the selection on apply failure and allows a retry without claiming success", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_character_packs") {
      return packs;
    }
    throw new Error("팩을 적용하지 못했어요.");
  });
  render(<CharacterPackSelector {...props} />);
  const select = await screen.findByLabelText("설치한 캐릭터 팩");
  fireEvent.change(select, { target: { value: "solo-pack" } });
  fireEvent.click(screen.getByRole("button", { name: "이 팩으로 함께 지내기" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "팩을 적용하지 못했어요.");
  expect(select).toHaveProperty("value", "solo-pack");
  expect(screen.getByRole("button", { name: "이 팩으로 함께 지내기" })).toHaveProperty(
    "disabled",
    false,
  );
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
  expect(screen.queryByRole("combobox")).toBeNull();
});

it("refreshes changed membership, rejects a removed selection, and ignores late list results", async () => {
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
  const select = await screen.findByLabelText("설치한 캐릭터 팩");
  finishOld(packs);
  await waitFor(() =>
    expect(within(select).queryByRole("option", { name: "2. 별 친구 · 1명" })).toBeNull(),
  );
  vi.mocked(command).mockResolvedValue(packs);
  rerender(<CharacterPackSelector {...props} />);
  fireEvent.change(await screen.findByLabelText("설치한 캐릭터 팩"), {
    target: { value: "solo-pack" },
  });
  vi.mocked(command).mockResolvedValue([packs[0]]);
  rerender(<CharacterPackSelector {...props} characters={remaining} />);
  await waitFor(() =>
    expect(screen.getByLabelText("설치한 캐릭터 팩")).toHaveProperty("value", ""),
  );
  expect(screen.getByRole("button", { name: "이 팩으로 함께 지내기" })).toHaveProperty(
    "disabled",
    true,
  );
});

it("blocks switching for drafts on any character and unlocks after cancelling", async () => {
  render(<CharacterManager snapshot={{ ...PREVIEW_SNAPSHOT, characters }} />);
  const select = await screen.findByLabelText("설치한 캐릭터 팩");
  fireEvent.change(select, { target: { value: "solo-pack" } });
  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "수정 중인 A" } });
  fireEvent.click(
    within(screen.getByLabelText("설치된 캐릭터")).getByRole("button", { name: /^B/ }),
  );
  expect(select).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "이 팩으로 함께 지내기" })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByText(/수정 중인 캐릭터와 대사를 저장하거나 취소/)).toBeTruthy();
  fireEvent.click(
    within(screen.getByLabelText("설치된 캐릭터")).getByRole("button", { name: /^수정 중인 A/ }),
  );
  expect(screen.getByLabelText("이름")).toHaveProperty("value", "수정 중인 A");
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 수정 취소" }));
  expect(select).toHaveProperty("disabled", false);
});

it("prevents a new dialogue draft during an unresolved pack switch", async () => {
  let finish: () => void = () => {};
  vi.mocked(command).mockImplementation(async (name) => {
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
  render(<CharacterManager snapshot={{ ...PREVIEW_SNAPSHOT, characters }} />);
  fireEvent.change(await screen.findByLabelText("설치한 캐릭터 팩"), {
    target: { value: "solo-pack" },
  });
  fireEvent.click(screen.getByRole("tab", { name: "등록 대사" }));
  const create = await screen.findByRole("button", { name: "새 항목 만들기" });
  expect(create.matches(":disabled")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "이 팩으로 함께 지내기" }));
  expect(create.matches(":disabled")).toBe(true);
  expect(screen.getByLabelText("등록 대사 대상").matches(":disabled")).toBe(true);
  finish();
  await screen.findByText("별 친구 팩으로 바꿨어요.");
  expect(screen.getByLabelText("이름")).toHaveProperty("value", "모래");
});
