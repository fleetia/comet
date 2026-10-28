import { openCharacterPage } from "./characterNavigation";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { AuthoringTrial } from "../components/CharacterEditor/AuthoringTrial";
import { CharacterEditor } from "../components/CharacterEditor/CharacterEditor";
import { TauriEvent } from "@tauri-apps/api/event";
import { command, isDesktop, PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";
import type { AuthoringState, AuthoringTrialTrace, PackStoryDefinition } from "../types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(() => false),
}));
const native = vi.hoisted(() => ({ listeners: new Set<() => void>(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));

const actors = PREVIEW_SNAPSHOT.characters.installed.map((actor, index) => ({
  ...actor,
  id: `local-${index}`,
  packId: "trial-pack",
  definition: {
    ...actor.definition,
    sourceId: `source-${index}`,
    presenceRole: index === 0 ? ("resident" as const) : ("npc" as const),
  },
}));
const definition: PackStoryDefinition = {
  worldRules: "시험 세계",
  storyFlags: [{ id: "invited", public: true }],
  knowledge: [],
  scenarios: [],
};
const state: AuthoringState = {
  stage: null,
  ready: true,
  presentIds: [actors[0].id],
  flags: [],
  turn: 0,
  waitTurn: 0,
  pendingNextScenarioId: null,
};
function trace(): AuthoringTrialTrace {
  return {
    blockedReasons: [],
    steps: [
      {
        input: "초대",
        source: "registered",
        stage: "entry",
        conditions: [{ id: "invite", label: "초대 표현", matched: true }],
        blockedReasons: [],
        beforeState: state,
        afterState: {
          ...state,
          stage: "entry",
          presentIds: actors.map((actor) => actor.id),
          turn: 1,
        },
        lines: actors.map((actor, index) => ({
          persona: actor.id,
          expression: "평온",
          text: `  원문 ${index}\n다음 줄  `,
        })),
        lineDurationsMs: [120, 180],
        plannedEffects: { setFlags: [], memoryTemplate: null },
        modelRequired: false,
        modelNotRunReason: null,
        presentationAssumed: true,
      },
    ],
  };
}
const props = {
  title: "NPC 등장 시험",
  actors,
  definition,
  packId: "trial-pack",
  baseline: "1",
  subject: { kind: "npc" as const, actorId: actors[1].id },
  visible: true,
  presentIds: [actors[0].id],
};
function expand(open = true): void {
  const details = screen.getByText("NPC 등장 시험", { selector: "summary" }).closest("details")!;
  details.open = open;
  fireEvent(details, new Event("toggle"));
}
function run(): void {
  fireEvent.click(screen.getByRole("button", { name: "NPC 등장 시험" }));
}
beforeEach(() => {
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(trace());
  vi.mocked(isDesktop).mockReturnValue(false);
  native.listeners.clear();
  native.listen.mockReset().mockImplementation(async (_event: string, callback: () => void) => {
    native.listeners.add(callback);
    return () => native.listeners.delete(callback);
  });
});

it.each(["window-close", "document-hide"])(
  "invalidates displayed and pending trials after %s without changing retained definitions",
  async (cause) => {
    vi.mocked(isDesktop).mockReturnValue(cause === "window-close");
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    const original = structuredClone({ actors, definition });
    const view = render(<AuthoringTrial {...props} />);
    if (cause === "window-close") {
      await waitFor(() =>
        expect(native.listen).toHaveBeenCalledWith(
          TauriEvent.WINDOW_CLOSE_REQUESTED,
          expect.any(Function),
        ),
      );
    }
    function close(): void {
      act(() => {
        if (cause === "window-close") native.listeners.forEach((callback) => callback());
        else {
          hidden.mockReturnValue(true);
          fireEvent(document, new Event("visibilitychange"));
        }
      });
    }
    function reopen(): void {
      hidden.mockReturnValue(false);
      fireEvent(document, new Event("visibilitychange"));
      view.rerender(<AuthoringTrial {...props} />);
    }
    expand();
    run();
    const preview = within(await screen.findByLabelText("선택한 대사 미리보기"));
    fireEvent.click(preview.getByRole("button", { name: "미리보기" }));
    await waitFor(() =>
      expect(preview.getByRole("button", { name: "정지" })).toHaveProperty("disabled", false),
    );
    close();
    reopen();
    expect(screen.queryByLabelText("NPC 등장 시험 결과")).toBeNull();
    expect(screen.queryByLabelText("선택한 대사 미리보기")).toBeNull();
    let finish!: (value: AuthoringTrialTrace) => void;
    vi.mocked(command).mockReturnValueOnce(
      new Promise<AuthoringTrialTrace>((resolve) => {
        finish = resolve;
      }),
    );
    run();
    close();
    reopen();
    await act(async () => finish(trace()));
    expect(screen.queryByLabelText("NPC 등장 시험 결과")).toBeNull();
    run();
    await screen.findByLabelText("NPC 등장 시험 결과");
    expect(command).toHaveBeenCalledTimes(3);
    expect({ actors, definition }).toEqual(original);
  },
);
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("trials edited actor IDs with explicit conditions, state changes and raw registered speaker text without saving", async () => {
  const source = structuredClone(actors);
  render(<AuthoringTrial {...props} />);
  expand();
  fireEvent.change(screen.getByLabelText("NPC 등장 시험 입력 · 한 줄에 한 번"), {
    target: { value: "  초대  \n계속" },
  });
  fireEvent.click(screen.getByLabelText("invited · 시험 조건"));
  fireEvent.change(screen.getByLabelText("NPC 등장 시험 친밀도"), { target: { value: "37" } });
  run();
  const result = await screen.findByLabelText("NPC 등장 시험 결과");
  expect(command).toHaveBeenCalledExactlyOnceWith("trial_pack_authoring", {
    request: {
      actors: actors.map((actor) => ({
        id: actor.id,
        packId: actor.packId,
        definition: actor.definition,
      })),
      definition,
      subject: props.subject,
      context: {
        centerId: actors[0].id,
        presentIds: [actors[0].id],
        flags: ["invited"],
        affinity: 37,
        turn: 0,
        waitTurn: 0,
        completedScenarioIds: [],
        incompleteScenarioIds: [],
      },
      inputs: ["  초대  ", "계속"],
    },
  });
  expect(result.textContent).toContain("초대 표현: 충족");
  expect(result.textContent).toContain("시험 전: 대기");
  expect(result.textContent).toContain("시험 후: 등장");
  expect(result.textContent).toContain("실제 표시나 완료 증거가 아니에요.");
  for (const [index, actor] of actors.entries()) {
    expect(
      within(result).getByText(
        (_, element) =>
          element?.tagName === "P" &&
          element.textContent === `${actor.definition.name}:   원문 ${index}\n다음 줄  `,
      ),
    ).toBeTruthy();
  }
  expect(actors).toEqual(source);
});

it("labels a registered relationship response without a story stage", async () => {
  const reply = trace();
  reply.steps[0].stage = null;
  vi.mocked(command).mockResolvedValue(reply);
  render(
    <AuthoringTrial
      {...props}
      subject={{ kind: "relation", actorId: actors[0].id, targetId: actors[1].id }}
    />,
  );
  expand();
  run();
  const result = await screen.findByLabelText("NPC 등장 시험 결과");
  expect(within(result).getByRole("button", { name: "1. 등록 응답" })).toBeTruthy();
  expect(result.textContent).toContain("출처: 등록 대사");
});

it.each(["collapse", "hide", "draft", "actorDraft", "assets", "baseline", "unmount"])(
  "rejects a late trial after %s and requires a fresh trial",
  async (change) => {
    let finish!: (value: AuthoringTrialTrace) => void;
    vi.mocked(command).mockReturnValueOnce(
      new Promise<AuthoringTrialTrace>((resolve) => {
        finish = resolve;
      }),
    );
    const view = render(<AuthoringTrial {...props} />);
    expand();
    run();
    expect(command).toHaveBeenCalledTimes(1);
    switch (change) {
      case "collapse":
        expand(false);
        expand();
        break;
      case "hide":
        view.rerender(<AuthoringTrial {...props} visible={false} />);
        view.rerender(<AuthoringTrial {...props} />);
        break;
      case "draft":
        view.rerender(
          <AuthoringTrial {...props} definition={{ ...definition, worldRules: "새 초안" }} />,
        );
        break;
      case "actorDraft":
        view.rerender(
          <AuthoringTrial
            {...props}
            actors={actors.map((actor) => ({
              ...actor,
              definition: { ...actor.definition, instructions: "편집한 인물 초안" },
            }))}
          />,
        );
        break;
      case "assets":
        view.rerender(
          <AuthoringTrial
            {...props}
            assets={{
              [actors[0].id]: [
                {
                  assetId: "draft",
                  mime: "image/png",
                  width: 16,
                  height: 16,
                  data: "changed-bytes",
                },
              ],
            }}
          />,
        );
        break;
      case "baseline":
        view.rerender(<AuthoringTrial {...props} baseline="2" />);
        break;
      case "unmount":
        view.unmount();
        break;
    }
    await act(async () => {
      finish(trace());
    });
    expect(screen.queryByLabelText("NPC 등장 시험 결과")).toBeNull();
  },
);

it("counts other-pack occupied slots and disables another participant at eight without altering the actual actors", () => {
  const presentIds = [actors[0].id, ...Array.from({ length: 7 }, (_, index) => `outside-${index}`)];
  render(<AuthoringTrial {...props} presentIds={presentIds} />);
  expand();
  const guest = screen.getByLabelText(`${actors[1].definition.name} · 시험 참가`);
  expect(guest).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByLabelText("다른 팩의 점유 자리 1"));
  expect(guest).toHaveProperty("disabled", false);
  expect(command).not.toHaveBeenCalled();
});

it("replays the ordered local speakers with their durations and stops on condition changes", async () => {
  const view = render(<AuthoringTrial {...props} />);
  expand();
  run();
  const preview = within(await screen.findByLabelText("선택한 대사 미리보기"));
  vi.useFakeTimers();
  fireEvent.click(preview.getByRole("button", { name: "미리보기" }));
  expect(preview.getByText(actors[0].definition.name)).toBeTruthy();
  await act(async () => {
    vi.advanceTimersByTime(120);
  });
  expect(preview.getByText(actors[1].definition.name)).toBeTruthy();
  expect(preview.getByRole("button", { name: "정지" })).toHaveProperty("disabled", false);
  await act(async () => {
    vi.advanceTimersByTime(180);
  });
  expect(preview.getByRole("button", { name: "정지" })).toHaveProperty("disabled", true);
  fireEvent.click(preview.getByRole("button", { name: "미리보기" }));
  view.rerender(<AuthoringTrial {...props} visible={false} />);
  expect(screen.queryByLabelText("NPC 등장 시험 결과")).toBeNull();
  await act(async () => {
    vi.runOnlyPendingTimers();
  });
  expect(command).toHaveBeenCalledTimes(1);
});

it("shows block reasons and an explicit model requirement without requesting generation", async () => {
  const value = trace();
  value.steps[0] = {
    ...value.steps[0],
    source: "none",
    stage: null,
    lines: [],
    lineDurationsMs: [],
    blockedReasons: ["등장 조건이 부족해요."],
    modelRequired: true,
    modelNotRunReason: "생성 응답에는 AI가 필요해요. 시험에서는 실행하지 않았어요.",
  };
  vi.mocked(command).mockResolvedValueOnce(value);
  render(<AuthoringTrial {...props} />);
  expand();
  run();
  await waitFor(() => expect(screen.getByText("등장 조건이 부족해요.")).toBeTruthy());
  expect(screen.getByText(value.steps[0].modelNotRunReason!)).toBeTruthy();
  expect(command).toHaveBeenCalledTimes(1);
  expect(screen.queryByLabelText("선택한 대사 미리보기")).toBeNull();
});

it("reloads a pending pack definition for a new baseline and rejects the older read", async () => {
  let finishOld!: (value: unknown) => void;
  let finishNew!: (value: unknown) => void;
  vi.mocked(command).mockReturnValueOnce(
    new Promise((resolve) => {
      finishOld = resolve;
    }),
  );
  const view = render(<AuthoringTrial {...props} definition={undefined} />);
  expand();
  await waitFor(() => expect(command).toHaveBeenCalledTimes(1));
  vi.mocked(command).mockReturnValueOnce(
    new Promise((resolve) => {
      finishNew = resolve;
    }),
  );
  view.rerender(<AuthoringTrial {...props} definition={undefined} baseline="2" />);
  await waitFor(() => expect(command).toHaveBeenCalledTimes(2));
  await act(async () => {
    finishOld({
      packId: props.packId,
      baseline: "1",
      sourceToLocal: {},
      definition: { ...definition, storyFlags: [{ id: "old", public: true }] },
    });
  });
  expect(screen.queryByLabelText("old · 시험 조건")).toBeNull();
  await act(async () => {
    finishNew({
      packId: props.packId,
      baseline: "2",
      sourceToLocal: {},
      definition: { ...definition, storyFlags: [{ id: "new", public: true }] },
    });
  });
  expect(screen.getByLabelText("new · 시험 조건")).toBeTruthy();
  expect(screen.getByRole("button", { name: "NPC 등장 시험" })).toHaveProperty("disabled", false);
});

it("wires relationship and NPC trials to the edited definition through their existing editor tabs", async () => {
  const resident = {
    ...actors[0],
    definition: {
      ...actors[0].definition,
      relationships: [
        {
          targetId: actors[1].id,
          description: "함께 보는 별",
          replyLines: [{ expression: "평온", text: "  편집한 관계 원문  " }],
        },
      ],
    },
  };
  const guest = {
    ...actors[1],
    definition: {
      ...actors[1].definition,
      npc: {
        inviteKeywords: ["초대"],
        appearanceKeywords: [],
        requiredFlags: [],
        entryLines: [{ expression: "평온", text: "편집한 입장" }],
        exitPolicy: "topicChange" as const,
      },
    },
  };
  const editorProps = {
    character: resident,
    definition: resident.definition,
    installed: [resident, guest],
    presentIds: [resident.id],
    packDefinition: definition,
    packBaseline: "2",
    onChange: vi.fn(),
    onSave: vi.fn(),
    pending: false,
    dirty: true,
  };
  const view = render(<CharacterEditor {...editorProps} />);
  openCharacterPage("프로필");
  openCharacterPage("다른 친구와의 관계");
  const relation = screen.getByText("관계 1 시험", { selector: "summary" }).closest("details")!;
  relation.open = true;
  fireEvent(relation, new Event("toggle"));
  fireEvent.click(screen.getByRole("button", { name: "관계 1 시험" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("trial_pack_authoring", {
      request: expect.objectContaining({
        subject: { kind: "relation", actorId: resident.id, targetId: guest.id },
        actors: expect.arrayContaining([
          expect.objectContaining({ id: resident.id, definition: resident.definition }),
        ]),
      }),
    }),
  );
  view.rerender(
    <CharacterEditor {...editorProps} character={guest} definition={guest.definition} />,
  );
  openCharacterPage("프로필");
  openCharacterPage("등장·이야기");
  expand();
  run();
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("trial_pack_authoring", {
      request: expect.objectContaining({
        subject: { kind: "npc", actorId: guest.id },
        actors: expect.arrayContaining([
          expect.objectContaining({ id: guest.id, definition: guest.definition }),
        ]),
      }),
    }),
  );
  expect(editorProps.onSave).not.toHaveBeenCalled();
  expect(editorProps.onChange).not.toHaveBeenCalled();
});
