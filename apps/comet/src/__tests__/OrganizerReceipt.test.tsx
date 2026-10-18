import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { OrganizerReceipt } from "../components/Balloon/OrganizerReceipt";
import { command } from "../hooks/useSnapshot";
import type { OrganizerAction } from "../organizer/types";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
afterEach(cleanup);

it("opens stored results and undoes by operation ID without submitting the conversation again", async () => {
  vi.mocked(command)
    .mockReset()
    .mockImplementation(async (name) =>
      name === "organizer_actions"
        ? [
            {
              id: "operation-1",
              inputId: "input-1",
              title: "내일 회의 준비",
              kind: "todo",
              createdAt: 1,
              undone: false,
            },
          ]
        : undefined,
    );
  render(<OrganizerReceipt inputId="input-1" />);
  fireEvent.click(await screen.findByRole("button", { name: "열기" }));
  await waitFor(() => expect(command).toHaveBeenCalledWith("organizer_open_records", undefined));
  fireEvent.click(screen.getByRole("button", { name: "되돌리기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("organizer_undo", { operationId: "operation-1" }),
  );
  expect(screen.getByRole("group", { name: "내일 회의 준비" })).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("되돌림");
  expect(screen.getByRole("button", { name: "되돌리기" })).toHaveProperty("disabled", true);
  expect(command).not.toHaveBeenCalledWith("retry_turn", expect.anything());
});

it("discards the previous input receipt when the active input changes", async () => {
  let previous!: (actions: OrganizerAction[]) => void;
  vi.mocked(command)
    .mockReset()
    .mockImplementation(async (_name, args) =>
      args?.inputId === "old"
        ? new Promise<OrganizerAction[]>((resolve) => {
            previous = resolve;
          })
        : [],
    );
  const view = render(<OrganizerReceipt key="old" inputId="old" />);
  view.rerender(<OrganizerReceipt key="new" inputId="new" />);
  await act(async () =>
    previous([
      {
        id: "old-operation",
        inputId: "old",
        title: "이전 요청 결과",
        kind: "memo",
        createdAt: 1,
        undone: false,
      },
    ]),
  );
  expect(screen.queryByText("이전 요청 결과")).toBeNull();
});

const receipt: OrganizerAction = {
  id: "saved-expense",
  inputId: "message",
  title: "컵라면 · 3,000원",
  kind: "ledger.add",
  targetId: "expense",
  createdAt: 1,
  undone: false,
};

it("explains unsupported undo without sending an undo command", async () => {
  vi.mocked(command)
    .mockReset()
    .mockImplementation(async (name) => {
      if (name === "organizer_actions")
        return [receipt, { ...receipt, id: "timer", title: "집중 시작", undoSupported: false }];
      return undefined;
    });
  render(<OrganizerReceipt inputId="message" />);
  const timer = within(await screen.findByRole("group", { name: "집중 시작" }));
  expect(timer.getByText("이 동작은 되돌릴 수 없어요.")).toBeTruthy();
  fireEvent.click(timer.getByRole("button", { name: "되돌리기" }));
  expect(command).not.toHaveBeenCalledWith("organizer_undo", expect.anything());
});

it("keeps a failed undo visible and retryable without claiming it was undone", async () => {
  vi.mocked(command)
    .mockReset()
    .mockImplementation(async (name) => {
      if (name === "organizer_actions") return [receipt];
      throw new Error("기록이 변경되어 되돌리지 못했어요.");
    });
  render(<OrganizerReceipt inputId="message" />);
  fireEvent.click(await screen.findByRole("button", { name: "되돌리기" }));
  expect((await screen.findByRole("alert")).textContent).toContain("기록이 변경되어");
  expect(screen.getByRole("status").textContent).toBe("완료");
  expect(screen.getByRole("button", { name: "되돌리기" })).toHaveProperty("disabled", false);
});
