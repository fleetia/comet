import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CharacterManager } from "../components/CharacterManager/CharacterManager";
import { SettingsPanel } from "../components/SettingsPanel/SettingsPanel";
import { CharacterSharing } from "../components/CharacterSharing/CharacterSharing";
import { CharacterHistory } from "../components/CharacterHistory/CharacterHistory";
import { UserSettings } from "../components/UserSettings/UserSettings";
import { Balloon } from "../components/Balloon/Balloon";
import { PREVIEW_SNAPSHOT, command, isDesktop } from "../hooks/useSnapshot";
import type { Memory } from "../types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(() => true),
}));
afterEach(cleanup);
const memory: Memory = {
  id: "m-a",
  characterId: "builtin-a",
  userId: "person-1",
  userName: "민수",
  kind: "user_fact",
  content: "커피를 좋아함",
  sourceMessageId: "source",
  sourceText: "나는 커피가 좋아",
  sourceCreatedAt: 1700000000000,
  updatedAt: 1700000000000,
  retiredAt: null,
  recallWeight: 1,
};
beforeEach(() => {
  vi.mocked(isDesktop).mockReturnValue(true);
  vi.mocked(command)
    .mockReset()
    .mockImplementation(async (name, args) => {
      if (name === "count_character_memories") return 1;
      if (name === "list_memories")
        return {
          items: [
            {
              ...memory,
              id: args?.characterId === "builtin-b" ? "m-b" : "m-a",
              characterId: args?.characterId,
            },
          ],
          total: 1,
          offset: 0,
          nextOffset: null,
          revision: 1,
        };
      if (name === "get_character_dialogue") return { pairScenes: [], wordbook: [] };
      if (name === "get_settings_section") return "characters";
      if (name === "get_character_pack_attribution") return { author: "", sourceUrl: "" };
    });
});

function characterTab(name: string): void {
  fireEvent.click(
    within(screen.getByRole("tablist", { name: "캐릭터 편집" })).getByRole("tab", { name }),
  );
}
function choose(name: string): void {
  fireEvent.click(
    within(screen.getByLabelText("설치된 캐릭터")).getByRole("button", {
      name: new RegExp(`^${name}`),
    }),
  );
}

it("keeps character memory drafts independent and scopes edits and forgetting without showing internal person labels", async () => {
  render(<CharacterManager snapshot={PREVIEW_SNAPSHOT} />);
  characterTab("기억");
  fireEvent.change(await screen.findByRole("textbox", { name: "기억 내용" }), {
    target: { value: "A 초안" },
  });
  expect(screen.queryByRole("button", { name: "캐릭터 저장" })).toBeNull();
  choose("B");
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "기억 내용" })).toHaveProperty(
      "value",
      "커피를 좋아함",
    ),
  );
  fireEvent.change(screen.getByRole("textbox", { name: "기억 내용" }), {
    target: { value: "B 초안" },
  });
  choose("A");
  expect(screen.getByRole("textbox", { name: "기억 내용" })).toHaveProperty("value", "A 초안");
  expect(screen.queryByText(/현재 사용자|이전 사용자|person-1/)).toBeNull();
  fireEvent.click(
    within(screen.getByRole("region", { name: "캐릭터의 기억" })).getByText("기억의 근거", {
      selector: "summary",
    }),
  );
  expect(screen.getAllByText("나는 커피가 좋아").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: "기억 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("edit_memory", {
      id: "m-a",
      characterId: "builtin-a",
      content: "A 초안",
    }),
  );
  choose("B");
  expect(screen.getByRole("textbox", { name: "기억 내용" })).toHaveProperty("value", "B 초안");
  fireEvent.click(screen.getByRole("button", { name: "이 기억 지우기" }));
  fireEvent.click(screen.getByRole("button", { name: "기억 삭제 확인" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("delete_memory", { id: "m-b", characterId: "builtin-b" }),
  );
});

it("requires counted confirmation to forget one character and opens individual export from its settings", async () => {
  render(<CharacterManager snapshot={PREVIEW_SNAPSHOT} />);
  characterTab("설정");
  const forget = await screen.findByRole("button", { name: "이 캐릭터의 기억 전체 잊기 (1개)" });
  fireEvent.click(forget);
  expect(screen.getByRole("dialog").textContent).toContain("A의 기억 1개");
  expect(vi.mocked(command).mock.calls.some(([name]) => name === "forget_character_memories")).toBe(
    false,
  );
  fireEvent.click(screen.getByRole("button", { name: "전체 기억 잊기 확인" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("forget_character_memories", { characterId: "builtin-a" }),
  );
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "이 캐릭터 내보내기" }));
  expect(screen.queryByLabelText("내보낼 대상")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "공유 파일 내보내기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "save_character_pack",
      expect.objectContaining({ ids: ["builtin-a"] }),
    ),
  );
});

it("offers independent export choices and presets reset private flags while preserving the sprite choice", async () => {
  render(<CharacterSharing snapshot={PREVIEW_SNAPSHOT} selectedId="builtin-a" disabled={false} />);
  expect(screen.getByLabelText("스프라이트 포함")).toHaveProperty("checked", true);
  fireEvent.click(screen.getByLabelText("스프라이트 포함"));
  fireEvent.click(screen.getByLabelText("친밀도 포함"));
  fireEvent.click(screen.getByLabelText("대화 기록 포함"));
  fireEvent.click(screen.getByRole("button", { name: "기억을 포함해 내보내기" }));
  expect(screen.getByLabelText("친밀도 포함")).toHaveProperty("checked", false);
  expect(screen.getByLabelText("대화 기록 포함")).toHaveProperty("checked", false);
  fireEvent.click(screen.getByLabelText("대화 기록 포함"));
  fireEvent.click(screen.getByRole("button", { name: "공유 파일 내보내기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_character_pack", {
      ids: ["builtin-a"],
      wordbookIds: [],
      options: {
        includeSprites: false,
        includeMemories: true,
        includeAffinity: false,
        includeMessages: true,
      },
    }),
  );
});

it("registers a trimmed name, leaves same-name changes alone, and explicitly confirms a new relationship", async () => {
  const { rerender } = render(<UserSettings snapshot={{ ...PREVIEW_SNAPSHOT, user: null }} />);
  fireEvent.change(screen.getByLabelText("유저명"), { target: { value: "  민수  " } });
  fireEvent.click(screen.getByRole("button", { name: "이름 저장" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("set_user_name", { name: "민수" }));
  rerender(
    <UserSettings
      snapshot={{
        ...PREVIEW_SNAPSHOT,
        user: { id: "one", name: "민수", startedAt: 1, endedAt: null },
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText("유저명"), { target: { value: "민수 " } });
  expect(screen.getByRole("button", { name: "이름 변경" })).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("유저명"), { target: { value: "지연" } });
  fireEvent.click(screen.getByRole("button", { name: "이름 변경" }));
  expect(command).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("dialog").textContent).toContain("스토리 진행은 처음부터 시작");
  fireEvent.click(screen.getByRole("button", { name: "이름 변경 확인" }));
  await waitFor(() => expect(command).toHaveBeenLastCalledWith("set_user_name", { name: "지연" }));
  await screen.findByText("이름을 저장했어요.");
  fireEvent.change(screen.getByLabelText("유저명"), { target: { value: "민수" } });
  fireEvent.click(screen.getByRole("button", { name: "이름 변경" }));
  fireEvent.click(screen.getByRole("button", { name: "이름 변경 확인" }));
  await waitFor(() => expect(command).toHaveBeenLastCalledWith("set_user_name", { name: "민수" }));
  expect(command).toHaveBeenCalledTimes(3);
});

it("rejects blank and overlong names and preserves a failed registration draft", async () => {
  vi.mocked(command).mockRejectedValue(new Error("이름 저장 실패"));
  render(<UserSettings snapshot={{ ...PREVIEW_SNAPSHOT, user: null }} />);
  for (const name of ["  ", "가".repeat(41)]) {
    fireEvent.change(screen.getByLabelText("유저명"), { target: { value: name } });
    expect(screen.getByRole("button", { name: "이름 저장" })).toHaveProperty("disabled", true);
  }
  fireEvent.change(screen.getByLabelText("유저명"), { target: { value: "유저" } });
  fireEvent.click(screen.getByRole("button", { name: "이름 저장" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "이름 저장 실패");
  expect(screen.getByLabelText("유저명")).toHaveProperty("value", "유저");
});

it("routes legacy memory destinations into the selected character and moves search settings to AI connection", async () => {
  vi.mocked(isDesktop).mockReturnValue(false);
  render(<SettingsPanel snapshot={PREVIEW_SNAPSHOT} initialSection="memory" />);
  expect(screen.getByRole("tab", { name: "기억", selected: true })).toBeTruthy();
  expect(
    within(screen.getByRole("tablist", { name: "설정 항목" })).queryByRole("tab", { name: "기억" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "AI 연결" }));
  expect(screen.getByRole("heading", { name: "기억 검색" })).toBeTruthy();
});

it("shows first-run name entry before widgets and prevents personal input before registration", async () => {
  vi.mocked(isDesktop).mockReturnValue(false);
  const { unmount } = render(
    <SettingsPanel snapshot={{ ...PREVIEW_SNAPSHOT, user: null }} initialSection="widgets" />,
  );
  expect(screen.getByRole("heading", { name: "어떻게 불러드릴까요?" })).toBeTruthy();
  unmount();
  render(
    <Balloon
      snapshot={{ ...PREVIEW_SNAPSHOT, user: null, panel: { persona: "a", mode: "input" } }}
    />,
  );
  expect(screen.getByRole("textbox")).toHaveProperty("disabled", true);
  expect(screen.getByRole("button", { name: "보내기" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "이름 설정" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("set_settings_section", { section: "user" }),
  );
  await waitFor(() => expect(command).toHaveBeenCalledWith("open_settings"));
});

it("assigns legacy memory explicitly to selected characters only", async () => {
  vi.mocked(command).mockImplementation(async (name) =>
    name === "list_legacy_memories"
      ? { items: [memory], total: 1, offset: 0, nextOffset: null, revision: 1 }
      : undefined,
  );
  render(<UserSettings snapshot={{ ...PREVIEW_SNAPSHOT, legacyMemoryCount: 1 }} />);
  fireEvent.click(await screen.findByLabelText("커피를 좋아함"));
  expect(screen.getByRole("button", { name: "선택한 기억 배분" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByLabelText("B"));
  fireEvent.click(screen.getByRole("button", { name: "선택한 기억 배분" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("assign_legacy_memories", {
      ids: ["m-a"],
      characterIds: ["builtin-b"],
    }),
  );
});

it("reads a character history page with the original name, keeping imported records out of the snapshot", async () => {
  vi.mocked(command).mockResolvedValue({
    items: [
      {
        id: "old-message",
        role: "user",
        persona: null,
        content: "옛 이야기",
        expression: null,
        createdAt: 1,
        status: "complete",
      },
    ],
    userNames: { "old-message": "민수" },
    characterNames: {},
    total: 51,
    offset: 0,
    nextOffset: 50,
  });
  render(<CharacterHistory snapshot={PREVIEW_SNAPSHOT} characterId="builtin-a" />);
  expect(await screen.findByText("민수")).toBeTruthy();
  expect(screen.queryByText(/현재 사용자|이전 사용자/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "다음 기록" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("list_character_history", {
      characterId: "builtin-a",
      offset: 50,
      limit: 50,
    }),
  );
  expect(PREVIEW_SNAPSHOT.messages).toHaveLength(0);
});

it("keeps failed rename and bulk-forget confirmations open with their errors visible for retry", async () => {
  const { unmount } = render(<UserSettings snapshot={PREVIEW_SNAPSHOT} />);
  fireEvent.change(screen.getByLabelText("유저명"), { target: { value: "지연" } });
  fireEvent.click(screen.getByRole("button", { name: "이름 변경" }));
  vi.mocked(command).mockRejectedValueOnce(new Error("변경 실패"));
  fireEvent.click(screen.getByRole("button", { name: "이름 변경 확인" }));
  expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveProperty(
    "textContent",
    "변경 실패",
  );
  fireEvent.click(screen.getByRole("button", { name: "이름 변경 확인" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  unmount();
  render(<CharacterManager snapshot={PREVIEW_SNAPSHOT} />);
  characterTab("설정");
  fireEvent.click(await screen.findByRole("button", { name: "이 캐릭터의 기억 전체 잊기 (1개)" }));
  vi.mocked(command).mockRejectedValueOnce(new Error("잊기 실패"));
  fireEvent.click(screen.getByRole("button", { name: "전체 기억 잊기 확인" }));
  expect(await within(screen.getByRole("dialog")).findByRole("alert")).toHaveProperty(
    "textContent",
    "잊기 실패",
  );
  fireEvent.click(screen.getByRole("button", { name: "전체 기억 잊기 확인" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
});

it("preserves the historical character name on older pages after the character is renamed", async () => {
  vi.mocked(command).mockImplementation(async (_name, args) => {
    const older = args?.offset === 50;
    const id = older ? "archive-reply" : "recent-reply";
    return {
      items: [
        {
          id,
          role: "assistant",
          persona: "builtin-a",
          content: older ? "예전에 했던 말" : "최근 이야기",
          expression: null,
          createdAt: older ? 1 : 2,
          status: "complete",
        },
      ],
      userNames: {},
      characterNames: { [id]: older ? "오래전 이름" : "그때 이름" },
      total: 51,
      offset: older ? 50 : 0,
      nextOffset: older ? null : 50,
    };
  });
  const snapshot = {
    ...PREVIEW_SNAPSHOT,
    messageIdentities: [
      {
        messageId: "recent-reply",
        persona: "builtin-a",
        characterId: "builtin-a",
        name: "스냅샷 이름",
      },
    ],
  };
  const { rerender } = render(<CharacterHistory snapshot={snapshot} characterId="builtin-a" />);
  expect(await screen.findByText("그때 이름")).toBeTruthy();
  expect(screen.queryByText("스냅샷 이름")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "다음 기록" }));
  expect(await screen.findByText("오래전 이름")).toBeTruthy();
  rerender(
    <CharacterHistory
      snapshot={{
        ...snapshot,
        characters: {
          ...snapshot.characters,
          installed: snapshot.characters.installed.map((character) => ({
            ...character,
            definition: { ...character.definition, name: "바뀐 이름" },
          })),
        },
      }}
      characterId="builtin-a"
    />,
  );
  expect(screen.getByText("오래전 이름")).toBeTruthy();
  expect(screen.queryByText("바뀐 이름")).toBeNull();
});
