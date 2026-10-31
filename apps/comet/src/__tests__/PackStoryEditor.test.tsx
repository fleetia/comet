import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  PackStoryEditor,
  type PackStoryDraft,
} from "../components/CharacterEditor/PackStoryEditor";
import { command, PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";
import type {
  AnimationAsset,
  AuthoringState,
  AuthoringTrialTrace,
  InstalledCharacter,
  PackStorySnapshot,
  ScenarioDefinition,
} from "../types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ listen: vi.fn().mockResolvedValue(() => {}) }),
}));
const installed = ["a", "b"].flatMap((pack) =>
  PREVIEW_SNAPSHOT.characters.installed.map((actor, index) => ({
    ...actor,
    id: `${pack}-${index}`,
    packId: pack,
    definition: { ...actor.definition, sourceId: `${pack}-source-${index}` },
  })),
);
const trialState: AuthoringState = {
  stage: null,
  ready: true,
  presentIds: [installed[0].id],
  flags: [],
  turn: 0,
  waitTurn: 0,
  pendingNextScenarioId: null,
};
function snapshot(packId: string, baseline = "1"): PackStorySnapshot {
  const actor = installed.find((value) => value.packId === packId)!;
  const line = { persona: actor.definition.sourceId, text: "등록 원문", expression: "평온" };
  const scenario: ScenarioDefinition = {
    id: `${packId}-story`,
    title: `${packId} 이야기`,
    centerId: line.persona,
    participants: [line.persona],
    keywords: ["별"],
    requiredFlags: [],
    minAffinity: 0,
    intro: [{ ...line }],
    accept: [{ ...line }],
    decline: [{ ...line }],
    ending: [{ ...line }],
    acceptKeywords: ["좋아"],
    declineKeywords: ["다음에"],
    proceedKeywords: ["계속"],
    cancelKeywords: ["그만"],
    acceptNextId: null,
    declineNextId: null,
    allowIncompleteRepeat: true,
    allowRepeat: false,
    completion: { setFlags: [], memoryTemplate: null },
  };
  return {
    packId,
    baseline,
    sourceToLocal: {},
    definition: {
      worldRules: `${packId} 세계`,
      storyFlags: [],
      knowledge: [],
      scenarios: [scenario],
    },
  };
}
function Harness({
  packId,
  visible = true,
  actors = installed,
  trialAssets,
}: {
  packId: string;
  visible?: boolean;
  actors?: InstalledCharacter[];
  trialAssets?: Record<string, AnimationAsset[]>;
}) {
  const [drafts, setDrafts] = useState<Record<string, PackStoryDraft>>({});
  const [, setPending] = useState(false);
  return (
    <PackStoryEditor
      packId={packId}
      visible={visible}
      installed={actors}
      trialAssets={trialAssets}
      drafts={drafts}
      onDraftsChange={setDrafts}
      onPendingChange={setPending}
      characterDirty={false}
    />
  );
}
async function openTrial(): Promise<HTMLButtonElement> {
  const world = await screen.findByLabelText("세계와 공통 규칙");
  await waitFor(() => expect(world.closest("fieldset")).toHaveProperty("disabled", false));
  await userEvent.setup().click(screen.getByText("등록 이야기 시험", { selector: "summary" }));
  const button = screen.getByRole<HTMLButtonElement>("button", { name: "등록 이야기 시험" });
  await waitFor(() => expect(button).toHaveProperty("disabled", false));
  return button;
}
beforeEach(() => {
  vi.mocked(command).mockReset();
  vi.mocked(command).mockImplementation(async (name, args) =>
    name === "get_pack_story_definition"
      ? snapshot((args as { packId: string }).packId)
      : undefined,
  );
});
afterEach(cleanup);

it("opens the selected saved story in the story editor", async () => {
  render(<Harness packId="a" />);
  await screen.findByLabelText("이야기 제목");
  fireEvent.click(screen.getByRole("button", { name: "장면 편집기 열기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("open_story_editor", {
    packId: "a",
    scenarioId: "a-story",
  }));
  fireEvent.click(screen.getByRole("button", { name: "등록 이야기 추가" }));
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "장면 편집기 열기" }).disabled).toBe(true);
  expect(screen.getByText(/새 이야기는 먼저 저장해 주세요/)).toBeTruthy();
});

it("requires a saved character to open the story editor", () => {
  render(<PackStoryEditor packId={null} visible installed={installed} drafts={{}} onDraftsChange={() => {}} onPendingChange={() => {}} characterDirty={false} />);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "장면 편집기 열기" }).disabled).toBe(true);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "이야기 만들기" }).disabled).toBe(true);
  expect(screen.getByText(/캐릭터를 저장한 뒤/)).toBeTruthy();
});

it("requests a new story without saving an incomplete definition", async () => {
  render(<Harness packId="a" />);
  await screen.findByLabelText("이야기 제목");
  fireEvent.click(screen.getByRole("button", { name: "이야기 만들기" }));
  expect(command).toHaveBeenCalledWith("open_story_editor", {
    packId: "a",
    scenarioId: expect.any(String),
    createNew: true,
  });
  expect(command).not.toHaveBeenCalledWith("save_pack_story_definition", expect.anything());
});

it("confirms switching formats and saves edited scene chapters", async () => {
  const saved = snapshot("a");
  vi.mocked(command).mockImplementation(async (name, args) =>
    name === "save_pack_story_definition"
      ? {
          ...saved,
          definition: (args as { definition: PackStorySnapshot["definition"] }).definition,
          baseline: "2",
        }
      : saved,
  );
  render(<Harness packId="a" />);
  await screen.findByLabelText("이야기 제목");
  fireEvent.click(screen.getByRole("button", { name: "장면형" }));
  expect(screen.getByRole("dialog", { name: "이야기 방식을 바꿀까요?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
  expect(screen.getByLabelText("제안 1 본문")).toHaveProperty("value", "등록 원문");
  fireEvent.click(screen.getByRole("button", { name: "장면형" }));
  fireEvent.click(screen.getByRole("button", { name: "방식 바꾸기" }));
  expect(screen.queryByLabelText("제안 키워드 · 한 줄에 하나")).toBeNull();
  expect(screen.queryByLabelText("노출 친밀도 · 선택 사항")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "튜토리얼" }));
  fireEvent.change(screen.getByLabelText("장 제목"), { target: { value: "첫 만남" } });
  fireEvent.change(screen.getByLabelText("단계 1 본문"), { target: { value: "안녕" } });
  fireEvent.click(screen.getByRole("button", { name: "단계 추가" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "기다리기" }));
  fireEvent.change(screen.getByLabelText("단계 2 기다릴 이벤트"), {
    target: { value: "widget.saved" },
  });
  fireEvent.click(screen.getByText("시간이 지나면", { selector: "summary" }));
  fireEvent.click(screen.getByRole("button", { name: "시간 초과 동작 추가" }));
  fireEvent.change(screen.getByLabelText("단계 2 시간 초과 후"), { target: { value: "end" } });
  fireEvent.click(screen.getByRole("button", { name: "장 추가" }));
  fireEvent.change(screen.getByLabelText("장 제목"), { target: { value: "두 번째 장" } });
  fireEvent.change(screen.getByLabelText("단계 1 본문"), { target: { value: "다음 대사" } });
  fireEvent.click(screen.getByRole("button", { name: "첫 만남" }));
  fireEvent.click(screen.getByText(/이 장이 끝나면/, { selector: "summary" }));
  const chapterTarget = screen.getByLabelText<HTMLSelectElement>("이 장이 끝나면");
  fireEvent.change(chapterTarget, { target: { value: chapterTarget.options[3].value } });
  fireEvent.click(screen.getByRole("button", { name: "팩 이야기 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith(
      "save_pack_story_definition",
      expect.objectContaining({ packId: "a", expectedBaseline: "1" }),
    ),
  );
  const call = vi
    .mocked(command)
    .mock.calls.find(([name]) => name === "save_pack_story_definition");
  if (!call) throw new Error("저장 요청이 없어요.");
  const definition = (call[1] as { definition: PackStorySnapshot["definition"] }).definition;
  const scene = definition.scenarios[0];
  expect(scene.purpose).toBe("tutorial");
  expect(scene.intro).toEqual([]);
  expect(scene.chapters).toHaveLength(2);
  if (!scene.chapters || scene.chapters.length !== 2) throw new Error("장이 두 개여야 해요.");
  expect(scene.chapters[0]).toMatchObject({
    title: "첫 만남",
    next: scene.chapters[1].id,
    steps: [
      { kind: "line", text: "안녕" },
      {
        kind: "wait",
        event: "widget.saved",
        widget: "memo",
        onTimeout: { then: "end", steps: [{ kind: "action", do: "widget.open", widget: "memo" }] },
      },
    ],
  });
  expect(await screen.findByText("팩의 이야기와 지식을 저장했어요.")).toBeTruthy();
  expect(screen.getByLabelText("장 제목")).toHaveProperty("value", "첫 만남");
  expect(screen.getByLabelText("단계 1 본문")).toHaveProperty("value", "안녕");
  expect(scene.chapters[1]).toMatchObject({
    title: "두 번째 장",
    steps: [{ kind: "line", text: "다음 대사" }],
  });
});

it("opens an existing scene for editing and keeps its steps on save", async () => {
  const saved = snapshot("a");
  saved.definition.scenarios[0] = {
    ...saved.definition.scenarios[0],
    purpose: "tutorial",
    chapters: [
      {
        id: "first",
        title: "첫 만남",
        steps: [{ kind: "line", persona: "a-source-0", expression: "평온", text: "안녕" }],
      },
    ],
    intro: [],
    accept: [],
    decline: [],
    ending: [],
    acceptKeywords: [],
    declineKeywords: [],
    proceedKeywords: [],
    cancelKeywords: [],
  };
  vi.mocked(command).mockResolvedValue(saved);
  render(<Harness packId="a" />);
  expect(await screen.findByLabelText("단계 1 본문")).toHaveProperty("value", "안녕");
  expect(screen.getByText("등록 이야기 시험", { selector: "summary" })).toBeTruthy();
  fireEvent.change(screen.getByLabelText("세계와 공통 규칙"), { target: { value: "수정한 세계" } });
  fireEvent.click(screen.getByRole("button", { name: "팩 이야기 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_pack_story_definition", {
      packId: "a",
      definition: { ...saved.definition, worldRules: "수정한 세계" },
      expectedBaseline: "1",
    }),
  );
});

it.each(["name", "text"] as const)("saves %s input with the matching name dialogue fields", async (input) => {
  const saved = snapshot("a");
  const ask = {
    kind: "ask" as const,
    id: "name",
    persona: "a-source-0",
    expression: "평온",
    prompt: "이름이 뭐예요?",
    input: "name" as const,
    known: "이미 알고 있어요.",
    saved: { expression: "평온", text: "반가워요!" },
  };
  saved.definition.scenarios[0].chapters = [{ id: "first", title: "첫 만남", steps: [ask] }];
  vi.mocked(command).mockResolvedValue(saved);
  render(<Harness packId="a" />);
  fireEvent.change(await screen.findByLabelText("단계 1 입력 종류"), { target: { value: input } });
  fireEvent.change(screen.getByLabelText("단계 1 질문"), { target: { value: "고친 질문" } });
  fireEvent.click(screen.getByRole("button", { name: "팩 이야기 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_pack_story_definition", expect.anything()),
  );
  const call = vi.mocked(command).mock.calls.find(([name]) => name === "save_pack_story_definition");
  const args = call?.[1] as { definition: PackStorySnapshot["definition"] };
  expect(args.definition.scenarios[0].chapters?.[0].steps[0]).toEqual({
    ...ask,
    prompt: "고친 질문",
    input,
    known: input === "name" ? ask.known : null,
    saved: input === "name" ? ask.saved : undefined,
  });
});

it("previews a pack member's unsaved animation bytes without requesting a stored asset URL", async () => {
  const actor = installed[0];
  const pending: AnimationAsset = {
    assetId: "pending",
    mime: "image/png",
    width: 16,
    height: 16,
    data: "draft-bytes",
  };
  const animation = {
    clips: [
      {
        id: "draft-clip",
        name: "초안",
        fps: 8,
        frames: [{ assetId: pending.assetId, x: 0, y: 0, width: 16, height: 16 }],
      },
    ],
    bindings: {},
    overrides: {},
  };
  const urls: string[] = [];
  vi.stubGlobal(
    "Image",
    vi.fn(function image() {
      return {
        onload: null,
        onerror: null,
        crossOrigin: "",
        set src(value: string) {
          urls.push(value);
        },
      };
    }),
  );
  try {
    vi.mocked(command).mockImplementation(async (name) =>
      name === "get_pack_story_definition"
        ? snapshot("a")
        : {
            blockedReasons: [],
            steps: [
              {
                input: "별",
                source: "registered",
                stage: "intro",
                conditions: [],
                blockedReasons: [],
                beforeState: trialState,
                afterState: { ...trialState, stage: "intro" },
                lines: [
                  {
                    persona: actor.id,
                    text: "초안 원문",
                    expression: "평온",
                    motion: { mode: "clip", clipId: "draft-clip", repeat: false, intervalMs: 0 },
                  },
                ],
                lineDurationsMs: [500],
                plannedEffects: { setFlags: [], memoryTemplate: null },
                modelRequired: false,
                modelNotRunReason: null,
                presentationAssumed: true,
              },
            ],
          },
    );
    render(
      <Harness
        packId="a"
        actors={installed.map((member) =>
          member.id === actor.id
            ? {
                ...member,
                definition: { ...member.definition, animation },
              }
            : member,
        )}
        trialAssets={{ [actor.id]: [pending] }}
      />,
    );
    const trialButton = await openTrial();
    fireEvent.click(trialButton);
    await waitFor(() =>
      expect(vi.mocked(command).mock.calls.some(([name]) => name === "trial_pack_authoring")).toBe(
        true,
      ),
    );
    await screen.findByLabelText("등록 이야기 시험 결과");
    await waitFor(() => expect(urls).toContain("data:image/png;base64,draft-bytes"));
    expect(urls.filter(Boolean)).toEqual(["data:image/png;base64,draft-bytes"]);
  } finally {
    cleanup();
    vi.unstubAllGlobals();
  }
});

it("keeps raw story text after failed save and retries the same definition baseline", async () => {
  render(<Harness packId="a" />);
  const world = await screen.findByLabelText("세계와 공통 규칙");
  const raw = "  별을 보고\n\n잠깐 기다리자.  ";
  fireEvent.change(screen.getByLabelText("제안 1 본문"), { target: { value: raw } });
  fireEvent.change(world, { target: { value: "새 세계" } });
  vi.mocked(command).mockRejectedValueOnce(new Error("저장 충돌"));
  fireEvent.click(screen.getByRole("button", { name: "팩 이야기 저장" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "저장 충돌");
  expect(screen.getByLabelText("제안 1 본문")).toHaveProperty("value", raw);
  const expected = snapshot("a");
  expected.definition.worldRules = "새 세계";
  expected.definition.scenarios[0].intro![0].text = raw;
  expect(command).toHaveBeenLastCalledWith("save_pack_story_definition", {
    packId: "a",
    definition: expected.definition,
    expectedBaseline: "1",
  });
  vi.mocked(command).mockResolvedValueOnce({ ...expected, baseline: "2" });
  fireEvent.click(screen.getByRole("button", { name: "팩 이야기 저장" }));
  expect(await screen.findByText("팩의 이야기와 지식을 저장했어요.")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("세계와 공통 규칙"), { target: { value: "미저장" } });
  fireEvent.click(screen.getByRole("button", { name: "팩 이야기 수정 취소" }));
  expect(screen.getByLabelText("세계와 공통 규칙")).toHaveProperty("value", "새 세계");
});

it("discards per-pack drafts and rejects an old save after A to B to A", async () => {
  const view = render(<Harness packId="a" />);
  fireEvent.change(await screen.findByLabelText("세계와 공통 규칙"), {
    target: { value: "a 초안" },
  });
  let finish!: (value: PackStorySnapshot) => void;
  vi.mocked(command).mockReturnValueOnce(
    new Promise<PackStorySnapshot>((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "팩 이야기 저장" }));
  fireEvent.click(screen.getByRole("button", { name: "팩 이야기 저장" }));
  expect(
    vi.mocked(command).mock.calls.filter(([name]) => name === "save_pack_story_definition"),
  ).toHaveLength(1);
  view.rerender(<Harness packId="b" />);
  await waitFor(() =>
    expect(screen.getByLabelText("세계와 공통 규칙")).toHaveProperty("value", "b 세계"),
  );
  fireEvent.change(screen.getByLabelText("세계와 공통 규칙"), { target: { value: "b 초안" } });
  view.rerender(<Harness packId="a" />);
  expect(screen.getByLabelText("세계와 공통 규칙")).toHaveProperty("value", "a 세계");
  await act(async () => {
    finish(snapshot("a", "99"));
  });
  expect(screen.getByLabelText("세계와 공통 규칙")).toHaveProperty("value", "a 세계");
  expect(screen.queryByText("팩의 이야기와 지식을 저장했어요.")).toBeNull();
  fireEvent.change(screen.getByLabelText("세계와 공통 규칙"), {
    target: { value: "다시 편집 중" },
  });
  fireEvent.click(screen.getByRole("button", { name: "최신 팩 내용 확인" }));
  expect(await screen.findByRole("dialog", { name: "팩 이야기 초안을 버릴까요?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "계속 편집" }));
  expect(screen.getByLabelText("세계와 공통 규칙")).toHaveProperty("value", "다시 편집 중");
  view.rerender(<Harness packId="b" />);
  expect(screen.getByLabelText("세계와 공통 규칙")).toHaveProperty("value", "b 세계");
});

it("ignores a late pack save after the editor unmounts and the same pack is reopened", async () => {
  function Session() {
    const [open, setOpen] = useState(true);
    const [drafts, setDrafts] = useState<Record<string, PackStoryDraft>>({});
    const [, setPending] = useState(false);
    return (
      <>
        <button
          onClick={() => {
            setDrafts({});
            setOpen(false);
          }}
        >
          라이브러리
        </button>
        <button onClick={() => setOpen(true)}>다시 열기</button>
        {open && (
          <PackStoryEditor
            packId="a"
            visible
            installed={installed}
            drafts={drafts}
            onDraftsChange={setDrafts}
            onPendingChange={setPending}
            characterDirty={false}
          />
        )}
      </>
    );
  }
  render(<Session />);
  fireEvent.change(await screen.findByLabelText("세계와 공통 규칙"), {
    target: { value: "이전 초안" },
  });
  let finish!: (value: PackStorySnapshot) => void;
  vi.mocked(command).mockReturnValueOnce(
    new Promise<PackStorySnapshot>((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "팩 이야기 저장" }));
  expect(command).toHaveBeenLastCalledWith("save_pack_story_definition", {
    packId: "a",
    definition: { ...snapshot("a").definition, worldRules: "이전 초안" },
    expectedBaseline: "1",
  });
  fireEvent.click(screen.getByRole("button", { name: "라이브러리" }));
  fireEvent.click(screen.getByRole("button", { name: "다시 열기" }));
  fireEvent.change(await screen.findByLabelText("세계와 공통 규칙"), {
    target: { value: "새 초안" },
  });
  await act(async () => finish(snapshot("a", "99")));
  expect(screen.getByLabelText("세계와 공통 규칙")).toHaveProperty("value", "새 초안");
  expect(screen.queryByText("팩의 이야기와 지식을 저장했어요.")).toBeNull();
});

it("drops late trial results when its section closes or its visible tab changes", async () => {
  const view = render(<Harness packId="a" />);
  const trialButton = await openTrial();
  const user = userEvent.setup();
  const summary = screen.getByText("등록 이야기 시험", { selector: "summary" });
  fireEvent.change(screen.getByLabelText("등록 이야기 시험 입력 · 한 줄에 한 번"), {
    target: { value: "좋아\n계속" },
  });
  let finish!: (value: AuthoringTrialTrace) => void;
  vi.mocked(command).mockReturnValueOnce(
    new Promise<AuthoringTrialTrace>((resolve) => {
      finish = resolve;
    }),
  );
  fireEvent.click(trialButton);
  await waitFor(() =>
    expect(
      vi.mocked(command).mock.calls.filter(([name]) => name === "trial_pack_authoring"),
    ).toHaveLength(1),
  );
  await user.click(summary);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "등록 이야기 시험" })).toHaveProperty(
      "disabled",
      true,
    ),
  );
  await user.click(summary);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "등록 이야기 시험" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  await act(async () => {
    finish({
      blockedReasons: [],
      steps: [
        {
          input: "좋아",
          source: "registered",
          stage: "ending",
          conditions: [],
          blockedReasons: [],
          beforeState: trialState,
          afterState: { ...trialState, stage: "ending" },
          lines: [{ persona: "a-source-0", expression: "평온", text: "오래된 시험 결과" }],
          lineDurationsMs: [500],
          plannedEffects: { setFlags: ["done"], memoryTemplate: null },
          modelRequired: false,
          modelNotRunReason: null,
          presentationAssumed: true,
        },
      ],
    });
  });
  expect(screen.queryByText(/오래된 시험 결과/)).toBeNull();
  vi.mocked(command).mockResolvedValueOnce({ blockedReasons: [], steps: [] });
  fireEvent.click(screen.getByRole("button", { name: "등록 이야기 시험" }));
  expect(await screen.findByText("시험 조건에서 등록 응답이 없어요.")).toBeTruthy();
  view.rerender(<Harness packId="a" visible={false} />);
  view.rerender(<Harness packId="a" visible />);
  expect(screen.queryByText("시험 조건에서 등록 응답이 없어요.")).toBeNull();
  expect(
    vi
      .mocked(command)
      .mock.calls.every(([name]) =>
        ["get_pack_story_definition", "trial_pack_authoring"].includes(name),
      ),
  ).toBe(true);
});

it("dismisses a format confirmation when the selected pack changes", async () => {
  const view = render(<Harness packId="a" />);
  await screen.findByLabelText("이야기 제목");
  fireEvent.click(screen.getByRole("button", { name: "장면형" }));
  expect(screen.getByRole("dialog", { name: "이야기 방식을 바꿀까요?" })).toBeTruthy();
  view.rerender(<Harness packId="b" />);
  await waitFor(() =>
    expect(screen.getByLabelText("이야기 제목")).toHaveProperty("value", "b 이야기"),
  );
  expect(screen.queryByRole("dialog", { name: "이야기 방식을 바꿀까요?" })).toBeNull();
  expect(screen.getByLabelText("제안 1 본문")).toHaveProperty("value", "등록 원문");
});

it("saves shared fields and all story drafts after selecting and adding stories", async () => {
  const saved = snapshot("a");
  saved.definition.scenarios.push({
    ...saved.definition.scenarios[0],
    id: "a-second",
    title: "두 번째 이야기",
  });
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_pack_story_definition") return saved;
    if (name === "save_pack_story_definition") {
      return {
        ...saved,
        baseline: "2",
        definition: (args as { definition: PackStorySnapshot["definition"] }).definition,
      };
    }
    return undefined;
  });
  render(<Harness packId="a" />);
  const title = await screen.findByLabelText("이야기 제목");
  fireEvent.change(title, { target: { value: "첫 이야기 초안" } });
  fireEvent.change(screen.getByLabelText("세계와 공통 규칙"), {
    target: { value: "  세계 초안\n\n규칙  " },
  });
  fireEvent.click(screen.getByText("이야기 조건과 공개 여부", { selector: "summary" }));
  fireEvent.click(screen.getByRole("button", { name: "이야기 조건 추가" }));
  fireEvent.change(screen.getByLabelText("조건 1 이름"), { target: { value: "met" } });
  fireEvent.click(screen.getByText("조건부 지식 · 0개", { selector: "summary" }));
  fireEvent.click(screen.getByRole("button", { name: "조건부 지식 추가" }));
  fireEvent.change(screen.getByLabelText("지식 1 이름"), { target: { value: "secret" } });
  fireEvent.change(screen.getByLabelText("지식 1 키워드"), { target: { value: "비밀" } });
  fireEvent.change(screen.getByLabelText("지식 1 본문"), { target: { value: "비밀 원문" } });
  fireEvent.click(
    within(
      screen.getByText("조건부 지식 · 1개", { selector: "summary" }).closest("details")!,
    ).getByRole("checkbox", { name: installed[0].definition.name }),
  );
  fireEvent.change(screen.getByLabelText("편집할 이야기"), { target: { value: "a-second" } });
  expect(screen.getByLabelText("이야기 제목")).toHaveProperty("value", "두 번째 이야기");
  expect(screen.getByLabelText("세계와 공통 규칙")).toHaveProperty(
    "value",
    "  세계 초안\n\n규칙  ",
  );
  fireEvent.change(screen.getByLabelText("이야기 제목"), { target: { value: "두 번째 초안" } });
  fireEvent.click(screen.getByRole("button", { name: "등록 이야기 추가" }));
  const newId = (screen.getByLabelText("편집할 이야기") as HTMLSelectElement).value;
  fireEvent.change(screen.getByLabelText("이야기 제목"), { target: { value: "새 이야기 초안" } });
  fireEvent.click(screen.getByText("제안 · 1 / 32줄", { selector: "summary" }));
  fireEvent.change(screen.getByLabelText("제안 1 본문"), { target: { value: "함께 갈래?" } });
  fireEvent.click(screen.getByText("수락 · 1 / 32줄", { selector: "summary" }));
  fireEvent.change(screen.getByLabelText("수락 1 본문"), { target: { value: "같이 가자." } });
  fireEvent.click(screen.getByText("거절 · 1 / 32줄", { selector: "summary" }));
  fireEvent.change(screen.getByLabelText("거절 1 본문"), { target: { value: "다음에 가자." } });
  fireEvent.click(screen.getByText("마무리 · 1 / 32줄", { selector: "summary" }));
  fireEvent.change(screen.getByLabelText("마무리 1 본문"), { target: { value: "즐거웠어." } });
  fireEvent.change(screen.getByLabelText("편집할 이야기"), { target: { value: "a-story" } });
  expect(screen.getByLabelText("이야기 제목")).toHaveProperty("value", "첫 이야기 초안");
  fireEvent.change(screen.getByLabelText("편집할 이야기"), { target: { value: newId } });
  expect(screen.getByLabelText("이야기 제목")).toHaveProperty("value", "새 이야기 초안");
  expect(screen.getByRole("button", { name: "팩 이야기 저장" })).toHaveProperty("disabled", false);
  fireEvent.click(screen.getByRole("button", { name: "팩 이야기 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_pack_story_definition", {
      packId: "a",
      expectedBaseline: "1",
      definition: expect.objectContaining({
        worldRules: "  세계 초안\n\n규칙  ",
        storyFlags: [{ id: "met", public: false }],
        knowledge: [
          {
            id: "secret",
            keywords: ["비밀"],
            text: "비밀 원문",
            knownBy: [installed[0].definition.sourceId],
            requiredFlags: [],
          },
        ],
        scenarios: [
          { ...saved.definition.scenarios[0], title: "첫 이야기 초안" },
          { ...saved.definition.scenarios[1], title: "두 번째 초안" },
          expect.objectContaining({
            id: newId,
            title: "새 이야기 초안",
            intro: [
              { persona: installed[0].definition.sourceId, expression: "평온", text: "함께 갈래?" },
            ],
            accept: [
              { persona: installed[0].definition.sourceId, expression: "평온", text: "같이 가자." },
            ],
            decline: [
              { persona: installed[0].definition.sourceId, expression: "평온", text: "다음에 가자." },
            ],
            ending: [
              { persona: installed[0].definition.sourceId, expression: "평온", text: "즐거웠어." },
            ],
          }),
        ],
      }),
    }),
  );
  expect(await screen.findByText("팩의 이야기와 지식을 저장했어요.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "팩 이야기 저장" })).toHaveProperty("disabled", true);
});
