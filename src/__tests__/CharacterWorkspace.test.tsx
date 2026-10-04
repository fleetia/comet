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
function selectTab(name: string): void {
  fireEvent.click(
    within(screen.getByRole("tablist", { name: "캐릭터 편집" })).getByRole("tab", { name }),
  );
}
function selectPanel(name: string): ReturnType<typeof within> {
  selectTab(name);
  return within(screen.getByRole("tabpanel", { name }));
}

it("opens authored lines from the profile, previews the selected draft locally, and keeps save controls outside the scrolling body", async () => {
  render(<CharacterManager embedded snapshot={snapshot} />);
  const profile = screen.getByRole("tabpanel", { name: "프로필" });
  const save = within(profile).getByRole("button", { name: "캐릭터 저장" });
  const footer = save.closest('[data-character-footer="fixed"]');
  const body = footer?.parentElement?.querySelector('[data-character-scroll="body"]');
  expect(footer).toBeTruthy();
  expect(body).toBeTruthy();
  expect(body?.contains(save)).toBe(false);

  fireEvent.click(within(profile).getByRole("button", { name: "대사·반응 편집" }));
  const panel = within(screen.getByRole("tabpanel", { name: "대사·반응" }));
  const line = panel.getByRole("textbox", { name: "자동 수다 1 대사" });
  fireEvent.focus(line);
  fireEvent.change(line, { target: { value: "  선택한 원문.\n다음 줄.  " } });
  const preview = within(panel.getByLabelText("선택한 대사 미리보기"));
  expect(preview.getByText("선택한 원문. 다음 줄.")).toBeTruthy();
  fireEvent.click(preview.getByRole("button", { name: "미리보기" }));
  fireEvent.click(preview.getByRole("button", { name: "정지" }));
  expect(vi.mocked(command).mock.calls.some(([name]) => name !== "get_character_dialogue")).toBe(
    false,
  );

  choose(/^B/);
  choose(/^A/);
  expect(screen.getByRole("textbox", { name: "자동 수다 1 대사" })).toHaveProperty(
    "value",
    "  선택한 원문.\n다음 줄.  ",
  );
});

it("separates six editing tabs and keeps the selected tab when changing characters without changing the roster", async () => {
  render(<CharacterManager embedded snapshot={snapshot} />);
  const tabs = within(screen.getByRole("tablist", { name: "캐릭터 편집" }));
  expect(tabs.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
    "프로필",
    "모습·표정",
    "말풍선",
    "대사·반응",
    "기억",
    "관리",
  ]);
  const profile = tabs.getByRole("tab", { name: "프로필", selected: true });
  expect(
    within(screen.getByRole("tabpanel", { name: "프로필" })).getByLabelText("이름"),
  ).toHaveProperty("value", "A");
  expect(screen.queryByRole("tabpanel", { name: "모습·표정" })).toBeNull();
  fireEvent.keyDown(profile, { key: "ArrowRight" });
  const appearance = tabs.getByRole("tab", { name: "모습·표정", selected: true });
  expect(document.activeElement).toBe(appearance);
  expect(
    within(screen.getByRole("tabpanel", { name: "모습·표정" })).getByLabelText("평온 텍스트 표정"),
  ).toBeTruthy();
  fireEvent.keyDown(appearance, { key: "ArrowRight" });
  const balloon = tabs.getByRole("tab", { name: "말풍선", selected: true });
  expect(document.activeElement).toBe(balloon);
  expect(
    within(screen.getByRole("tabpanel", { name: "말풍선" })).getByLabelText("말풍선 글자 크기(px)"),
  ).toBeTruthy();
  fireEvent.keyDown(balloon, { key: "ArrowRight" });
  const dialogue = tabs.getByRole("tab", { name: "대사·반응", selected: true });
  expect(document.activeElement).toBe(dialogue);
  expect(screen.getAllByRole("tabpanel")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "키워드" }));
  await screen.findByRole("textbox", { name: "제목" });
  choose(/^B/);
  expect(tabs.getByRole("tab", { name: "대사·반응", selected: true })).toBeTruthy();
  expect(screen.getByRole("tabpanel", { name: "대사·반응" })).toBeTruthy();
  fireEvent.keyDown(dialogue, { key: "ArrowLeft" });
  expect(tabs.getByRole("tab", { name: "말풍선", selected: true })).toBeTruthy();
  fireEvent.keyDown(balloon, { key: "Home" });
  expect(tabs.getByRole("tab", { name: "프로필", selected: true })).toBeTruthy();
  expect(document.activeElement).toBe(profile);
  expect(screen.getByLabelText("이름")).toHaveProperty("value", "B");
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

it("shows an empty temporary presence without changing the active roster", () => {
  render(
    <CharacterManager
      embedded
      snapshot={{
        ...snapshot,
        settings: { ...snapshot.settings, randomPresenceEnabled: true },
        runtime: { ...snapshot.runtime, presentCharacterIds: [] },
      }}
    />,
  );
  const list = within(screen.getByLabelText("설치된 캐릭터"));
  expect(list.getAllByText(/자리 비움/)).toHaveLength(2);
  expect(screen.getByText(/함께 지내기 2 \/ 8명 · 지금 0명 표시/)).toBeTruthy();
  expect(screen.getByRole("checkbox", { name: "함께 지내기" })).toHaveProperty("checked", true);
});

it("retains exact per-character drafts across selection and snapshot changes after a save failure", async () => {
  const onDirtyChange = vi.fn();
  const { rerender } = render(
    <CharacterManager embedded snapshot={snapshot} onDirtyChange={onDirtyChange} />,
  );
  let panel = within(screen.getByRole("tabpanel", { name: "프로필" }));
  fireEvent.change(panel.getByLabelText("이름"), { target: { value: "쓰던 이름" } });
  panel = selectPanel("말풍선");
  fireEvent.change(panel.getByLabelText("말풍선 글자 크기(px)"), { target: { value: "27" } });
  fireEvent.change(panel.getByLabelText("말풍선 글자 색"), { target: { value: "#3467ab" } });
  fireEvent.change(panel.getByLabelText("말풍선 폰트"), {
    target: { value: "Apple SD Gothic Neo" },
  });
  fireEvent.change(panel.getByLabelText("글자 출력 속도 (초당 글자 수)"), {
    target: { value: "12" },
  });
  panel = selectPanel("프로필");
  fireEvent.change(panel.getByLabelText("캐릭터 지침"), {
    target: { value: "  짧게 답해요.\n모르면 물어봐요.  " },
  });
  fireEvent.click(panel.getByRole("button", { name: "관계 추가" }));
  fireEvent.change(panel.getByLabelText("관계 1 대상"), {
    target: { value: extra.id },
  });
  fireEvent.change(panel.getByLabelText("관계 1 설명"), {
    target: { value: "  오래된 친구.\n편하게 장난쳐요.  " },
  });
  panel = selectPanel("대사·반응");
  fireEvent.change(panel.getByLabelText("인사 1 대사"), {
    target: { value: "  안녕.\n반가워.  " },
  });
  fireEvent.change(panel.getByLabelText("떠남 1 대사"), {
    target: { value: "  산책 다녀올게.\n금방 올게.  " },
  });
  fireEvent.change(panel.getByLabelText("복귀 1 대사"), {
    target: { value: "  다시 왔어!  " },
  });
  choose(/^B/);
  panel = selectPanel("말풍선");
  expect(panel.getByLabelText("말풍선 글자 크기(px)")).toHaveProperty("value", "19");
  expect(panel.getByLabelText("말풍선 폰트")).toHaveProperty("value", "");
  expect(panel.getByLabelText("글자 출력 속도 (초당 글자 수)")).toHaveProperty("value", "0");
  fireEvent.change(panel.getByLabelText("말풍선 폰트"), { target: { value: "Georgia" } });
  fireEvent.change(panel.getByLabelText("글자 출력 속도 (초당 글자 수)"), {
    target: { value: "35" },
  });
  panel = selectPanel("프로필");
  fireEvent.change(panel.getByLabelText("성격과 말투"), { target: { value: "느긋한 말투" } });
  rerender(
    <CharacterManager
      embedded
      snapshot={{ ...snapshot, characters: { ...snapshot.characters } }}
      onDirtyChange={onDirtyChange}
    />,
  );
  choose(/^쓰던 이름/);
  panel = selectPanel("말풍선");
  expect(panel.getByLabelText("말풍선 글자 크기(px)")).toHaveProperty("value", "27");
  expect(panel.getByLabelText("말풍선 글자 색")).toHaveProperty("value", "#3467ab");
  expect(panel.getByLabelText("말풍선 폰트")).toHaveProperty("value", "Apple SD Gothic Neo");
  expect(panel.getByLabelText("글자 출력 속도 (초당 글자 수)")).toHaveProperty("value", "12");
  const preview = panel.getByLabelText("말풍선 글자 미리보기");
  expect(preview.style.fontSize).toBe("27px");
  expect(preview.style.color).toBe("rgb(52, 103, 171)");
  expect(preview.style.fontFamily).toContain("Apple SD Gothic Neo");
  panel = selectPanel("프로필");
  expect(panel.getByLabelText("캐릭터 지침")).toHaveProperty(
    "value",
    "  짧게 답해요.\n모르면 물어봐요.  ",
  );
  expect(panel.getByLabelText("관계 1 대상")).toHaveProperty("value", extra.id);
  expect(panel.getByLabelText("관계 1 설명")).toHaveProperty(
    "value",
    "  오래된 친구.\n편하게 장난쳐요.  ",
  );
  panel = selectPanel("대사·반응");
  expect(panel.getByRole("textbox", { name: "인사 1 대사" })).toHaveProperty(
    "value",
    "  안녕.\n반가워.  ",
  );
  expect(panel.getByRole("textbox", { name: "떠남 1 대사" })).toHaveProperty(
    "value",
    "  산책 다녀올게.\n금방 올게.  ",
  );
  expect(panel.getByRole("textbox", { name: "복귀 1 대사" })).toHaveProperty(
    "value",
    "  다시 왔어!  ",
  );
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "save_character") {
      throw new Error("저장 실패");
    }
    return { pairScenes: [], wordbook: [] };
  });
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 저장" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "저장 실패");
  panel = selectPanel("프로필");
  expect(panel.getByLabelText("이름")).toHaveProperty("value", "쓰던 이름");
  expect(command).toHaveBeenCalledWith("save_character", {
    id: "builtin-a",
    definition: expect.objectContaining({
      name: "쓰던 이름",
      balloonStyle: {
        fontSize: 27,
        textColor: "#3467ab",
        fontFamily: "Apple SD Gothic Neo",
        textSpeed: 12,
      },
      instructions: "  짧게 답해요.\n모르면 물어봐요.  ",
      relationships: [{ targetId: extra.id, description: "  오래된 친구.\n편하게 장난쳐요.  " }],
      greeting: [
        { ...snapshot.characters.installed[0].definition.greeting[0], text: "  안녕.\n반가워.  " },
        ...snapshot.characters.installed[0].definition.greeting.slice(1),
      ],
      departureLines: [
        {
          ...snapshot.characters.installed[0].definition.departureLines[0],
          text: "  산책 다녀올게.\n금방 올게.  ",
        },
      ],
      returnLines: [
        { ...snapshot.characters.installed[0].definition.returnLines[0], text: "  다시 왔어!  " },
      ],
    }),
  });
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 수정 취소" }));
  panel = selectPanel("말풍선");
  expect(panel.getByLabelText("말풍선 글자 크기(px)")).toHaveProperty("value", "19");
  expect(panel.getByLabelText("말풍선 폰트")).toHaveProperty("value", "");
  expect(panel.getByRole("button", { name: "기본색" })).toHaveProperty("disabled", true);
  expect(panel.getByLabelText("글자 출력 속도 (초당 글자 수)")).toHaveProperty("value", "0");
  panel = selectPanel("프로필");
  expect(panel.getByLabelText("캐릭터 지침")).toHaveProperty("value", "");
  expect(panel.queryByLabelText("관계 1 설명")).toBeNull();
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  choose(/^B/);
  panel = selectPanel("말풍선");
  expect(panel.getByLabelText("말풍선 폰트")).toHaveProperty("value", "Georgia");
  expect(panel.getByLabelText("글자 출력 속도 (초당 글자 수)")).toHaveProperty("value", "35");
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 수정 취소" }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
});

it("defaults older balloon styles to instant text and rejects unsupported text sizes and speeds", async () => {
  const original = snapshot.characters.installed[0];
  render(
    <CharacterManager
      embedded
      snapshot={{
        ...snapshot,
        characters: {
          ...snapshot.characters,
          installed: [
            {
              ...original,
              definition: {
                ...original.definition,
                balloonStyle: { fontSize: 19, textColor: null, fontFamily: "" },
              },
            },
            ...snapshot.characters.installed.slice(1),
          ],
        },
      }}
    />,
  );
  selectTab("말풍선");
  expect(screen.getByLabelText("글자 출력 속도 (초당 글자 수)")).toHaveProperty("value", "0");
  fireEvent.change(screen.getByLabelText("말풍선 글자 크기(px)"), { target: { value: "41" } });
  selectTab("프로필");
  expect(screen.getByRole("button", { name: "캐릭터 저장" })).toHaveProperty("disabled", true);
  selectTab("말풍선");
  fireEvent.change(screen.getByLabelText("말풍선 글자 크기(px)"), { target: { value: "24" } });
  fireEvent.change(screen.getByLabelText("말풍선 글자 색"), { target: { value: "#ffffff" } });
  fireEvent.click(screen.getByRole("button", { name: "기본색" }));
  fireEvent.change(screen.getByLabelText("말풍선 폰트"), { target: { value: "Georgia" } });
  fireEvent.change(screen.getByLabelText("말풍선 폰트"), { target: { value: "" } });
  for (const speed of ["-1", "101", "1.5"]) {
    fireEvent.change(screen.getByLabelText("글자 출력 속도 (초당 글자 수)"), {
      target: { value: speed },
    });
    expect(screen.getByRole("button", { name: "캐릭터 저장" })).toHaveProperty("disabled", true);
  }
  fireEvent.change(screen.getByLabelText("글자 출력 속도 (초당 글자 수)"), {
    target: { value: "0" },
  });
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_character", {
      id: "builtin-a",
      definition: expect.objectContaining({
        balloonStyle: { fontSize: 24, textColor: null, fontFamily: "", textSpeed: 0 },
      }),
    }),
  );
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
  selectTab("대사·반응");
  fireEvent.click(screen.getByRole("button", { name: "키워드" }));
  await screen.findByRole("textbox", { name: "제목" });
  fireEvent.change(screen.getByRole("textbox", { name: "제목" }), {
    target: { value: "첫 친구 인사" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "키워드" }), {
    target: { value: "반가워" },
  });
  fireEvent.change(screen.getByRole("textbox", { name: "대사 1" }), {
    target: { value: "  쓰던 인사\n반가워  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "인사·수다·출입" }));
  selectTab("프로필");
  selectTab("말풍선");
  selectTab("대사·반응");
  choose(/^B/);
  fireEvent.click(screen.getByRole("button", { name: "키워드" }));
  await screen.findByRole("textbox", { name: "제목" });
  fireEvent.change(screen.getByRole("textbox", { name: "제목" }), {
    target: { value: "둘째 친구 인사" },
  });
  fireEvent.click(screen.getByRole("button", { name: "인사·수다·출입" }));
  fireEvent.click(screen.getByRole("button", { name: /^추가$/ }));
  choose(/^A/);
  fireEvent.click(screen.getByRole("button", { name: "키워드" }));
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
  fireEvent.click(screen.getByRole("button", { name: "인사·수다·출입" }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  choose(/^B/);
  fireEvent.click(screen.getByRole("button", { name: "키워드" }));
  expect(screen.getByRole("textbox", { name: "제목" })).toHaveProperty("value", "둘째 친구 인사");
});
