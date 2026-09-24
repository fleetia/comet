import { useState, type JSX } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CharacterManager } from "../components/CharacterManager/CharacterManager";
import { ReactionEditor } from "../components/ReactionEditor/ReactionEditor";
import { reactionError } from "../components/ReactionEditor/reactionValidation";
import { WordbookPanel } from "../components/WordbookPanel/WordbookPanel";
import { CharacterDialogueEditor } from "../components/CharacterDialogueEditor/CharacterDialogueEditor";
import { MotionSelect } from "../components/MotionSelect/MotionSelect";
import { useAnimationFrames } from "../hooks/useAnimationFrames";
import { command, isDesktop, PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";
import type {
  CharacterDefinition,
  InstalledCharacter,
  ReactionPreview,
  WordbookEntry,
} from "../types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(() => false),
}));
vi.mock("../hooks/useAnimationFrames", () => ({
  useAnimationFrames: vi.fn(() => ({ frames: null, ready: false, error: null })),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(isDesktop).mockReturnValue(false);
  vi.mocked(command).mockReset();
  vi.mocked(useAnimationFrames).mockClear();
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_character_dialogue") return { pairScenes: [], wordbook: [] };
    if (name === "get_character_reaction_events")
      return [
        { event: "click", label: "클릭" },
        { event: "grab-start", label: "잡기 시작" },
        { event: "release", label: "놓기" },
        { event: "todo-completed", label: "할 일 완료" },
      ];
  });
});
const owners: InstalledCharacter[] = PREVIEW_SNAPSHOT.characters.installed.map((owner, index) => ({
  ...owner,
  animationAssets: { png: { mime: "image/png", width: 16, height: 16 } },
  definition: {
    ...owner.definition,
    animation: {
      clips: [
        {
          id: `clip-${index}`,
          name: `동작 ${index}`,
          fps: 8,
          frames: [{ assetId: "png", x: 0, y: 0, width: 16, height: 16 }],
        },
      ],
      bindings: {},
      overrides: {},
    },
  },
}));
const definition: CharacterDefinition = {
  ...owners[0].definition,
  reactions: [
    {
      id: "reaction",
      event: "click",
      cooldownMs: 3000,
      variants: [{ id: "first", text: "안녕!", expression: "기쁨", motion: { mode: "static" } }],
    },
  ],
};
function Harness(): JSX.Element {
  const [draft, setDraft] = useState(definition);
  return (
    <ReactionEditor
      definition={draft}
      character={owners[0]}
      assets={[]}
      visible
      onChange={(reactions) => setDraft({ ...draft, reactions })}
    />
  );
}
function button(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

it("keeps reaction candidates and ordinary line motion in the character draft across selection, then saves their original text", async () => {
  render(
    <CharacterManager
      snapshot={{
        ...PREVIEW_SNAPSHOT,
        characters: { ...PREVIEW_SNAPSHOT.characters, installed: owners },
      }}
      embedded
    />,
  );
  fireEvent.click(screen.getByRole("tab", { name: "대사·반응" }));
  fireEvent.click(button("반응 추가"));
  expect(button("캐릭터 저장")).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("반응 1 후보 1 대사"), {
    target: { value: "  앗,\n어디로?  " },
  });
  fireEvent.change(screen.getByLabelText("반응 1 후보 1 표정"), { target: { value: "기쁨" } });
  fireEvent.change(screen.getByLabelText("반응 1 후보 1 동작"), {
    target: { value: "clip:clip-0" },
  });
  expect(screen.queryByLabelText("반응 1 후보 1 반복")).toBeNull();
  fireEvent.change(screen.getByLabelText("반응 1 대사 쿨다운(초)"), { target: { value: "4.5" } });
  fireEvent.click(button("인사 편집"));
  fireEvent.change(screen.getByLabelText("인사 1 동작"), { target: { value: "static" } });
  fireEvent.click(
    within(screen.getByLabelText("설치된 캐릭터")).getByRole("button", { name: /^B/ }),
  );
  expect(screen.queryByLabelText("반응 1 후보 1 대사")).toBeNull();
  fireEvent.click(
    within(screen.getByLabelText("설치된 캐릭터")).getByRole("button", { name: /^A/ }),
  );
  expect(screen.getByLabelText("반응 1 후보 1 대사")).toHaveProperty("value", "  앗,\n어디로?  ");
  expect(screen.getByText("행동 판정 미리보기는 데스크톱 앱에서 사용할 수 있어요.")).toBeTruthy();
  fireEvent.click(button("캐릭터 저장"));
  await waitFor(() =>
    expect(vi.mocked(command).mock.calls.some(([name]) => name === "save_character")).toBe(true),
  );
  const args = vi.mocked(command).mock.calls.find(([name]) => name === "save_character")?.[1] as {
    definition: CharacterDefinition;
  };
  expect(args.definition.reactions?.[0]).toEqual({
    id: expect.any(String),
    event: "click",
    cooldownMs: 4500,
    variants: [
      {
        id: expect.any(String),
        text: "  앗,\n어디로?  ",
        expression: "기쁨",
        motion: { mode: "clip", clipId: "clip-0", repeat: false, intervalMs: 0 },
      },
    ],
  });
  expect(args.definition.greeting[0].motion).toEqual({ mode: "static" });
});

it("previews native selection and busy rejection without emitting live reaction commands, and rejects stale preview results", async () => {
  vi.mocked(isDesktop).mockReturnValue(true);
  let resolvePreview: ((value: ReactionPreview) => void) | undefined;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_character_reaction_events")
      return [
        { event: "click", label: "클릭" },
        { event: "todo-completed", label: "할 일 완료" },
      ];
    if (name === "preview_character_reaction")
      return new Promise<ReactionPreview>((resolve) => {
        resolvePreview = resolve;
      });
  });
  render(<Harness />);
  await waitFor(() =>
    expect(
      within(screen.getByLabelText("추가할 반응 사건")).getByRole("option", { name: "할 일 완료" }),
    ).toBeTruthy(),
  );
  fireEvent.click(screen.getByLabelText("대화 중인 상황"));
  fireEvent.click(button("클릭 시험"));
  expect(command).toHaveBeenCalledWith("preview_character_reaction", {
    definition,
    event: "click",
    busy: true,
  });
  await act(async () =>
    resolvePreview?.({
      selection: {
        ruleId: "reaction",
        variant: definition.reactions![0].variants[0],
        speechAllowed: false,
      },
      speechReason: "진행 중인 대화를 보호해요.",
    }),
  );
  expect(screen.getByText("진행 중인 대화를 보호해요.")).toBeTruthy();
  expect(screen.queryByLabelText("반응 대사 미리보기")).toBeNull();
  fireEvent.click(button("클릭 시험"));
  fireEvent.change(screen.getByLabelText("반응 1 후보 1 대사"), { target: { value: "바꾼 대사" } });
  await act(async () =>
    resolvePreview?.({
      selection: {
        ruleId: "reaction",
        variant: { id: "old", text: "늦은 대사" },
        speechAllowed: true,
      },
      speechReason: null,
    }),
  );
  expect(screen.queryByText("늦은 대사")).toBeNull();
  fireEvent.click(button("클릭 시험"));
  fireEvent.click(button("반응 미리보기 정지"));
  await act(async () =>
    resolvePreview?.({
      selection: {
        ruleId: "reaction",
        variant: { id: "old", text: "취소한 대사" },
        speechAllowed: true,
      },
      speechReason: null,
    }),
  );
  expect(screen.queryByText("취소한 대사")).toBeNull();
  expect(
    vi
      .mocked(command)
      .mock.calls.every(([name]) =>
        ["get_character_reaction_events", "preview_character_reaction"].includes(name),
      ),
  ).toBe(true);
});

it("allows looping grab motion but normalizes a changed event to once and keeps explicit static candidates", () => {
  render(<Harness />);
  fireEvent.change(screen.getByLabelText("반응 1 사건"), { target: { value: "grab-start" } });
  fireEvent.change(screen.getByLabelText("반응 1 후보 1 동작"), {
    target: { value: "clip:clip-0" },
  });
  expect(screen.getByLabelText("반응 1 후보 1 반복")).toHaveProperty("checked", true);
  fireEvent.change(screen.getByLabelText("반응 1 사건"), { target: { value: "release" } });
  expect(screen.queryByLabelText("반응 1 후보 1 반복")).toBeNull();
  fireEvent.click(button("반응 1 후보 추가"));
  fireEvent.change(screen.getByLabelText("반응 1 후보 2 동작"), { target: { value: "static" } });
  expect(screen.queryByText("후보마다 대사·표정·동작 중 하나 이상을 지정해 주세요.")).toBeNull();
});

it("previews unsaved animation assets through the shared frame loader and stops when its tab is hidden", async () => {
  vi.mocked(isDesktop).mockReturnValue(true);
  const clip = owners[0].definition.animation!.clips[0];
  vi.mocked(command).mockImplementation(async (name) =>
    name === "preview_character_reaction"
      ? {
          selection: {
            ruleId: "reaction",
            variant: {
              id: "first",
              motion: { mode: "clip", clipId: clip.id, repeat: false, intervalMs: 0 },
            },
            speechAllowed: false,
          },
          speechReason: null,
        }
      : undefined,
  );
  const props = {
    definition,
    character: owners[0],
    assets: [{ assetId: "png", mime: "image/png", width: 16, height: 16, data: "draft-png" }],
    onChange: () => {},
  };
  const view = render(<ReactionEditor {...props} visible />);
  fireEvent.click(button("클릭 시험"));
  await waitFor(() =>
    expect(useAnimationFrames).toHaveBeenLastCalledWith(
      clip,
      { png: "data:image/png;base64,draft-png" },
      expect.any(Number),
    ),
  );
  view.rerender(<ReactionEditor {...props} visible={false} />);
  expect(vi.mocked(useAnimationFrames).mock.lastCall?.[0]).toBeUndefined();
  view.rerender(<ReactionEditor {...props} visible />);
  expect(vi.mocked(useAnimationFrames).mock.lastCall?.[0]).toBeUndefined();
  expect(screen.queryByText("선택한 반응:", { exact: false })).toBeNull();
});

it("discards pending native preview when a tab is hidden and reopened before the response arrives", async () => {
  vi.mocked(isDesktop).mockReturnValue(true);
  let resolvePreview: ((value: ReactionPreview) => void) | undefined;
  vi.mocked(command).mockImplementation(async (name) =>
    name === "preview_character_reaction"
      ? new Promise<ReactionPreview>((resolve) => {
          resolvePreview = resolve;
        })
      : undefined,
  );
  const props = { definition, character: owners[0], assets: [], onChange: () => {} };
  const view = render(<ReactionEditor {...props} visible />);
  fireEvent.click(button("클릭 시험"));
  view.rerender(<ReactionEditor {...props} visible={false} />);
  view.rerender(<ReactionEditor {...props} visible />);
  await act(async () =>
    resolvePreview?.({
      selection: {
        ruleId: "reaction",
        variant: { id: "first", text: "숨긴 뒤 도착한 대사" },
        speechAllowed: true,
      },
      speechReason: null,
    }),
  );
  expect(screen.queryByText("숨긴 뒤 도착한 대사")).toBeNull();
  expect(button("클릭 시험")).toHaveProperty("disabled", false);
});

it("distinguishes imported clip IDs from built-in motion choices", () => {
  const onChange = vi.fn();
  render(
    <MotionSelect
      label="가져온 동작"
      clips={[{ ...owners[0].definition.animation!.clips[0], id: "static", name: "멈칫" }]}
      onChange={onChange}
    />,
  );
  fireEvent.change(screen.getByLabelText("가져온 동작 동작"), { target: { value: "clip:static" } });
  expect(onChange).toHaveBeenCalledWith({
    mode: "clip",
    clipId: "static",
    repeat: true,
    intervalMs: 0,
  });
});

it("offers wordbook motion from the actual speaker and clears a clip when switching speaker without changing original text", async () => {
  const entry: WordbookEntry = {
    id: "entry",
    title: "인사",
    keywords: ["안녕"],
    enabled: true,
    useForIdle: false,
    lines: [{ persona: "a", expression: "평온", text: "  안녕\n반가워  " }],
  };
  const save = vi.fn().mockResolvedValue(undefined);
  render(<WordbookPanel entries={[entry]} owners={owners} saveEntry={save} speakerCount={2} />);
  const selector = screen.getByLabelText("1번 대사 동작");
  expect(within(selector).queryByRole("option", { name: "동작 1" })).toBeNull();
  fireEvent.change(selector, { target: { value: "clip:clip-0" } });
  fireEvent.change(screen.getByLabelText("1번 화자"), { target: { value: "b" } });
  expect(selector).toHaveProperty("value", "inherit");
  expect(within(selector).queryByRole("option", { name: "동작 0" })).toBeNull();
  fireEvent.change(selector, { target: { value: "clip:clip-1" } });
  fireEvent.click(button("단어장 저장"));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save.mock.calls[0][0].lines[0]).toEqual({
    persona: "b",
    expression: "평온",
    text: "  안녕\n반가워  ",
    motion: { mode: "clip", clipId: "clip-1", repeat: true, intervalMs: 0 },
  });
});

it("saves pair dialogue motion against each speaker's clip library", async () => {
  vi.mocked(command).mockImplementation(async (name) =>
    name === "get_character_dialogue"
      ? {
          pairScenes: [[{ persona: "a", expression: "평온", text: "그대로 남길 대사" }]],
          wordbook: [],
        }
      : undefined,
  );
  render(
    <CharacterDialogueEditor
      ids={owners.map((owner) => owner.id)}
      owners={owners}
      onDirtyChange={() => {}}
    />,
  );
  await screen.findByLabelText("장면 1 대사 1 동작");
  fireEvent.change(screen.getByLabelText("장면 1 대사 1 동작"), {
    target: { value: "clip:clip-0" },
  });
  fireEvent.change(screen.getByLabelText("장면 1 대사 1 화자"), { target: { value: "b" } });
  expect(screen.getByLabelText("장면 1 대사 1 동작")).toHaveProperty("value", "inherit");
  fireEvent.change(screen.getByLabelText("장면 1 대사 1 동작"), {
    target: { value: "clip:clip-1" },
  });
  fireEvent.click(button("조합 대사 저장"));
  await waitFor(() =>
    expect(vi.mocked(command).mock.calls.some(([name]) => name === "save_character_dialogue")).toBe(
      true,
    ),
  );
  expect(command).toHaveBeenCalledWith("save_character_dialogue", {
    ids: owners.map((owner) => owner.id),
    dialogue: {
      pairScenes: [
        [
          {
            persona: "b",
            expression: "평온",
            text: "그대로 남길 대사",
            motion: { mode: "clip", clipId: "clip-1", repeat: true, intervalMs: 0 },
          },
        ],
      ],
      wordbook: [],
    },
  });
});

it("rejects missing clip references and invalid reaction bounds without changing authored text", () => {
  expect(reactionError(definition)).toBeNull();
  const invalid = structuredClone(definition);
  invalid.reactions![0].variants[0].motion = {
    mode: "clip",
    clipId: "missing",
    repeat: false,
    intervalMs: 0,
  };
  expect(reactionError(invalid)).toContain("동작이 없어요");
  invalid.reactions![0].variants[0].motion = { mode: "static" };
  invalid.reactions![0].cooldownMs = 60001;
  expect(reactionError(invalid)).toContain("0~60초");
  invalid.reactions![0].cooldownMs = 3000;
  invalid.reactions![0].variants[0].text = "  ";
  expect(reactionError(invalid)).toContain("공백만");
});
