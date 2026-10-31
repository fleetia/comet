import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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

it("preserves scene stories when saving other edits and blocks editing and trials", async () => {
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
  expect(await screen.findByText("이 이야기는 아직 여기서 고칠 수 없어요.")).toBeTruthy();
  expect(screen.getByText("아직 시험할 수 없어요.")).toBeTruthy();
  expect(screen.queryByLabelText("이야기 제목")).toBeNull();
  expect(screen.queryByRole("button", { name: "등록 이야기 시험" })).toBeNull();
  fireEvent.change(screen.getByLabelText("세계와 공통 규칙"), {
    target: { value: "수정한 세계" },
  });
  fireEvent.click(screen.getByRole("button", { name: "팩 이야기 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("save_pack_story_definition", {
      packId: "a",
      definition: { ...saved.definition, worldRules: "수정한 세계" },
      expectedBaseline: "1",
    }),
  );
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

it("discards unsaved story edits when choosing another registered story", async () => {
  const saved = snapshot("a");
  saved.definition.scenarios.push({
    ...saved.definition.scenarios[0],
    id: "a-second",
    title: "두 번째 이야기",
  });
  vi.mocked(command).mockImplementation(async (name) =>
    name === "get_pack_story_definition" ? saved : undefined,
  );
  render(<Harness packId="a" />);
  const title = await screen.findByLabelText("이야기 제목");
  fireEvent.change(title, { target: { value: "버릴 이야기 제목" } });
  fireEvent.change(screen.getByLabelText("세계와 공통 규칙"), {
    target: { value: "버릴 세계 초안" },
  });
  fireEvent.change(screen.getByLabelText("편집할 이야기"), { target: { value: "a-second" } });
  expect(screen.getByLabelText("이야기 제목")).toHaveProperty("value", "두 번째 이야기");
  expect(screen.getByLabelText("세계와 공통 규칙")).toHaveProperty(
    "value",
    saved.definition.worldRules,
  );
  fireEvent.change(screen.getByLabelText("편집할 이야기"), { target: { value: "a-story" } });
  expect(screen.getByLabelText("이야기 제목")).toHaveProperty("value", "a 이야기");
  expect(screen.getByRole("button", { name: "팩 이야기 저장" })).toHaveProperty("disabled", true);
});
