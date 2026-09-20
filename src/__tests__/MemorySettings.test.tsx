import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemorySettings } from "../components/MemorySettings/MemorySettings";
import { command } from "../hooks/useSnapshot";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
}));
afterEach(cleanup);
beforeEach(() => vi.mocked(command).mockReset().mockResolvedValue(undefined));
const memories = [
  { id: "one", content: "첫 기억", sourceMessageId: "message-one", updatedAt: 1 },
  { id: "two", content: "둘째 기억", sourceMessageId: "message-two", updatedAt: 2 },
];

it("keeps drafts by memory ID across selection and snapshots, and cancels only the selected memory", () => {
  const onDirtyChange = vi.fn();
  const { rerender } = render(<MemorySettings memories={memories} onDirtyChange={onDirtyChange} />);
  fireEvent.change(screen.getByLabelText("기억 내용"), { target: { value: "첫 초안" } });
  fireEvent.click(screen.getByRole("button", { name: "둘째 기억" }));
  const latest = memories.map((memory) => ({ ...memory, content: `${memory.content} 최신` }));
  rerender(<MemorySettings memories={latest} onDirtyChange={onDirtyChange} />);
  expect(screen.getByLabelText("기억 내용")).toHaveProperty("value", "둘째 기억 최신");
  fireEvent.change(screen.getByLabelText("기억 내용"), { target: { value: "둘째 초안" } });
  fireEvent.click(screen.getByRole("button", { name: "첫 기억 최신 · 미저장" }));
  expect(screen.getByLabelText("기억 내용")).toHaveProperty("value", "첫 초안");
  fireEvent.click(screen.getByRole("button", { name: "변경 취소" }));
  expect(screen.getByLabelText("기억 내용")).toHaveProperty("value", "첫 기억 최신");
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "둘째 기억 최신 · 미저장" }));
  expect(screen.getByLabelText("기억 내용")).toHaveProperty("value", "둘째 초안");
  fireEvent.click(screen.getByRole("button", { name: "변경 취소" }));
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  expect(command).not.toHaveBeenCalled();
});

it("keeps a draft after deletion fails and removes it only after a successful retry", async () => {
  const onDirtyChange = vi.fn();
  vi.mocked(command).mockRejectedValueOnce(new Error("삭제 실패"));
  render(<MemorySettings memories={memories} onDirtyChange={onDirtyChange} />);
  fireEvent.change(screen.getByLabelText("기억 내용"), {
    target: { value: "아직 저장하지 않은 기억" },
  });
  fireEvent.click(screen.getByRole("button", { name: "이 기억 지우기" }));
  fireEvent.click(screen.getByRole("button", { name: "기억 삭제 확인" }));
  await screen.findByRole("alert");
  expect(command).toHaveBeenLastCalledWith("delete_memory", { id: "one" });
  expect(screen.getByLabelText("기억 내용")).toHaveProperty("value", "아직 저장하지 않은 기억");
  expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  fireEvent.click(screen.getByRole("button", { name: "기억 삭제 확인" }));
  await waitFor(() => expect(screen.queryByRole("button", { name: /첫 기억/ })).toBeNull());
  expect(screen.getByLabelText("기억 내용")).toHaveProperty("value", "둘째 기억");
  expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  expect(command).toHaveBeenCalledTimes(2);
});
