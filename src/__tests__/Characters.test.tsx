import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CharacterManager } from "../components/CharacterManager";
import { CharacterSharing } from "../components/CharacterSharing";
import { CharacterDialogueEditor } from "../components/CharacterDialogueEditor";
import { CompanionBox } from "../components/CompanionBox";
import { Balloon } from "../components/Balloon";
import { command, PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";
import type { CharacterPack, Snapshot } from "../types";
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
  id: "local-third",
  definition: { ...PREVIEW_SNAPSHOT.characters.installed[0].definition, name: "모래" },
};
const snapshot: Snapshot = {
  ...PREVIEW_SNAPSHOT,
  characters: {
    ...PREVIEW_SNAPSHOT.characters,
    installed: [...PREVIEW_SNAPSHOT.characters.installed, extra],
  },
};
const pack: CharacterPack = {
  formatVersion: 1,
  name: "별 친구",
  author: "제작자",
  license: "공유 가능",
  characters: [
    { ...extra.definition, greeting: [{ expression: "기쁨", text: "  반가워.\n어서 와.  " }] },
  ],
  pairScenes: [],
  wordbook: [],
};

it("keeps per-character drafts and exact dialogue through failed saves and snapshot refresh", async () => {
  const { rerender } = render(<CharacterManager snapshot={snapshot} />);
  await screen.findByText("이 캐릭터의 키워드 대사");
  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "새 이름" } });
  fireEvent.change(screen.getByLabelText("인사 1 대사"), {
    target: { value: "  안녕.\n반가워.  " },
  });
  fireEvent.click(
    within(screen.getByLabelText("설치된 캐릭터")).getByRole("button", { name: /^B/ }),
  );
  await screen.findByText("이 캐릭터의 키워드 대사");
  fireEvent.change(screen.getByLabelText("성격과 말투"), { target: { value: "느긋한 말투" } });
  rerender(<CharacterManager snapshot={{ ...snapshot, characters: { ...snapshot.characters } }} />);
  fireEvent.click(
    within(screen.getByLabelText("설치된 캐릭터")).getByRole("button", { name: /^새 이름/ }),
  );
  expect(screen.getByLabelText("인사 1 대사")).toHaveProperty("value", "  안녕.\n반가워.  ");
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "save_character") throw new Error("저장 실패");
    return { pairScenes: [], wordbook: [] };
  });
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 저장" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "저장 실패");
  expect(screen.getByLabelText("이름")).toHaveProperty("value", "새 이름");
  expect(command).toHaveBeenCalledWith("save_character", {
    id: "builtin-a",
    definition: expect.objectContaining({
      name: "새 이름",
      greeting: [{ expression: "기쁨", text: "  안녕.\n반가워.  " }],
    }),
  });
});

it("applies the selected inactive character once and never applies an unsaved draft", async () => {
  render(<CharacterManager snapshot={snapshot} />);
  fireEvent.click(
    within(screen.getByLabelText("설치된 캐릭터")).getByRole("button", { name: /^모래/ }),
  );
  await screen.findByText("이 캐릭터의 키워드 대사");
  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "수정 중" } });
  expect(screen.getByRole("button", { name: "A에 적용" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 수정 취소" }));
  let finish: () => void = () => {};
  vi.mocked(command).mockImplementation((name) =>
    name === "assign_character"
      ? new Promise<void>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ pairScenes: [], wordbook: [] }),
  );
  fireEvent.click(screen.getByRole("button", { name: "B에 적용" }));
  fireEvent.click(screen.getByRole("button", { name: "B에 적용" }));
  expect(vi.mocked(command).mock.calls.filter(([name]) => name === "assign_character")).toEqual([
    ["assign_character", { persona: "b", id: "local-third" }],
  ]);
  finish();
  await screen.findByText(/B에 적용했어요/);
});

it("previews a pack before install and keeps assignment an explicit separate action", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "choose_character_pack") return pack;
    if (name === "import_character_pack") return [extra];
    return undefined;
  });
  render(<CharacterSharing snapshot={snapshot} selectedId="local-third" disabled={false} />);
  fireEvent.click(screen.getByRole("button", { name: "공유 파일 가져오기" }));
  await screen.findByRole("heading", { name: "별 친구" });
  expect(vi.mocked(command).mock.calls.map(([name]) => name)).toEqual(["choose_character_pack"]);
  expect(screen.getByText(/대화 기록·기억·친밀도·API 키·모델 파일은 포함하지 않아요/)).toBeTruthy();
  expect(
    screen.getByText(
      (_, element) =>
        element?.tagName === "P" && element.textContent === "[기쁨]   반가워.\n어서 와.  ",
    ),
  ).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "내용 확인 후 설치" }));
  await screen.findByRole("button", { name: "A에 적용" });
  expect(command).toHaveBeenCalledWith("import_character_pack", { pack });
  expect(vi.mocked(command).mock.calls.some(([name]) => name === "assign_character")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "A에 적용" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("assign_character", { persona: "a", id: "local-third" }),
  );
});

it("preserves all pack preview content, initial disclosure states, and verbatim dialogue", async () => {
  const previewPack: CharacterPack = {
    ...pack,
    characters: [...pack.characters, PREVIEW_SNAPSHOT.characters.installed[1].definition],
    pairScenes: [
      [
        { persona: "a", expression: "호기심", text: "  어디로 갈까?\n천천히.  " },
        { persona: "b", expression: "평온", text: "  여기 있자.  " },
      ],
    ],
    wordbook: [
      {
        id: "ef3c2a1e-aab4-4de5-bf05-03e2c2a6bbad",
        title: "잠깐 인사",
        keywords: ["안녕", "반가워"],
        enabled: true,
        useForIdle: false,
        lines: [{ persona: "a", expression: "기쁨", text: "  왔구나.\n반가워.  " }],
      },
    ],
  };
  vi.mocked(command).mockResolvedValue(previewPack);
  render(<CharacterSharing snapshot={snapshot} selectedId="local-third" disabled={false} />);
  fireEvent.click(screen.getByRole("button", { name: "공유 파일 가져오기" }));
  const preview = within(await screen.findByLabelText("가져오기 미리보기"));
  expect(preview.getByText(`제작자: ${pack.author} · 형식 버전 1`)).toBeTruthy();
  expect(preview.getByText(`배포 조건: ${pack.license}`)).toBeTruthy();
  for (const character of previewPack.characters) {
    const details = preview
      .getByText(`${character.name} · 버전 ${character.version}`)
      .closest("details");
    expect(details).toHaveProperty("open", true);
    if (!details) {
      throw new Error("Character disclosure is missing");
    }
    const content = within(details);
    expect(content.getByText(character.description)).toBeTruthy();
    expect(content.getByText(`성격과 말투: ${character.personality}`)).toBeTruthy();
    expect(
      content.getByText(
        "평온 [평온] · 기쁨 [기쁨] · 호기심 [호기심] · 생각중 [생각중] · 걱정 [걱정] · 장난 [장난]",
      ),
    ).toBeTruthy();
    for (const line of [...character.greeting, ...character.idleLines]) {
      expect(
        content.getByText(
          (_, element) =>
            element?.tagName === "P" && element.textContent === `[${line.expression}] ${line.text}`,
        ),
      ).toBeTruthy();
    }
  }
  expect(preview.getByText("조합 대사 1개 · 키워드 대사 1개").closest("details")).toHaveProperty(
    "open",
    false,
  );
  for (const text of [
    "A [호기심]   어디로 갈까?\n천천히.  ",
    "B [평온]   여기 있자.  ",
    "A [기쁨]   왔구나.\n반가워.  ",
  ]) {
    expect(
      preview.getByText((_, element) => element?.tagName === "P" && element.textContent === text),
    ).toBeTruthy();
  }
  expect(preview.getByText("잠깐 인사 · 안녕, 반가워")).toBeTruthy();
});

it("exports the current pair without private wordbook selection and treats dialog cancellation quietly", async () => {
  vi.mocked(command).mockResolvedValue(null);
  render(<CharacterSharing snapshot={snapshot} selectedId="local-third" disabled={false} />);
  fireEvent.change(screen.getByLabelText("내보낼 대상"), { target: { value: "pair" } });
  fireEvent.click(screen.getByRole("button", { name: "공유 파일 내보내기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_character_pack", {
      ids: ["builtin-a", "builtin-b"],
      wordbookIds: [],
    }),
  );
  await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "공유 파일 가져오기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("choose_character_pack"));
  expect(screen.queryByLabelText("가져오기 미리보기")).toBeNull();
});

it("exports only the personal wordbook entries explicitly selected for sharing", async () => {
  const entries = ["공유할 인사", "개인 대사"].map((title, index) => ({
    id: `personal-${index}`,
    title,
    keywords: [title],
    enabled: true,
    useForIdle: false,
    lines: [{ persona: "a" as const, expression: "평온", text: `  ${title}\n원문  ` }],
  }));
  vi.mocked(command).mockResolvedValue(null);
  render(
    <CharacterSharing
      snapshot={{ ...snapshot, wordbook: entries }}
      selectedId="local-third"
      disabled={false}
    />,
  );
  fireEvent.click(screen.getByText("개인 단어장 선택해서 포함하기 (0개)"));
  expect(screen.getByLabelText("공유할 인사")).toHaveProperty("checked", false);
  expect(screen.getByLabelText("개인 대사")).toHaveProperty("checked", false);
  fireEvent.click(screen.getByLabelText("공유할 인사"));
  fireEvent.click(screen.getByRole("button", { name: "공유 파일 내보내기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_character_pack", {
      ids: ["local-third"],
      wordbookIds: ["personal-0"],
    }),
  );
});

it("saves one character keyword lines verbatim without assigning the other slot or touching personal wordbook", async () => {
  render(<CharacterDialogueEditor ids={["local-third"]} onDirtyChange={() => {}} />);
  await screen.findByRole("textbox", { name: "키워드" });
  fireEvent.change(screen.getByRole("textbox", { name: "제목" }), { target: { value: "인사" } });
  fireEvent.change(screen.getByRole("textbox", { name: "키워드" }), {
    target: { value: "안녕, 반가워" },
  });
  fireEvent.change(screen.getByLabelText("대사 1"), { target: { value: "  왔구나.\n반가워.  " } });
  fireEvent.click(screen.getByRole("button", { name: "대사 추가" }));
  expect(screen.getByLabelText("2번 화자")).toHaveProperty("value", "a");
  fireEvent.change(screen.getByLabelText("대사 2"), { target: { value: "둘째 줄" } });
  fireEvent.click(screen.getByRole("button", { name: "단어장 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_character_dialogue", {
      ids: ["local-third"],
      dialogue: {
        pairScenes: [],
        wordbook: [
          expect.objectContaining({
            keywords: ["안녕", "반가워"],
            lines: [
              { persona: "a", expression: "평온", text: "  왔구나.\n반가워.  " },
              { persona: "a", expression: "평온", text: "둘째 줄" },
            ],
          }),
        ],
      },
    }),
  );
  expect(vi.mocked(command).mock.calls.some(([name]) => name === "save_wordbook_entry")).toBe(
    false,
  );
});

it("renders installed names and custom expressions while keeping historical speaker identity", () => {
  const custom: Snapshot = {
    ...snapshot,
    characters: {
      installed: [
        {
          ...extra,
          definition: {
            ...extra.definition,
            expressions: { ...extra.definition.expressions, 평온: "나른", 기쁨: "활짝" },
          },
        },
        ...snapshot.characters.installed,
      ],
      active: ["local-third", "builtin-b"],
    },
    playback: {
      id: "talk",
      persona: "a",
      expression: "기쁨",
      text: "안녕",
      source: "script",
      endsAt: 100,
      lineIndex: 0,
      lineCount: 1,
    },
  };
  const { rerender } = render(<CompanionBox persona="a" snapshot={custom} />);
  expect(screen.getByRole("button", { name: "모래 메뉴 열기" })).toBeTruthy();
  expect(screen.getByText("[활짝]")).toBeTruthy();
  rerender(
    <Balloon
      snapshot={{
        ...custom,
        panel: { persona: "a", mode: "history" },
        messages: [
          {
            id: "old",
            role: "assistant",
            persona: "a",
            content: "옛 대사",
            expression: null,
            createdAt: 1,
            status: "complete",
          },
        ],
        messageIdentities: [
          {
            messageId: "old",
            persona: "a",
            characterId: "old-character",
            name: "예전 친구",
            version: 1,
          },
        ],
      }}
    />,
  );
  expect(screen.getByText("예전 친구")).toBeTruthy();
  rerender(<Balloon snapshot={{ ...custom, panel: { persona: "a", mode: "menu" } }} />);
  fireEvent.click(screen.getByRole("button", { name: "캐릭터 관리" }));
  expect(command).toHaveBeenCalledWith("open_characters", undefined);
});

it("keeps pair scene order and whitespace when saving the current two characters", async () => {
  const dialogue = {
    pairScenes: [
      [
        { persona: "a", expression: "평온", text: "  첫 말  " },
        { persona: "b", expression: "장난", text: "둘째\n말" },
      ],
    ],
    wordbook: [],
  };
  vi.mocked(command).mockImplementation(async (name) =>
    name === "get_character_dialogue" ? dialogue : undefined,
  );
  render(<CharacterDialogueEditor ids={["builtin-a", "local-third"]} onDirtyChange={() => {}} />);
  await screen.findByLabelText("장면 1 대사 1");
  fireEvent.click(screen.getByRole("button", { name: "장면 1 대사 2 위로" }));
  expect(screen.getByLabelText("장면 1 대사 1")).toHaveProperty("value", "둘째\n말");
  fireEvent.click(screen.getByRole("button", { name: "둘의 수다 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_character_dialogue", {
      ids: ["builtin-a", "local-third"],
      dialogue: {
        pairScenes: [[dialogue.pairScenes[0][1], dialogue.pairScenes[0][0]]],
        wordbook: [],
      },
    }),
  );
});

it("rejects invalid import without installation or changing the selected export target", async () => {
  vi.mocked(command).mockRejectedValueOnce(new Error("지원하지 않는 캐릭터팩 형식입니다."));
  render(<CharacterSharing snapshot={snapshot} selectedId="local-third" disabled={false} />);
  fireEvent.click(screen.getByRole("button", { name: "공유 파일 가져오기" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "지원하지 않는 캐릭터팩 형식입니다.",
  );
  expect(screen.queryByLabelText("가져오기 미리보기")).toBeNull();
  expect(screen.getByLabelText("내보낼 대상")).toHaveProperty("value", "selected");
  expect(vi.mocked(command).mock.calls).toEqual([["choose_character_pack"]]);
});

it("keeps character and dialogue drafts across tabs while locking dialogue target changes", async () => {
  render(<CharacterManager snapshot={snapshot} />);
  fireEvent.change(screen.getByLabelText("이름"), { target: { value: "쓰던 이름" } });
  fireEvent.click(screen.getByRole("tab", { name: "등록 대사" }));
  fireEvent.change(await screen.findByRole("textbox", { name: "키워드" }), {
    target: { value: "반가워" },
  });
  fireEvent.change(screen.getByLabelText("대사 1"), { target: { value: "  쓰던 인사\n반가워  " } });
  fireEvent.click(screen.getByRole("tab", { name: "기본 정보" }));
  expect(screen.getByLabelText("이름")).toHaveProperty("value", "쓰던 이름");
  expect(
    within(screen.getByLabelText("설치된 캐릭터")).getByRole("button", { name: /^B/ }),
  ).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("tab", { name: "공유" }));
  fireEvent.click(screen.getByRole("tab", { name: "등록 대사" }));
  expect(screen.getByLabelText("등록 대사 대상")).toHaveProperty("disabled", true);
  expect(screen.getByLabelText("대사 1")).toHaveProperty("value", "  쓰던 인사\n반가워  ");
  fireEvent.click(screen.getByRole("button", { name: "대사 수정 취소" }));
  await waitFor(() =>
    expect(screen.getByLabelText("등록 대사 대상")).toHaveProperty("disabled", false),
  );
});
