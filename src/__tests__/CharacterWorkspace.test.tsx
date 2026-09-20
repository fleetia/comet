import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CharacterManager } from "../components/CharacterManager/CharacterManager";
import { command, PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";
import type { Snapshot } from "../types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => false,
}));
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(command).mockReset();
  vi.mocked(command).mockImplementation(async (name) =>
    name === "get_character_dialogue" ? { pairScenes: [], wordbook: [] } : undefined,
  );
});
const extra = {
  ...PREVIEW_SNAPSHOT.characters.installed[0],
  id: "resting-friend",
  definition: { ...PREVIEW_SNAPSHOT.characters.installed[0].definition, name: "모래" },
};
const snapshot: Snapshot = {
  ...PREVIEW_SNAPSHOT,
  characters: {
    ...PREVIEW_SNAPSHOT.characters,
    installed: [...PREVIEW_SNAPSHOT.characters.installed, extra],
  },
};
function choose(name: RegExp): void {
  fireEvent.click(within(screen.getByLabelText("설치된 캐릭터")).getByRole("button", { name }));
}
function closeDialog(): void {
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "닫기" }));
}

it("selects an editing target without changing the active roster and exposes the three work areas together", async () => {
  render(<CharacterManager embedded snapshot={snapshot} />);
  choose(/^B/);
  expect(screen.getByLabelText("이름")).toHaveProperty("value", "B");
  expect(screen.getByRole("region", { name: "기본 정보" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "모습과 표정" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "등록 대사" })).toBeTruthy();
  expect(screen.queryByRole("tab")).toBeNull();
  await screen.findByRole("button", { name: "키워드 대사 편집" });
  expect(vi.mocked(command).mock.calls.some(([name]) => name === "apply_character_roster")).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "앞으로" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("apply_character_roster", {
      ids: ["builtin-b", "builtin-a"],
    }),
  );
});

it("retains exact per-character drafts across selection and snapshot changes after a save failure", async () => {
  const onDirtyChange = vi.fn();
  const { rerender } = render(
    <CharacterManager embedded snapshot={snapshot} onDirtyChange={onDirtyChange} />,
  );
  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "쓰던 이름" } });
  fireEvent.click(screen.getByRole("button", { name: "인사 편집" }));
  fireEvent.change(screen.getByLabelText("인사 1 대사"), {
    target: { value: "  안녕.\n반가워.  " },
  });
  choose(/^B/);
  fireEvent.change(screen.getByLabelText("성격과 말투"), { target: { value: "느긋한 말투" } });
  rerender(
    <CharacterManager
      embedded
      snapshot={{ ...snapshot, characters: { ...snapshot.characters } }}
      onDirtyChange={onDirtyChange}
    />,
  );
  choose(/^쓰던 이름/);
  expect(screen.getByLabelText("인사 1 대사")).toHaveProperty("value", "  안녕.\n반가워.  ");
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "save_character") {
      throw new Error("저장 실패");
    }
    return { pairScenes: [], wordbook: [] };
  });
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 저장" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "저장 실패");
  expect(screen.getByLabelText("이름")).toHaveProperty("value", "쓰던 이름");
  expect(command).toHaveBeenCalledWith("save_character", {
    id: "builtin-a",
    definition: expect.objectContaining({
      name: "쓰던 이름",
      greeting: [
        { ...snapshot.characters.installed[0].definition.greeting[0], text: "  안녕.\n반가워.  " },
        ...snapshot.characters.installed[0].definition.greeting.slice(1),
      ],
    }),
  });
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 수정 취소" }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  choose(/^B/);
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 수정 취소" }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
});

it("applies a saved character once and enforces the final-member and eight-member limits", async () => {
  const { rerender } = render(<CharacterManager embedded snapshot={snapshot} />);
  choose(/^모래/);
  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "수정 중" } });
  expect(screen.getByRole("checkbox", { name: "함께 지내기" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 수정 취소" }));
  let finish: () => void = () => {};
  vi.mocked(command).mockImplementation((name) =>
    name === "apply_character_roster"
      ? new Promise<void>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ pairScenes: [], wordbook: [] }),
  );
  fireEvent.click(screen.getByRole("checkbox", { name: "함께 지내기" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "함께 지내기" }));
  expect(
    vi.mocked(command).mock.calls.filter(([name]) => name === "apply_character_roster"),
  ).toEqual([["apply_character_roster", { ids: ["builtin-a", "builtin-b", "resting-friend"] }]]);
  finish();
  await screen.findByText(/함께 지내기 시작했어요/);
  rerender(
    <CharacterManager
      embedded
      snapshot={{ ...snapshot, characters: { ...snapshot.characters, active: [extra.id] } }}
    />,
  );
  expect(screen.getByRole("checkbox", { name: "함께 지내기" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "보유 목록에서 제거" })).toHaveProperty(
    "disabled",
    true,
  );
  const full = Array.from({ length: 8 }, (_, index) => ({ ...extra, id: `active-${index}` }));
  rerender(
    <CharacterManager
      embedded
      snapshot={{
        ...snapshot,
        characters: { installed: [extra, ...full], active: full.map(({ id }) => id) },
      }}
    />,
  );
  expect(screen.getByRole("checkbox", { name: "함께 지내기" })).toHaveProperty("disabled", true);
});

it("preserves separate keyword drafts when switching characters or visiting a new character", async () => {
  const onDirtyChange = vi.fn();
  render(<CharacterManager embedded snapshot={snapshot} onDirtyChange={onDirtyChange} />);
  fireEvent.click(await screen.findByRole("button", { name: "키워드 대사 편집" }));
  fireEvent.change(screen.getByRole("textbox", { name: "제목" }), {
    target: { value: "첫 친구 인사" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "키워드" }), {
    target: { value: "반가워" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "대사 1" }), {
    target: { value: "  쓰던 인사\n반가워  " },
  });
  closeDialog();
  choose(/^B/);
  fireEvent.click(await screen.findByRole("button", { name: "키워드 대사 편집" }));
  fireEvent.change(screen.getByRole("textbox", { name: "제목" }), {
    target: { value: "둘째 친구 인사" },
  });
  closeDialog();
  fireEvent.click(screen.getByRole("button", { name: /^추가$/ }));
  choose(/^A/);
  fireEvent.click(screen.getByRole("button", { name: "키워드 대사 편집" }));
  expect(screen.getByRole("textbox", { name: "제목" })).toHaveProperty("value", "첫 친구 인사");
  expect(screen.getByRole("textbox", { name: "대사 1" })).toHaveProperty(
    "value",
    "  쓰던 인사\n반가워  ",
  );
  fireEvent.click(screen.getByRole("button", { name: "단어장 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_character_dialogue", {
      ids: ["builtin-a"],
      dialogue: expect.objectContaining({
        wordbook: [
          expect.objectContaining({
            title: "첫 친구 인사",
            lines: [expect.objectContaining({ text: "  쓰던 인사\n반가워  " })],
          }),
        ],
      }),
    }),
  );
  closeDialog();
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  choose(/^B/);
  fireEvent.click(screen.getByRole("button", { name: "키워드 대사 편집" }));
  expect(screen.getByRole("textbox", { name: "제목" })).toHaveProperty("value", "둘째 친구 인사");
});
