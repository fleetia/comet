import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CharacterManager } from "../components/CharacterManager/CharacterManager";
import { CharacterEditor } from "../components/CharacterEditor/CharacterEditor";
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
  fireEvent.change(screen.getByLabelText("캐릭터 지침"), {
    target: { value: "  짧게 답해요.\n모르면 물어봐요.  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "관계 추가" }));
  fireEvent.change(screen.getByLabelText("관계 1 대상"), {
    target: { value: extra.id },
  });
  fireEvent.change(screen.getByLabelText("관계 1 설명"), {
    target: { value: "  오래된 친구.\n편하게 장난쳐요.  " },
  });
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
  expect(screen.getByLabelText("캐릭터 지침")).toHaveProperty(
    "value",
    "  짧게 답해요.\n모르면 물어봐요.  ",
  );
  expect(screen.getByLabelText("관계 1 대상")).toHaveProperty("value", extra.id);
  expect(screen.getByLabelText("관계 1 설명")).toHaveProperty(
    "value",
    "  오래된 친구.\n편하게 장난쳐요.  ",
  );
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
      instructions: "  짧게 답해요.\n모르면 물어봐요.  ",
      relationships: [{ targetId: extra.id, description: "  오래된 친구.\n편하게 장난쳐요.  " }],
      greeting: [
        { ...snapshot.characters.installed[0].definition.greeting[0], text: "  안녕.\n반가워.  " },
        ...snapshot.characters.installed[0].definition.greeting.slice(1),
      ],
    }),
  });
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 수정 취소" }));
  expect(screen.getByLabelText("캐릭터 지침")).toHaveProperty("value", "");
  expect(screen.queryByLabelText("관계 1 설명")).toBeNull();
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  choose(/^B/);
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 수정 취소" }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
});

it("keeps instructions and directional relationships on their owner while a save is pending", async () => {
  let finish: () => void = () => {};
  vi.mocked(command).mockImplementation((name) =>
    name === "save_character"
      ? new Promise<void>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ pairScenes: [], wordbook: [] }),
  );
  render(<CharacterManager embedded snapshot={snapshot} />);
  fireEvent.change(screen.getByLabelText("캐릭터 지침"), {
    target: { value: "한 문장으로 답해요." },
  });
  fireEvent.click(screen.getByRole("button", { name: "관계 추가" }));
  expect(screen.getByLabelText("관계 1 대상")).toHaveProperty("value", "builtin-b");
  expect(screen.getByRole("button", { name: "캐릭터 저장" })).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("관계 1 설명"), { target: { value: "  \n " } });
  expect(screen.getByRole("button", { name: "캐릭터 저장" })).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("관계 1 설명"), {
    target: { value: "존경하는 선배예요." },
  });
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 저장" }));
  expect(screen.getByLabelText("캐릭터 지침").closest("fieldset")).toHaveProperty("disabled", true);
  expect(screen.getByLabelText("관계 1 대상").closest("fieldset")).toHaveProperty("disabled", true);
  choose(/^B/);
  expect(screen.getByLabelText("캐릭터 지침")).toHaveProperty("value", "");
  expect(screen.queryByLabelText("관계 1 설명")).toBeNull();
  fireEvent.change(screen.getByLabelText("캐릭터 지침"), {
    target: { value: "차분하게 대답해요." },
  });
  finish();
  await screen.findByText("A 캐릭터를 저장했어요.");
  expect(screen.getByLabelText("캐릭터 지침")).toHaveProperty("value", "차분하게 대답해요.");
  expect(command).toHaveBeenCalledWith("save_character", {
    id: "builtin-a",
    definition: expect.objectContaining({
      instructions: "한 문장으로 답해요.",
      relationships: [{ targetId: "builtin-b", description: "존경하는 선배예요." }],
    }),
  });
});

it("offers other installed identities once and distinguishes duplicate names", () => {
  const duplicate = { ...extra, id: "another-friend" };
  render(
    <CharacterManager
      embedded
      snapshot={{
        ...snapshot,
        characters: {
          ...snapshot.characters,
          installed: [...snapshot.characters.installed, duplicate],
        },
      }}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "관계 추가" }));
  const first = within(screen.getByLabelText("관계 1 대상"));
  expect(first.queryByRole("option", { name: "A" })).toBeNull();
  expect(first.getByRole("option", { name: "모래 · g-friend" })).toHaveProperty("value", extra.id);
  expect(first.getByRole("option", { name: "모래 · r-friend" })).toHaveProperty(
    "value",
    duplicate.id,
  );
  fireEvent.click(screen.getByRole("button", { name: "관계 추가" }));
  expect(screen.getByLabelText("관계 2 대상")).toHaveProperty("value", extra.id);
  expect(
    within(screen.getByLabelText("관계 2 대상")).queryByRole("option", { name: "B" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "관계 1 삭제" }));
  expect(screen.getByLabelText("관계 1 대상")).toHaveProperty("value", extra.id);
  expect(
    within(screen.getByLabelText("관계 1 대상")).getByRole("option", { name: "B" }),
  ).toBeTruthy();
});

it("preserves deleted relationship targets while blocking new missing, self and duplicate targets", () => {
  const original = snapshot.characters.installed[0];
  const character = {
    ...original,
    definition: {
      ...original.definition,
      relationships: [{ targetId: "removed-friend", description: "옛 친구" }],
    },
  };
  const onChange = vi.fn();
  const props = {
    character,
    installed: snapshot.characters.installed,
    onChange,
    onSave: vi.fn(),
    pending: false,
    dirty: true,
  };
  const { rerender } = render(<CharacterEditor {...props} definition={character.definition} />);
  expect(screen.getByRole("option", { name: "삭제된 캐릭터 · d-friend" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "캐릭터 저장" })).toHaveProperty("disabled", false);
  fireEvent.click(screen.getByRole("button", { name: "관계 1 삭제" }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ relationships: [] }));
  for (const relationships of [
    [{ targetId: "new-missing", description: "미등록" }],
    [{ targetId: original.id, description: "자기 자신" }],
    [
      { targetId: extra.id, description: "첫 설명" },
      { targetId: extra.id, description: "두 번째 설명" },
    ],
  ]) {
    rerender(
      <CharacterEditor {...props} definition={{ ...character.definition, relationships }} />,
    );
    expect(screen.getByRole("button", { name: "캐릭터 저장" })).toHaveProperty("disabled", true);
  }
});

it("allows saving imported emoji instructions and relationships within the character limits", async () => {
  const original = snapshot.characters.installed[0];
  const definition = {
    ...original.definition,
    instructions: "🙂".repeat(2000),
    relationships: [{ targetId: extra.id, description: "🌟".repeat(500) }],
  };
  render(
    <CharacterManager
      embedded
      snapshot={{
        ...snapshot,
        characters: {
          ...snapshot.characters,
          installed: [{ ...original, definition }, ...snapshot.characters.installed.slice(1)],
        },
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "이름 수정" } });
  expect(screen.getByRole("button", { name: "캐릭터 저장" })).toHaveProperty("disabled", false);
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_character", {
      id: original.id,
      definition: { ...definition, name: "이름 수정" },
    }),
  );
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
