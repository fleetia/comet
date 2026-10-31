import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { command, PREVIEW_SNAPSHOT } from "../../hooks/useSnapshot";
import type { AuthoringTrialTrace, PackStoryDefinition, ScenarioDefinition } from "../../types";
import { StoryTrialPanel } from "./StoryTrialPanel";

vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
}));
const actors = PREVIEW_SNAPSHOT.characters.installed
  .slice(0, 1)
  .map((actor) => ({ ...actor, packId: "pack" }));
const scenario: ScenarioDefinition = {
  id: "story",
  title: "이야기",
  centerId: actors[0].definition.sourceId,
  participants: [actors[0].definition.sourceId],
  keywords: [],
  requiredFlags: [],
  minAffinity: 0,
  chapters: [
    { id: "first", title: "첫 장", steps: [] },
    { id: "second", title: "둘째 장", steps: [] },
  ],
  allowIncompleteRepeat: false,
  allowRepeat: false,
  completion: { setFlags: [], memoryTemplate: null },
};
const definition: PackStoryDefinition = {
  worldRules: "",
  storyFlags: [{ id: "open", public: true }],
  knowledge: [],
  scenarios: [scenario],
};
const waiting: AuthoringTrialTrace = {
  blockedReasons: [],
  steps: [],
  scene: {
    status: "wait",
    chapterId: "second",
    prompt: null,
    options: [],
    history: [{ text: "안녕", persona: actors[0].id }],
    chapterPath: ["second"],
  },
};
const props = {
  actors,
  definition,
  scenario,
  startChapterId: "second",
  visible: true,
  onTrace: vi.fn(),
  onClose: vi.fn(),
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("선택한 장과 임시 설정으로 시험하고 이벤트와 시간 초과를 전달한다", async () => {
  vi.mocked(command).mockResolvedValue(waiting);
  render(<StoryTrialPanel {...props} />);
  fireEvent.change(screen.getByLabelText("이미 알고 있는 이름"), { target: { value: "하늘" } });
  fireEvent.click(screen.getByLabelText("open"));
  fireEvent.click(screen.getByRole("button", { name: "이 장부터 시험" }));
  await screen.findByText(/안녕/);
  expect(command).toHaveBeenCalledWith(
    "trial_pack_authoring",
    expect.objectContaining({
      request: expect.objectContaining({
        sceneStartChapterId: "second",
        sceneKnownName: "하늘",
        context: expect.objectContaining({ flags: ["open"] }),
      }),
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "이벤트 보내기" }));
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith(
      "trial_pack_authoring",
      expect.objectContaining({
        request: expect.objectContaining({ sceneResponses: [{ kind: "event" }] }),
      }),
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "시간 초과" }));
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith(
      "trial_pack_authoring",
      expect.objectContaining({
        request: expect.objectContaining({
          sceneResponses: [{ kind: "event" }, { kind: "timeout" }],
        }),
      }),
    ),
  );
  expect(vi.mocked(command).mock.calls.every(([name]) => name === "trial_pack_authoring")).toBe(
    true,
  );
});

it("초안이 바뀌거나 창이 숨겨지면 진행 중 결과를 버린다", async () => {
  let finish!: (result: AuthoringTrialTrace) => void;
  vi.mocked(command).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(<StoryTrialPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "처음부터 시험" }));
  view.rerender(
    <StoryTrialPanel {...props} definition={{ ...definition, worldRules: "바뀐 초안" }} />,
  );
  await act(async () => finish(waiting));
  expect(screen.queryByText(/안녕/)).toBeNull();
  vi.mocked(command).mockResolvedValue(waiting);
  fireEvent.click(screen.getByRole("button", { name: "처음부터 시험" }));
  await screen.findByText(/안녕/);
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  fireEvent(document, new Event("visibilitychange"));
  expect(screen.queryByText(/안녕/)).toBeNull();
  Reflect.deleteProperty(document, "hidden");
});

it("입력과 선택을 현재 대화에서 전송하며 응답을 순서대로 유지한다", async () => {
  const ask: AuthoringTrialTrace = {
    ...waiting,
    scene: {
      ...waiting.scene!,
      status: "ask",
      prompt: "이름은?",
      history: [{ persona: actors[0].id, text: "이름은?" }],
    },
  };
  const choice: AuthoringTrialTrace = {
    ...waiting,
    scene: {
      ...waiting.scene!,
      status: "choice",
      prompt: "어디로?",
      options: [{ id: "home", label: "집" }],
      history: [
        { persona: actors[0].id, text: "이름은?" },
        { persona: null, text: "하늘" },
        { persona: actors[0].id, text: "어디로?" },
      ],
    },
  };
  vi.mocked(command)
    .mockResolvedValueOnce(ask)
    .mockResolvedValueOnce(choice)
    .mockResolvedValueOnce(waiting);
  render(<StoryTrialPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "처음부터 시험" }));
  await screen.findByText(/이름은/);
  fireEvent.change(screen.getByLabelText("시험 입력"), { target: { value: "하늘" } });
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
  await screen.findByRole("button", { name: "집" });
  fireEvent.click(screen.getByRole("button", { name: "집" }));
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith(
      "trial_pack_authoring",
      expect.objectContaining({
        request: expect.objectContaining({
          sceneResponses: [
            { kind: "answer", value: "하늘" },
            { kind: "choice", optionId: "home" },
          ],
        }),
      }),
    ),
  );
});

it("시험을 닫거나 숨겼다 다시 열어도 이전 요청은 나타나지 않고 다시 시험할 수 있다", async () => {
  let finishClosed!: (result: AuthoringTrialTrace) => void;
  let finishHidden!: (result: AuthoringTrialTrace) => void;
  vi.mocked(command).mockReset();
  vi.mocked(command).mockReturnValueOnce(
    new Promise((resolve) => {
      finishClosed = resolve;
    }),
  );
  const view = render(<StoryTrialPanel {...props} />);
  fireEvent.click(screen.getByRole("button", { name: "처음부터 시험" }));
  expect(command).toHaveBeenCalledTimes(1);
  view.rerender(<></>);
  view.rerender(<StoryTrialPanel {...props} />);
  await act(async () => finishClosed(waiting));
  expect(screen.queryByText(/안녕/)).toBeNull();
  vi.mocked(command).mockResolvedValueOnce(waiting);
  fireEvent.click(screen.getByRole("button", { name: "처음부터 시험" }));
  await screen.findByText(/안녕/);
  view.rerender(<StoryTrialPanel {...props} visible={false} />);
  view.rerender(<StoryTrialPanel {...props} visible />);
  expect(screen.queryByText(/안녕/)).toBeNull();
  vi.mocked(command).mockReturnValueOnce(
    new Promise((resolve) => {
      finishHidden = resolve;
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "처음부터 시험" }));
  view.rerender(<StoryTrialPanel {...props} visible={false} />);
  view.rerender(<StoryTrialPanel {...props} visible />);
  await act(async () => finishHidden(waiting));
  expect(screen.queryByText(/안녕/)).toBeNull();
  vi.mocked(command).mockResolvedValueOnce(waiting);
  fireEvent.click(screen.getByRole("button", { name: "처음부터 시험" }));
  await screen.findByText(/안녕/);
  expect(vi.mocked(command).mock.calls.every(([name]) => name === "trial_pack_authoring")).toBe(
    true,
  );
});

it("제안형 시험에 등록 응답이 없으면 안내하고 숨겼다 열면 결과를 버린다", async () => {
  const proposal = { ...scenario, chapters: null };
  const proposalDefinition = { ...definition, scenarios: [proposal] };
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue({ blockedReasons: [], steps: [] });
  const view = render(
    <StoryTrialPanel {...props} definition={proposalDefinition} scenario={proposal} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "처음부터 시험" }));
  expect(await screen.findByText("시험 조건에서 등록 응답이 없어요.")).toBeTruthy();
  view.rerender(
    <StoryTrialPanel
      {...props}
      definition={proposalDefinition}
      scenario={proposal}
      visible={false}
    />,
  );
  view.rerender(
    <StoryTrialPanel {...props} definition={proposalDefinition} scenario={proposal} visible />,
  );
  expect(screen.queryByText("시험 조건에서 등록 응답이 없어요.")).toBeNull();
  expect(vi.mocked(command).mock.calls.every(([name]) => name === "trial_pack_authoring")).toBe(
    true,
  );
});

it("제안형 시험을 닫은 뒤 늦게 온 대사를 버리고 다시 시험한다", async () => {
  const proposal = { ...scenario, chapters: null };
  const proposalDefinition = { ...definition, scenarios: [proposal] };
  const state = {
    stage: null,
    ready: false,
    presentIds: [actors[0].id],
    flags: [],
    turn: 0,
    waitTurn: 0,
    pendingNextScenarioId: null,
  };
  const late: AuthoringTrialTrace = {
    blockedReasons: [],
    steps: [
      {
        input: "시작",
        source: "registered",
        stage: "intro",
        conditions: [],
        blockedReasons: [],
        beforeState: state,
        afterState: state,
        lines: [{ persona: actors[0].id, expression: "평온", text: "오래된 시험 결과" }],
        lineDurationsMs: [500],
        plannedEffects: { setFlags: [], memoryTemplate: null },
        modelRequired: false,
        modelNotRunReason: null,
        presentationAssumed: true,
      },
    ],
  };
  let finish!: (result: AuthoringTrialTrace) => void;
  vi.mocked(command).mockReset();
  vi.mocked(command).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = render(
    <StoryTrialPanel {...props} definition={proposalDefinition} scenario={proposal} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "처음부터 시험" }));
  view.rerender(<></>);
  view.rerender(<StoryTrialPanel {...props} definition={proposalDefinition} scenario={proposal} />);
  await act(async () => finish(late));
  expect(screen.queryByText(/오래된 시험 결과/)).toBeNull();
  vi.mocked(command).mockResolvedValueOnce({ blockedReasons: [], steps: [] });
  fireEvent.click(screen.getByRole("button", { name: "처음부터 시험" }));
  expect(await screen.findByText("시험 조건에서 등록 응답이 없어요.")).toBeTruthy();
  view.rerender(
    <StoryTrialPanel
      {...props}
      definition={proposalDefinition}
      scenario={proposal}
      visible={false}
    />,
  );
  view.rerender(
    <StoryTrialPanel {...props} definition={proposalDefinition} scenario={proposal} visible />,
  );
  expect(screen.queryByText("시험 조건에서 등록 응답이 없어요.")).toBeNull();
  expect(vi.mocked(command).mock.calls.every(([name]) => name === "trial_pack_authoring")).toBe(
    true,
  );
});
