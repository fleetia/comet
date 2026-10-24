import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import { OrganizerSettings } from "../components/OrganizerSettings/OrganizerSettings";
import { command } from "../hooks/useSnapshot";
import { PREVIEW_ORGANIZER_STATUS, type OrganizerStatus } from "../organizer/types";
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn().mockResolvedValue(() => undefined) }));

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
afterEach(cleanup);
beforeEach(() =>
  vi
    .mocked(command)
    .mockReset()
    .mockImplementation(async (name) =>
      name === "organizer_status" ? PREVIEW_ORGANIZER_STATUS : undefined,
    ),
);

it("keeps Vault and model saves separate from the automatic organizer draft", async () => {
  const dirty = vi.fn();
  render(<OrganizerSettings onDirtyChange={dirty} />);
  await waitFor(() =>
    expect(screen.getByRole("switch", { name: "유휴 시간에 자동 정리" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  expect(screen.getByRole("switch", { name: "유휴 시간에 자동 정리" })).toHaveProperty(
    "checked",
    false,
  );
  fireEvent.click(screen.getByRole("switch", { name: "유휴 시간에 자동 정리" }));
  fireEvent.click(screen.getByRole("button", { name: "Vault 연결…" }));
  fireEvent.change(screen.getByLabelText("Vault 폴더"), { target: { value: "/my/vault" } });
  fireEvent.click(screen.getByRole("button", { name: "‹ Ex-brain" }));
  fireEvent.click(screen.getByRole("button", { name: "Ex-brain 설정 저장" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("organizer_save_settings", {
      settings: { enabled: true, cometEnabled: false, idleSeconds: 300, dailyRequestLimit: 20 },
    }),
  );
  expect(command).not.toHaveBeenCalledWith("save_settings", expect.anything());
  expect(command).not.toHaveBeenCalledWith("organizer_connect_vault", expect.anything());
  fireEvent.click(screen.getByRole("button", { name: "Vault 연결…" }));
  expect(screen.getByLabelText("Vault 폴더")).toHaveProperty("value", "/my/vault");
  expect(dirty).toHaveBeenLastCalledWith(true);
});

async function openSearch(): Promise<void> {
  await waitFor(() =>
    expect(screen.getByRole("switch", { name: "유휴 시간에 자동 정리" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
}
function submitSearch(value: string): void {
  fireEvent.change(screen.getByLabelText("검색어"), { target: { value } });
  fireEvent.submit(screen.getByLabelText("검색어").closest("form")!);
}
const hit = (title: string) => ({
  source: {
    id: title,
    userId: "preview-user",
    workspaceId: "comet",
    projectId: "",
    kind: "note",
    locator: title,
    title,
    contentHash: "hash",
    active: true,
  },
  recordId: null,
  title,
  excerpt: "발췌",
});

it("searches only the saved scope while preserving dirty settings and rejects blank input", async () => {
  vi.mocked(command).mockImplementation(async (name) =>
    name === "organizer_search_trial"
      ? { context: PREVIEW_ORGANIZER_STATUS.context, hits: [] }
      : PREVIEW_ORGANIZER_STATUS,
  );
  const dirty = vi.fn();
  render(<OrganizerSettings onDirtyChange={dirty} />);
  await openSearch();
  fireEvent.click(screen.getByRole("switch", { name: "유휴 시간에 자동 정리" }));
  submitSearch("  ");
  expect(
    vi.mocked(command).mock.calls.filter(([name]) => name === "organizer_search_trial"),
  ).toHaveLength(0);
  submitSearch("  회의  ");
  const empty = await screen.findByRole("status");
  expect(empty.textContent).toBe(
    "일치하는 자료가 없어요.원문을 고쳤다면 ‘변경 자료 다시 읽기’ 뒤에 찾아보세요.",
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(command).toHaveBeenCalledWith("organizer_search_trial", {
    query: "회의",
    expectedContext: PREVIEW_ORGANIZER_STATUS.context,
  });
  expect(dirty).toHaveBeenLastCalledWith(true);
  expect(command).not.toHaveBeenCalledWith("organizer_save_settings", expect.anything());
});

it("rejects both stale results and errors across query A to B to A", async () => {
  const pending: { resolve: (value: unknown) => void; reject: (cause: Error) => void }[] = [];
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "organizer_search_trial")
      return new Promise((resolve, reject) => pending.push({ resolve, reject }));
    return PREVIEW_ORGANIZER_STATUS;
  });
  render(<OrganizerSettings />);
  await openSearch();
  submitSearch("A");
  submitSearch("B");
  submitSearch("A");
  await act(async () =>
    pending[0].resolve({ context: PREVIEW_ORGANIZER_STATUS.context, hits: [hit("옛 A")] }),
  );
  await act(async () => pending[1].reject(new Error("옛 B 오류")));
  expect(screen.queryByText("옛 A")).toBeNull();
  expect(screen.queryByText("옛 B 오류")).toBeNull();
  await act(async () =>
    pending[2].resolve({ context: PREVIEW_ORGANIZER_STATUS.context, hits: [hit("최신 A")] }),
  );
  expect(screen.getByText("최신 A")).toBeTruthy();
  expect(screen.queryByText(/변경 자료 다시 읽기’ 뒤에/)).toBeNull();
});

it("ignores an old saved-scope result and preserves failed search input for retry", async () => {
  let status: OrganizerStatus = PREVIEW_ORGANIZER_STATUS;
  let finish!: (value: unknown) => void;
  vi.mocked(command).mockImplementation(async (name) =>
    name === "organizer_search_trial"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : status,
  );
  const view = render(<OrganizerSettings />);
  await openSearch();
  submitSearch("자료");
  status = { ...status, context: { ...status.context, revision: 1 } };
  await act(async () =>
    finish({ context: PREVIEW_ORGANIZER_STATUS.context, hits: [hit("해제 전 자료")] }),
  );
  expect(screen.queryByText("해제 전 자료")).toBeNull();
  expect(screen.getByLabelText("검색어")).toHaveProperty("value", "자료");
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "organizer_search_trial") throw new Error("검색 실패");
    return status;
  });
  fireEvent.click(screen.getByRole("button", { name: "검색" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "검색하지 못했어요. 검색 실패",
  );
  expect(screen.queryByText("일치하는 자료가 없어요.")).toBeNull();
  expect(screen.getByLabelText("검색어")).toHaveProperty("value", "자료");
  view.unmount();
});

it("discards results after leaving the search view or unmounting", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(command).mockImplementation(async (name) =>
    name === "organizer_search_trial"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : PREVIEW_ORGANIZER_STATUS,
  );
  const view = render(<OrganizerSettings />);
  await openSearch();
  submitSearch("자료");
  fireEvent.click(screen.getByRole("button", { name: "Vault 연결…" }));
  await waitFor(() => expect(screen.queryByText("검색 중…")).toBeNull());
  await act(async () =>
    finish({ context: PREVIEW_ORGANIZER_STATUS.context, hits: [hit("접힌 뒤 결과")] }),
  );
  expect(screen.queryByText("접힌 뒤 결과")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "‹ Ex-brain" }));
  submitSearch("닫기");
  view.unmount();
  await act(async () =>
    finish({ context: PREVIEW_ORGANIZER_STATUS.context, hits: [hit("닫힌 뒤 결과")] }),
  );
});

it("discards an old search immediately when the active user changes", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(command).mockImplementation(async (name) =>
    name === "organizer_search_trial"
      ? new Promise((resolve) => {
          finish = resolve;
        })
      : PREVIEW_ORGANIZER_STATUS,
  );
  render(<OrganizerSettings />);
  await openSearch();
  submitSearch("이전 사용자");
  const callback = vi.mocked(listen).mock.calls.find(([name]) => name === "app-state")![1];
  act(() => callback({ event: "app-state", id: 1, payload: { user: { id: "different-user" } } }));
  await act(async () =>
    finish({ context: PREVIEW_ORGANIZER_STATUS.context, hits: [hit("이전 사용자 결과")] }),
  );
  expect(screen.queryByText("이전 사용자 결과")).toBeNull();
});

it("keeps a failed connection draft intact and does not enable automatic Vault processing implicitly", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "organizer_connect_vault") throw new Error("접근할 수 없는 폴더예요.");
    return PREVIEW_ORGANIZER_STATUS;
  });
  render(<OrganizerSettings />);
  await waitFor(() =>
    expect(screen.getByRole("switch", { name: "유휴 시간에 자동 정리" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "Vault 연결…" }));
  fireEvent.change(screen.getByLabelText("Vault 폴더"), { target: { value: "/my/vault" } });
  fireEvent.click(screen.getByRole("button", { name: "Vault 연결" }));
  expect(await screen.findByRole("alert")).toHaveProperty(
    "textContent",
    "접근할 수 없는 폴더예요.",
  );
  expect(screen.getByLabelText("Vault 폴더")).toHaveProperty("value", "/my/vault");
  expect(command).toHaveBeenCalledWith("organizer_connect_vault", {
    connection: expect.objectContaining({
      root: "/my/vault",
      automatic: false,
      outputDir: "comet-ex-brain",
      exclude: expect.arrayContaining(["03.diary", "99.deprecated"]),
    }),
  });
});
