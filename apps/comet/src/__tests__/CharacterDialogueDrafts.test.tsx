import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
it("saves one scene against the baseline while retaining another scene draft", async () => {
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
  expect(screen.getByLabelText("장면 1 대사 1")).toHaveProperty(
    "value",
    "첫 장면 미저장",
  );
  fireEvent.click(screen.getByRole("button", { name: "장면 수정 취소" }));
  expect(screen.getByLabelText("장면 1 대사 1")).toHaveProperty(
    "value",
    saved.pairScenes[0][0].text,
  );
  fireEvent.click(screen.getByRole("button", { name: "장면 2 선택" }));
  expect(screen.getByLabelText("장면 2 대사 1")).toHaveProperty("value", "  둘째만 저장\n그대로  ");
});
it("keeps a failed scene save across adding and cancelling a new scene", async () => {
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
  expect(screen.getByLabelText("장면 1 대사 1")).toHaveProperty(
    "value",
    "유지할 첫 장면",
  );
});
it("restores removed scene drafts when cancelling structure changes", async () => {
  renderScenes();
  fireEvent.change(await screen.findByLabelText("장면 1 대사 1"), {
    target: { value: "유지할 편집" },
  });
  fireEvent.click(screen.getByRole("button", { name: "장면 2 선택" }));
  fireEvent.change(screen.getByLabelText("장면 2 대사 1"), { target: { value: "삭제 직전 편집" } });
  fireEvent.click(screen.getByRole("button", { name: "장면 2 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "구성 수정 취소" }));
  expect(screen.getByRole("button", { name: "장면 2 선택" })).toBeTruthy();
  expect(screen.getByLabelText("장면 1 대사 1")).toHaveProperty(
    "value",
    "유지할 편집",
  );
  fireEvent.click(screen.getByRole("button", { name: "장면 2 선택" }));
  expect(screen.getByLabelText("장면 2 대사 1")).toHaveProperty(
    "value",
    "삭제 직전 편집",
  );
  expect(vi.mocked(command).mock.calls.every(([name]) => name === "get_character_dialogue")).toBe(
    true,
  );
});

it("saves reordered scenes and every retained draft when adding a scene", async () => {
  renderScenes();
  fireEvent.change(await screen.findByLabelText("장면 1 대사 1"), {
    target: { value: "  첫 장면 초안\n원문  " },
  });
  fireEvent.click(screen.getByRole("button", { name: "장면 아래로" }));
  fireEvent.click(screen.getByRole("button", { name: "장면 추가" }));
  fireEvent.change(screen.getByLabelText("장면 3 대사 1"), {
    target: { value: "새 장면 초안" },
  });
  fireEvent.click(screen.getByRole("button", { name: "장면 1 선택" }));
  expect(screen.getByLabelText("장면 1 대사 1")).toHaveProperty("value", "둘째 장면");
  fireEvent.change(screen.getByLabelText("장면 1 대사 1"), {
    target: { value: "둘째 장면 초안" },
  });
  fireEvent.click(screen.getByRole("button", { name: "조합 전체 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_character_dialogue", {
      ids: ["first", "second"],
      dialogue: {
        ...saved,
        pairScenes: [
          [{ ...saved.pairScenes[1][0], text: "둘째 장면 초안" }],
          [{ ...saved.pairScenes[0][0], text: "  첫 장면 초안\n원문  " }],
          [{ persona: "a", expression: "평온", text: "새 장면 초안" }],
        ],
      },
    }),
  );
  await waitFor(() => expect(screen.queryByRole("button", { name: "조합 전체 저장" })).toBeNull());
});

it("keeps a scene deletion when selecting and adding scenes", async () => {
  renderScenes();
  await screen.findByLabelText("장면 1 대사 1");
  fireEvent.click(screen.getByRole("button", { name: "장면 2 선택" }));
  fireEvent.click(screen.getByRole("button", { name: "장면 2 삭제" }));
  fireEvent.click(screen.getByRole("button", { name: "장면 추가" }));
  fireEvent.change(screen.getByLabelText("장면 2 대사 1"), { target: { value: "대체 장면" } });
  fireEvent.click(screen.getByRole("button", { name: "장면 1 선택" }));
  fireEvent.click(screen.getByRole("button", { name: "조합 전체 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_character_dialogue", {
      ids: ["first", "second"],
      dialogue: {
        ...saved,
        pairScenes: [
          saved.pairScenes[0],
          [{ persona: "a", expression: "평온", text: "대체 장면" }],
        ],
      },
    }),
  );
});

it("ignores an old scene save after the editor unmounts and the same owner starts another save", async () => {
  const onPendingChange = vi.fn();
  let finishOld!: () => void;
  let finishNew!: () => void;
  vi.mocked(command).mockImplementation((name) => {
    if (name === "get_character_dialogue") return Promise.resolve(saved);
    return new Promise<void>((resolve) => {
      if (!finishOld) finishOld = resolve;
      else finishNew = resolve;
    });
  });
  const editor = () => (
    <CharacterDialogueEditor
      ids={["first", "second"]}
      onDirtyChange={() => {}}
      onPendingChange={onPendingChange}
      mode="scenes"
    />
  );
  const first = render(editor());
  fireEvent.change(await screen.findByLabelText("장면 1 대사 1"), {
    target: { value: "이전 초안" },
  });
  fireEvent.click(screen.getByRole("button", { name: "이 장면 저장" }));
  first.unmount();
  render(editor());
  fireEvent.change(await screen.findByLabelText("장면 1 대사 1"), {
    target: { value: "새 초안" },
  });
  fireEvent.click(screen.getByRole("button", { name: "이 장면 저장" }));
  expect(onPendingChange.mock.calls).toEqual([[true], [false], [true]]);
  expect(
    vi.mocked(command).mock.calls
      .filter(([name]) => name === "save_character_dialogue")
      .map(([, args]) => args),
  ).toEqual([
    {
      ids: ["first", "second"],
      dialogue: {
        ...saved,
        pairScenes: [[{ ...saved.pairScenes[0][0], text: "이전 초안" }], saved.pairScenes[1]],
      },
    },
    {
      ids: ["first", "second"],
      dialogue: {
        ...saved,
        pairScenes: [[{ ...saved.pairScenes[0][0], text: "새 초안" }], saved.pairScenes[1]],
      },
    },
  ]);
  await act(async () => finishOld());
  expect(onPendingChange.mock.calls).toEqual([[true], [false], [true]]);
  expect(screen.getByLabelText("장면 1 대사 1")).toHaveProperty("value", "새 초안");
  expect(screen.getByRole("button", { name: "이 장면 저장" })).toHaveProperty("disabled", true);
  await act(async () => finishNew());
  expect(onPendingChange.mock.calls).toEqual([[true], [false], [true], [false]]);
  expect(screen.getByLabelText("장면 1 대사 1")).toHaveProperty("value", "새 초안");
});
