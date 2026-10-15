import { openCharacterPage, selectFriend } from "./characterNavigation";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CharacterManager } from "../components/CharacterManager/CharacterManager";
import { command, PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";
import type { AnimationAsset, AuthoringTrialTrace, PackStorySnapshot, Snapshot } from "../types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
const native = vi.hoisted(() => ({ listeners: new Set<() => void>(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));

const assets: AnimationAsset[] = ["resident", "guest"].map((owner) => ({
  assetId: "shared-asset",
  mime: "image/png",
  width: 16,
  height: 16,
  data: `${owner}-draft-bytes`,
}));
const actors = PREVIEW_SNAPSHOT.characters.installed.map((actor, index) => ({
  ...actor,
  id: `trial-local-${index}`,
  packId: "trial-pack",
  definition: {
    ...actor.definition,
    sourceId: `trial-source-${index}`,
    presenceRole: index === 0 ? ("resident" as const) : ("npc" as const),
    relationships:
      index === 0 ? [{ targetId: "trial-local-1", description: "방향별 관계 초안" }] : [],
    npc:
      index === 1
        ? {
            inviteKeywords: ["초대"],
            appearanceKeywords: [],
            requiredFlags: [],
            entryLines: [{ expression: "기쁨", text: "입장 원문" }],
            exitPolicy: "topicChange" as const,
          }
        : undefined,
    animation: {
      clips: [{ id: "trial-clip", name: "시험 동작", fps: 8, frames: [] }],
      bindings: {},
      overrides: {},
    },
  },
}));
const snapshot: Snapshot = {
  ...PREVIEW_SNAPSHOT,
  characters: { installed: actors, active: [actors[0].id] },
};
const lines = actors.map((actor, index) => ({
  persona: actor.id,
  expression: index === 0 ? "평온" : "기쁨",
  text: `  인물 ${index} 원문\n다음 줄  `,
  motion: { mode: "clip" as const, clipId: "trial-clip", repeat: false, intervalMs: 0 },
}));
const pack: PackStorySnapshot = {
  packId: "trial-pack",
  baseline: "1",
  sourceToLocal: Object.fromEntries(actors.map((actor) => [actor.definition.sourceId, actor.id])),
  definition: {
    worldRules: "시험 세계",
    storyFlags: [],
    knowledge: [],
    scenarios: [
      {
        id: "trial-story",
        title: "시험 이야기",
        centerId: actors[0].definition.sourceId,
        participants: actors.map((actor) => actor.definition.sourceId),
        keywords: ["별"],
        requiredFlags: [],
        minAffinity: 0,
        intro: lines.map((line, index) => ({
          ...line,
          persona: actors[index].definition.sourceId,
        })),
        accept: [],
        decline: [],
        ending: [],
        acceptKeywords: ["좋아"],
        declineKeywords: ["다음에"],
        proceedKeywords: ["계속"],
        cancelKeywords: ["그만"],
        acceptNextId: null,
        declineNextId: null,
        allowIncompleteRepeat: true,
        allowRepeat: false,
        completion: { setFlags: [], memoryTemplate: null },
      },
    ],
  },
};
const state = {
  stage: null,
  ready: true,
  presentIds: actors.map((actor) => actor.id),
  flags: [],
  turn: 0,
  waitTurn: 0,
  pendingNextScenarioId: null,
};
const trace: AuthoringTrialTrace = {
  blockedReasons: [],
  steps: [
    {
      input: "별",
      source: "registered",
      stage: "intro",
      conditions: [],
      blockedReasons: [],
      beforeState: state,
      afterState: { ...state, stage: "intro" },
      lines,
      lineDurationsMs: [120, 180],
      plannedEffects: { setFlags: [], memoryTemplate: null },
      modelRequired: false,
      modelNotRunReason: null,
      presentationAssumed: true,
    },
  ],
};
let urls: string[];
let assetIndex: number;

beforeEach(() => {
  urls = [];
  assetIndex = 0;
  native.listeners.clear();
  native.listen.mockReset().mockImplementation(async (_event: string, callback: () => void) => {
    native.listeners.add(callback);
    return () => native.listeners.delete(callback);
  });
  vi.mocked(command).mockReset();
  vi.mocked(command).mockImplementation(async (name) => {
    switch (name) {
      case "get_character_dialogue":
        return { pairScenes: [], wordbook: [] };
      case "get_character_packs":
      case "get_character_reaction_events":
        return [];
      case "get_character_pack_attribution":
        return { author: "", sourceUrl: "" };
      case "list_memories":
        return { items: [], total: 0 };
      case "count_character_memories":
        return 0;
      case "choose_animation_assets":
        return [assets[assetIndex++]];
      case "get_pack_story_definition":
        return pack;
      case "trial_pack_authoring":
        return trace;
      default:
        return undefined;
    }
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
    clearRect: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  vi.stubGlobal(
    "Image",
    vi.fn(function image() {
      const element = document.createElement("img");
      Object.defineProperties(element, {
        naturalWidth: { value: 16 },
        naturalHeight: { value: 16 },
        src: {
          set(value: string) {
            urls.push(value);
            if (value) queueMicrotask(() => element.dispatchEvent(new Event("load")));
          },
        },
      });
      return element;
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function selectTab(name: string): void {
  openCharacterPage(name);
}
function chooseCharacter(name: string): void {
  selectFriend(new RegExp(`^${name}`));
}

async function addDraftAsset(): Promise<void> {
  selectTab("모습·표정");
  const appearance = within(screen.getByLabelText("모습·표정", { selector: '[role="tabpanel"]' }));
  fireEvent.click(appearance.getByRole("button", { name: "시험 동작 동작 선택" }));
  fireEvent.click(appearance.getByRole("button", { name: "PNG/APNG 프레임 추가" }));
  await appearance.findByLabelText("1번 프레임 선택");
}

it.each([
  ["relation", "관계 1 시험"],
  ["npc", "NPC 등장 시험"],
  ["scenario", "등록 이야기 시험"],
])(
  "replays %s trials with each speaker's unsaved bytes even when asset IDs match",
  async (kind, title) => {
    const original = structuredClone(snapshot);
    render(<CharacterManager embedded snapshot={snapshot} />);
    openCharacterPage("프로필");
    await addDraftAsset();
    chooseCharacter(actors[1].definition.name);
    await addDraftAsset();
    if (kind === "relation" || kind === "scenario") chooseCharacter(actors[0].definition.name);
    selectTab(kind === "relation" ? "다른 친구와의 관계" : "등장·이야기");
    const summary = await screen.findByText(title, { selector: "summary" });
    const details = summary.closest("details")!;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    const trial = within(details);
    await waitFor(() =>
      expect(trial.getByRole("button", { name: title })).toHaveProperty("disabled", false),
    );
    urls = [];
    fireEvent.click(trial.getByRole("button", { name: title }));
    const result = await trial.findByLabelText(`${title} 결과`);
    const preview = within(result).getByLabelText("선택한 대사 미리보기");
    await waitFor(() => expect(urls).toContain("data:image/png;base64,resident-draft-bytes"));
    expect(preview.textContent).toContain(lines[0].text);
    expect(within(preview).getByText(actors[0].definition.expressions.평온)).toBeTruthy();
    fireEvent.click(within(preview).getByRole("button", { name: "미리보기" }));
    await waitFor(() => expect(preview.textContent).toContain(lines[1].text));
    expect(within(preview).getByText(actors[1].definition.name)).toBeTruthy();
    expect(urls).toContain("data:image/png;base64,guest-draft-bytes");
    expect(urls.filter(Boolean).every((url) => url.startsWith("data:image/png;base64,"))).toBe(
      true,
    );
    await waitFor(() =>
      expect(within(preview).getByRole("button", { name: "정지" })).toHaveProperty(
        "disabled",
        true,
      ),
    );
    expect(within(preview).getByText(actors[1].definition.expressions.기쁨)).toBeTruthy();
    if (kind === "scenario") {
      const world = screen.getByLabelText("세계와 공통 규칙");
      fireEvent.change(world, { target: { value: "  유지할 세계 초안\n원문  " } });
      fireEvent.click(trial.getByRole("button", { name: title }));
      await trial.findByLabelText(`${title} 결과`);
      openCharacterPage("프로필");
      openCharacterPage("등장·이야기");
      expect(trial.queryByLabelText(`${title} 결과`)).toBeNull();
      expect(world).toHaveProperty("value", "  유지할 세계 초안\n원문  ");
    }
    expect(snapshot).toEqual(original);
    expect(
      vi
        .mocked(command)
        .mock.calls.filter(
          ([name]) =>
            ![
              "get_character_dialogue",
              "get_character_packs",
              "get_character_reaction_events",
              "get_character_pack_attribution",
              "list_memories",
              "count_character_memories",
              "choose_animation_assets",
              "get_pack_story_definition",
              "trial_pack_authoring",
            ].includes(name),
        ),
    ).toEqual([]);
  },
  15000,
);
