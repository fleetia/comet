import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemorySearchSettings } from "../components/MemorySettings/MemorySearchSettings";
import { MemorySettings } from "../components/MemorySettings/MemorySettings";
import { command } from "../hooks/useSnapshot";
import type { MemorySearchStatus, MemoryPage } from "../types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
afterEach(cleanup);
const identity = {
  characterId: "builtin-a",
  userId: "person",
  userName: "민수",
  kind: "user_fact" as const,
  sourceText: "원문",
  sourceCreatedAt: 1,
  retiredAt: null,
  recallWeight: 1,
};
const model = {
  installed: true,
  enabled: true,
  state: "ready",
  downloadedBytes: 10,
  totalBytes: 10,
  error: null,
  profile: "test",
};
const status: MemorySearchStatus = {
  nlp: {
    settings: { kiwiEnabled: true, semanticEnabled: false },
    kiwi: model,
    semantic: { ...model, installed: false, enabled: false, state: "missing" },
    running: false,
    busy: false,
    activeMethods: ["fts", "kiwi"],
  },
  analysis: { pending: 2, deferred: 1, legacyUnverified: 0 },
  index: { kiwiPending: 3, semanticPending: 0 },
};
beforeEach(() =>
  vi
    .mocked(command)
    .mockReset()
    .mockImplementation(async (name) => (name === "get_nlp_status" ? status : undefined)),
);

it("saves search flags independently and only removes a model after confirmation", async () => {
  render(<MemorySearchSettings />);
  fireEvent.click(await screen.findByLabelText("한국어 분석 사용"));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("set_memory_search_settings", {
      settings: { kiwiEnabled: false, semanticEnabled: false },
    }),
  );
  expect(vi.mocked(command).mock.calls.some(([name]) => name === "save_settings")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "한국어 분석 제거" }));
  expect(vi.mocked(command).mock.calls.some(([name]) => name === "remove_nlp_model")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "한국어 분석 제거 확인" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("remove_nlp_model", { model: "kiwi" }));
});

it("allows cancelling an active model download while its request is still pending", async () => {
  let release!: () => void;
  let downloading = false;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_nlp_status")
      return {
        ...status,
        nlp: {
          ...status.nlp,
          semantic: { ...status.nlp.semantic, state: downloading ? "downloading" : "missing" },
        },
      };
    if (name === "download_nlp_model") {
      downloading = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
  });
  render(<MemorySearchSettings />);
  fireEvent.click(await screen.findByRole("button", { name: "의미 검색 내려받기" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "의미 검색 다운로드 중단" }, { timeout: 3500 }),
  );
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("cancel_nlp_download", { model: "semantic" }),
  );
  release();
});

it("loads only one page, keeps a draft during revisions, and blocks paging until it is resolved", async () => {
  const first: MemoryPage = {
    items: [
      { ...identity, id: "first", content: "첫 기억", sourceMessageId: "source", updatedAt: 1 },
    ],
    total: 51,
    offset: 0,
    nextOffset: 50,
    revision: 1,
  };
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name === "get_nlp_status") return status;
    if (name === "list_memories")
      return args?.offset === 50
        ? {
            ...first,
            offset: 50,
            nextOffset: null,
            items: [{ ...first.items[0], id: "last", content: "마지막 기억" }],
          }
        : first;
  });
  const { rerender } = render(
    <MemorySettings characterId="builtin-a" memoryCount={51} memoryRevision={1} />,
  );
  fireEvent.change(await screen.findByLabelText("기억 내용"), { target: { value: "수정 중" } });
  expect(screen.getByRole("button", { name: "다음 기억" })).toHaveProperty("disabled", true);
  rerender(<MemorySettings characterId="builtin-a" memoryCount={51} memoryRevision={2} />);
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "변경 취소" }).closest("fieldset")).toHaveProperty(
      "disabled",
      false,
    ),
  );
  expect(screen.getByLabelText("기억 내용")).toHaveProperty("value", "수정 중");
  fireEvent.click(screen.getByRole("button", { name: "변경 취소" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "다음 기억" })).toHaveProperty("disabled", false),
  );
  fireEvent.click(screen.getByRole("button", { name: "다음 기억" }));
  await screen.findByRole("button", { name: "마지막 기억" });
  expect(command).toHaveBeenCalledWith("list_memories", {
    characterId: "builtin-a",
    offset: 50,
    limit: 50,
  });
});

it("pins an edited page when new memories would move the draft onto the next page", async () => {
  const items = Array.from({ length: 50 }, (_, index) => ({
    id: `memory-${index}`,
    content: `기억 ${index}`,
    sourceMessageId: `source-${index}`,
    updatedAt: 100 - index,
  }));
  let shifted = false;
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "get_nlp_status") return status;
    if (name === "list_memories")
      return {
        items: shifted
          ? [{ ...items[0], id: "new", content: "새 기억" }, ...items.slice(0, 49)]
          : items,
        total: shifted ? 51 : 50,
        offset: 0,
        nextOffset: shifted ? 50 : null,
        revision: shifted ? 2 : 1,
      };
  });
  const { rerender } = render(
    <MemorySettings characterId="builtin-a" memoryCount={50} memoryRevision={1} />,
  );
  fireEvent.click(await screen.findByRole("button", { name: "기억 49" }));
  fireEvent.change(screen.getByLabelText("기억 내용"), {
    target: { value: "페이지 밖으로 밀리면 안 되는 초안" },
  });
  shifted = true;
  rerender(<MemorySettings characterId="builtin-a" memoryCount={51} memoryRevision={2} />);
  expect(screen.getByLabelText("기억 내용")).toHaveProperty(
    "value",
    "페이지 밖으로 밀리면 안 되는 초안",
  );
  expect(vi.mocked(command).mock.calls.filter(([name]) => name === "list_memories")).toHaveLength(
    1,
  );
  fireEvent.click(screen.getByRole("button", { name: "변경 취소" }));
  await screen.findByRole("button", { name: "새 기억" });
});
