import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { OrganizerRecords } from "../Planner/OrganizerRecords";
import { command } from "../../hooks/useSnapshot";
import { PREVIEW_ORGANIZER_STATUS, type OrganizerRecord } from "../../organizer/types";

vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
afterEach(cleanup);

const record: OrganizerRecord = {
  id: "record-1",
  operationId: "operation-1",
  title: "프로젝트 결정",
  markdown: "결정: 다음 주에 검토",
  createdAt: 1,
  outputPath: "/vault/comet-ex-brain/record.md",
  state: "saved",
  source: {
    id: "source-1",
    userId: "user-1",
    workspaceId: "vault-1",
    projectId: "",
    kind: "vault",
    locator: "work/decision.md",
    title: "회의 원문",
    contentHash: "hash",
    active: true,
  },
};

it("opens the saved result of a direct request and avoids duplicating summaries", async () => {
  vi.mocked(command)
    .mockReset()
    .mockImplementation(async (name) => {
      if (name === "organizer_status") return PREVIEW_ORGANIZER_STATUS;
      if (name === "organizer_records") return [record];
      if (name === "organizer_actions")
        return [
          {
            id: "action-1",
            inputId: "input-1",
            kind: "note_create",
            targetId: "note-1",
            title: "저장한 회의 메모",
            createdAt: 1,
            undone: false,
          },
          {
            id: record.id,
            inputId: "input-1",
            kind: "summary",
            targetId: record.source.id,
            title: record.title,
            createdAt: 1,
            undone: false,
          },
        ];
      if (name === "organizer_open_action")
        return {
          source: { ...record.source, title: "저장한 회의 메모" },
          content: "본문: 다음 주 검토하기",
        };
    });
  render(<OrganizerRecords />);
  fireEvent.click(await screen.findByRole("button", { name: "결과 열기" }));
  expect(await screen.findByRole("dialog", { name: "저장한 회의 메모" })).toBeTruthy();
  expect(screen.getByText("본문: 다음 주 검토하기")).toBeTruthy();
  expect(command).toHaveBeenCalledWith("organizer_open_action", { operationId: "action-1" });
  fireEvent.click(screen.getByRole("button", { name: "원문 닫기" }));
  expect(screen.getAllByRole("button", { name: /프로젝트 결정/ })).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: /프로젝트 결정/ }));
  expect(screen.getByRole("heading", { name: "프로젝트 결정" })).toBeTruthy();
  expect(screen.getByText("결정: 다음 주에 검토")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "직접 요청" }));
  expect(screen.queryByRole("button", { name: /프로젝트 결정/ })).toBeNull();
  expect(screen.getByRole("button", { name: "결과 열기" })).toBeTruthy();
});

it("shows the recorded source and preserves a conflicting result when undo fails", async () => {
  vi.mocked(command)
    .mockReset()
    .mockImplementation(async (name) => {
      if (name === "organizer_status") return PREVIEW_ORGANIZER_STATUS;
      if (name === "organizer_records") return [record];
      if (name === "organizer_actions") return [];
      if (name === "organizer_open_source")
        return { source: record.source, content: "원문에 있는 결정 내용" };
      if (name === "organizer_undo") throw new Error("이후 사용자 수정이 있어 되돌릴 수 없어요.");
    });
  render(<OrganizerRecords />);
  fireEvent.click(await screen.findByRole("button", { name: "원문 열기" }));
  expect(await screen.findByRole("dialog", { name: "회의 원문" })).toBeTruthy();
  expect(screen.getByText("원문에 있는 결정 내용")).toBeTruthy();
  expect(command).toHaveBeenCalledWith("organizer_open_source", { sourceId: "source-1" });
  fireEvent.click(screen.getByRole("button", { name: "원문 닫기" }));
  fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("사용자 수정"));
  expect(screen.getByRole("heading", { name: "프로젝트 결정" })).toBeTruthy();
  expect(command).toHaveBeenCalledWith("organizer_undo", { operationId: "operation-1" });
});

it("keeps unsupported undo disabled in the records detail too", async () => {
  vi.mocked(command)
    .mockReset()
    .mockImplementation(async (name) => {
      if (name === "organizer_status") return PREVIEW_ORGANIZER_STATUS;
      if (name === "organizer_records") return [];
      if (name === "organizer_actions")
        return [
          {
            id: "timer-start",
            inputId: "input-1",
            kind: "widget_action",
            title: "집중 시작",
            createdAt: 1,
            undone: false,
            undoSupported: false,
            undoReason: "실행 중인 집중은 위젯에서 멈출 수 있어요.",
          },
        ];
    });
  render(<OrganizerRecords />);
  await screen.findByRole("heading", { name: "집중 시작" });
  const undo = screen.getByRole("button", { name: "되돌리기" });
  expect(undo).toHaveProperty("disabled", true);
  expect(document.getElementById(undo.getAttribute("aria-describedby")!)?.textContent).toBe(
    "실행 중인 집중은 위젯에서 멈출 수 있어요.",
  );
  fireEvent.click(undo);
  expect(command).not.toHaveBeenCalledWith("organizer_undo", expect.anything());
  expect(screen.getByRole("button", { name: "결과 열기" })).toHaveProperty("disabled", false);
});

it("answers an empty search with a way to the Ex-brain settings", async () => {
  vi.mocked(command)
    .mockReset()
    .mockImplementation(async (name) => {
      if (name === "organizer_status") return PREVIEW_ORGANIZER_STATUS;
      if (name === "organizer_records") return [record];
      if (name === "organizer_actions") return [];
      if (name === "organizer_search") return [];
    });
  render(<OrganizerRecords />);
  await screen.findByRole("button", { name: /프로젝트 결정/ });
  fireEvent.change(screen.getByRole("searchbox", { name: "기록·원문 검색" }), {
    target: { value: "없는 말" },
  });
  fireEvent.click(screen.getByRole("button", { name: "검색" }));
  expect(await screen.findByText("일치하는 자료가 없어요.")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Ex-brain 설정 열기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("open_organizer_settings"));
});
