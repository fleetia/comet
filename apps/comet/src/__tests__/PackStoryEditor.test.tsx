import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import {
  PackStoryEditor,
  type PackStoryDraft,
} from "../components/CharacterEditor/PackStoryEditor";
import { command, PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";
import type {
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
}: {
  packId: string;
  visible?: boolean;
  actors?: InstalledCharacter[];
}) {
  const [drafts, setDrafts] = useState<Record<string, PackStoryDraft>>({});
  const [, setPending] = useState(false);
  return (
    <PackStoryEditor
      packId={packId}
      visible={visible}
      installed={actors}
      drafts={drafts}
      onDraftsChange={setDrafts}
      onPendingChange={setPending}
      characterDirty={false}
    />
  );
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

it("requires a saved character to open the story editor", () => {
  render(<PackStoryEditor packId={null} visible installed={installed} drafts={{}} onDraftsChange={() => {}} onPendingChange={() => {}} characterDirty={false} />);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: /장면 편집기에서 이야기 만들기/ }).disabled).toBe(true);
  expect(screen.getByText(/캐릭터를 저장한 뒤/)).toBeTruthy();
  expect(command).not.toHaveBeenCalledWith("open_story_editor", expect.anything());
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

it("opens the story editor from the story entry and shows the saved count", async () => {
  render(<Harness packId="a" />);
  expect(await screen.findByText("이야기 1개")).toBeTruthy();
  expect(screen.getByText("장을 잇고 대사를 써요 · 별도 창에서 열려요")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /장면 편집기에서 이야기 만들기/ }));
  expect(command).toHaveBeenCalledWith("open_story_editor", { packId: "a", scenarioId: "" });
});

it("keeps every story when saving shared settings", async () => {
  const saved = snapshot("a");
  saved.definition.scenarios.push({ ...saved.definition.scenarios[0], id: "second" });
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
  fireEvent.change(await screen.findByLabelText("세계와 공통 규칙"), {
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
  fireEvent.click(screen.getByRole("button", { name: "팩 이야기 저장" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("save_pack_story_definition", {
    packId: "a",
    expectedBaseline: "1",
    definition: {
      ...saved.definition,
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
    },
  }));
  expect(await screen.findByText("팩의 이야기와 지식을 저장했어요.")).toBeTruthy();
  expect(screen.getByRole("button", { name: "팩 이야기 저장" })).toHaveProperty("disabled", true);
});

it("preserves the shared draft and story on a conflicting save", async () => {
  const saved = snapshot("a");
  render(<Harness packId="a" />);
  const world = await screen.findByLabelText("세계와 공통 규칙");
  fireEvent.change(world, { target: { value: "초안 규칙" } });
  vi.mocked(command).mockRejectedValueOnce(new Error("저장 충돌"));
  fireEvent.click(screen.getByRole("button", { name: "팩 이야기 저장" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "저장 충돌");
  expect(world).toHaveProperty("value", "초안 규칙");
  expect(command).toHaveBeenLastCalledWith("save_pack_story_definition", {
    packId: "a",
    expectedBaseline: "1",
    definition: { ...saved.definition, worldRules: "초안 규칙" },
  });
  vi.mocked(command).mockResolvedValueOnce({
    ...saved,
    baseline: "2",
    definition: { ...saved.definition, worldRules: "초안 규칙" },
  });
  fireEvent.click(screen.getByRole("button", { name: "팩 이야기 저장" }));
  expect(await screen.findByText("팩의 이야기와 지식을 저장했어요.")).toBeTruthy();
  fireEvent.change(world, { target: { value: "미저장" } });
  fireEvent.click(screen.getByRole("button", { name: "팩 이야기 수정 취소" }));
  expect(screen.getByLabelText("세계와 공통 규칙")).toHaveProperty("value", "초안 규칙");
});

it("keeps tutorial chapters and steps when saving shared settings", async () => {
  const saved = snapshot("a");
  saved.definition.scenarios[0] = {
    ...saved.definition.scenarios[0],
    purpose: "tutorial",
    chapters: [{
      id: "first",
      title: "첫 만남",
      steps: [{ kind: "line", persona: "a-source-0", expression: "평온", text: "안녕" }],
    }],
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
  fireEvent.change(await screen.findByLabelText("세계와 공통 규칙"), {
    target: { value: "수정한 세계" },
  });
  fireEvent.click(screen.getByRole("button", { name: "팩 이야기 저장" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("save_pack_story_definition", {
    packId: "a",
    definition: { ...saved.definition, worldRules: "수정한 세계" },
    expectedBaseline: "1",
  }));
});
