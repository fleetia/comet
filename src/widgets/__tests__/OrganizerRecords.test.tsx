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
  expect(screen.getAllByRole("heading", { name: "프로젝트 결정" })).toHaveLength(1);
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
