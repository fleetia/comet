import { selectFriend } from "./characterNavigation";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
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

const [first, second] = PREVIEW_SNAPSHOT.characters.installed;
const visitor = {
  ...first,
  id: "moon-rabbit",
  definition: {
    ...first.definition,
    sourceId: "moon-rabbit",
    name: "달토끼",
    presenceRole: "npc" as const,
    relationships: [],
  },
};
const snapshot: Snapshot = {
  ...PREVIEW_SNAPSHOT,
  characters: {
    ...PREVIEW_SNAPSHOT.characters,
    installed: [
      {
        ...first,
        definition: {
          ...first.definition,
          relationships: [
            {
              targetId: "moon-rabbit",
              description: "가끔 놀러 오는 친구",
              replyLines: [{ expression: "평온", text: "달빛 산책 좋아하는 애지?" }],
            },
          ],
        },
      },
      { ...second, definition: { ...second.definition, relationships: [] } },
      visitor,
    ],
  },
};

it("lists each resident's reaction to a visiting friend's name and opens the missing one", () => {
  render(<CharacterManager snapshot={snapshot} embedded />);
  selectFriend(/달토끼/);
  const reactions = within(screen.getByRole("region", { name: "이름을 들었을 때" }));
  expect(reactions.getByText(`${first.definition.name}에게 ‘달토끼’를 말하면`)).toBeTruthy();
  expect(reactions.getByText("“달빛 산책 좋아하는 애지?”")).toBeTruthy();
  expect(reactions.getByText("정하지 않음")).toBeTruthy();
  expect(reactions.getByText(/달토끼를 부르지는 않아요/)).toBeTruthy();

  fireEvent.click(
    reactions.getByRole("button", { name: `${second.definition.name}의 반응 정하기` }),
  );
  const panel = within(screen.getByRole("tabpanel", { name: "다른 친구와의 관계" }));
  expect(panel.getByLabelText("관계 1 대상")).toHaveProperty("value", "moon-rabbit");
  expect(panel.getByText("이름을 언급했을 때의 등록 반응").closest("details")?.open).toBe(true);
  expect(command).not.toHaveBeenCalledWith("save_character", expect.anything());
});
