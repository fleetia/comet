import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CharacterDialogueEditor } from "../components/CharacterDialogueEditor/CharacterDialogueEditor";
import { command } from "../hooks/useSnapshot";
import type { CharacterDialogue } from "../types";
vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
}));
afterEach(cleanup);
const saved: CharacterDialogue = {
  pairScenes: [
    [{ persona: "a", expression: "평온", text: "  첫 장면\n원문  " }],
    [{ persona: "b", expression: "평온", text: "둘째 장면" }],
  ],
  wordbook: [],
};
beforeEach(() => {
  vi.mocked(command).mockReset();
  vi.mocked(command).mockImplementation(async (name) =>
    name === "get_character_dialogue" ? saved : undefined,
  );
});
function renderScenes(): void {
  render(
    <CharacterDialogueEditor ids={["first", "second"]} onDirtyChange={() => {}} mode="scenes" />,
  );
}
it("saves one scene by merging it with saved scenes while keeping another scene's draft", async () => {
  renderScenes();
  fireEvent.change(await screen.findByLabelText("장면 1 대사 1"), {
    target: { value: "첫 장면 미저장" },
  });
  fireEvent.click(screen.getByRole("button", { name: "장면 2 선택" }));
  fireEvent.change(screen.getByLabelText("장면 2 대사 1"), {
    target: { value: "  둘째만 저장\n그대로  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "이 장면 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_character_dialogue", {
      ids: ["first", "second"],
      dialogue: {
        ...saved,
        pairScenes: [
          saved.pairScenes[0],
          [{ ...saved.pairScenes[1][0], text: "  둘째만 저장\n그대로  " }],
        ],
      },
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "이 장면 저장" })).toHaveProperty("disabled", true),
  );
  fireEvent.click(screen.getByRole("button", { name: "장면 1 선택" }));
  expect(screen.getByLabelText("장면 1 대사 1")).toHaveProperty("value", "첫 장면 미저장");
  fireEvent.click(screen.getByRole("button", { name: "장면 수정 취소" }));
  expect(screen.getByLabelText("장면 1 대사 1")).toHaveProperty(
    "value",
    saved.pairScenes[0][0].text,
  );
  fireEvent.click(screen.getByRole("button", { name: "장면 2 선택" }));
  expect(screen.getByLabelText("장면 2 대사 1")).toHaveProperty("value", "  둘째만 저장\n그대로  ");
});
it("retains failed scene drafts and discards only the selected new scene", async () => {
  renderScenes();
  fireEvent.change(await screen.findByLabelText("장면 1 대사 1"), {
    target: { value: "유지할 첫 장면" },
  });
  vi.mocked(command).mockRejectedValueOnce(new Error("장면 저장 실패"));
  fireEvent.click(screen.getByRole("button", { name: "이 장면 저장" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "장면 저장 실패");
  fireEvent.click(screen.getByRole("button", { name: "장면 추가" }));
  fireEvent.change(screen.getByLabelText("장면 3 대사 1"), { target: { value: "버릴 새 장면" } });
  fireEvent.click(screen.getByRole("button", { name: "장면 수정 취소" }));
  expect(screen.queryByRole("button", { name: "장면 3 선택" })).toBeNull();
  expect(screen.getByLabelText("장면 1 대사 1")).toHaveProperty("value", "유지할 첫 장면");
});
it("cancels list structure changes without discarding edits to existing scenes", async () => {
  renderScenes();
  fireEvent.change(await screen.findByLabelText("장면 1 대사 1"), {
    target: { value: "유지할 편집" },
  });
  fireEvent.click(screen.getByRole("button", { name: "장면 2 선택" }));
  fireEvent.change(screen.getByLabelText("장면 2 대사 1"), { target: { value: "삭제 직전 편집" } });
  fireEvent.click(screen.getByRole("button", { name: "장면 2 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "구성 수정 취소" }));
  expect(screen.getByRole("button", { name: "장면 2 선택" })).toBeTruthy();
  expect(screen.getByLabelText("장면 1 대사 1")).toHaveProperty("value", "유지할 편집");
  fireEvent.click(screen.getByRole("button", { name: "장면 2 선택" }));
  expect(screen.getByLabelText("장면 2 대사 1")).toHaveProperty("value", "삭제 직전 편집");
  expect(vi.mocked(command).mock.calls.every(([name]) => name === "get_character_dialogue")).toBe(
    true,
  );
});
