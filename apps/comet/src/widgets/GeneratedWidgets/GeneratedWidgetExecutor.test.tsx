import { beforeEach, expect, it, vi } from "vitest";
import { command } from "../../hooks/useSnapshot";
import { executeGeneratedRequest } from "./GeneratedWidgetExecutor";
import { runWidget } from "./sandbox";

vi.mock("../../hooks/useSnapshot", () => ({ command: vi.fn(), errorText: String }));
vi.mock("./sandbox", () => ({ runWidget: vi.fn() }));

beforeEach(() => {
  vi.mocked(command).mockReset();
  vi.mocked(runWidget).mockReset();
});

it("claims a host nonce once and runs the same isolated reducer with host time and input", async () => {
  const token = "single-host-request";
  const input = {
    source: "function reduce(){}",
    state: { count: 1 },
    action: { type: "add" },
    now: 123,
  };
  const result = { state: { count: 2 }, view: [{ type: "number" as const, value: 2 }] };
  vi.mocked(command).mockResolvedValue(input);
  vi.mocked(runWidget).mockResolvedValue(result);
  await Promise.all([executeGeneratedRequest(token), executeGeneratedRequest(token)]);
  expect(command).toHaveBeenCalledTimes(2);
  expect(command).toHaveBeenNthCalledWith(1, "get_generated_execution", { token });
  expect(runWidget).toHaveBeenCalledExactlyOnceWith(input.source, input.state, input.action, 123);
  expect(command).toHaveBeenLastCalledWith("complete_generated_execution", {
    token,
    result,
    error: null,
  });
});

it("returns sandbox failures without creating another reducer attempt or writing widget state", async () => {
  const token = "timeout-host-request";
  vi.mocked(command).mockResolvedValue({
    source: "code",
    state: {},
    action: { type: "add" },
    now: 123,
  });
  vi.mocked(runWidget).mockRejectedValue(new Error("위젯 실행이 1초 제한을 넘었어요."));
  await executeGeneratedRequest(token);
  expect(runWidget).toHaveBeenCalledTimes(1);
  expect(command).toHaveBeenLastCalledWith("complete_generated_execution", {
    token,
    result: null,
    error: { kind: "interpreterFailure", message: "Error: 위젯 실행이 1초 제한을 넘었어요." },
  });
});

it("does not classify a failed host claim as an interpreter failure", async () => {
  const token = "failed-host-claim";
  vi.mocked(command).mockRejectedValue(new Error("expired request"));
  await executeGeneratedRequest(token);
  expect(runWidget).not.toHaveBeenCalled();
  expect(command).toHaveBeenLastCalledWith("complete_generated_execution", {
    token,
    result: null,
    error: { kind: "hostFailure", message: "Error: expired request" },
  });
});

it("does not retry or report interpreter failure when result delivery fails", async () => {
  const token = "failed-host-delivery";
  const result = { state: {}, view: [] };
  vi.mocked(command)
    .mockResolvedValueOnce({ source: "code", state: {}, action: {}, now: 123 })
    .mockRejectedValueOnce(new Error("cancelled request"));
  vi.mocked(runWidget).mockResolvedValue(result);
  await executeGeneratedRequest(token);
  expect(command).toHaveBeenCalledTimes(2);
  expect(command).toHaveBeenLastCalledWith("complete_generated_execution", {
    token,
    result,
    error: null,
  });
  expect(runWidget).toHaveBeenCalledTimes(1);
});
