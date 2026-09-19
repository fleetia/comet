import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TalkEditor } from "../components/TalkEditor";
import { command } from "../hooks/useSnapshot";

vi.mock("../hooks/useSnapshot", () => ({
  command: vi.fn(),
  errorText: (error: unknown) => String(error),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("keeps a failing draft and sends the loaded revision when saving", async () => {
  vi.mocked(command).mockImplementation(async (name) => {
    if (name === "list_talk_files") return ["index.talk", "other.talk"];
    if (name === "read_talk_file")
      return { path: "index.talk", source: "format: 1", revision: "v1" };
    throw "index.talk:2:1 문법 오류";
  });
  render(<TalkEditor onDirtyChange={vi.fn()} onPendingChange={vi.fn()} />);
  const source = await screen.findByRole("textbox", { name: "대본 원문" });
  await waitFor(() => expect((source as HTMLTextAreaElement).value).toBe("format: 1"));
  fireEvent.change(source, { target: { value: "invalid draft" } });
  expect(screen.getByRole("combobox").hasAttribute("disabled")).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "검사하고 저장" }));
  await screen.findByRole("alert");
  expect((source as HTMLTextAreaElement).value).toBe("invalid draft");
  expect(command).toHaveBeenLastCalledWith("save_talk_file", {
    path: "index.talk",
    source: "invalid draft",
    expectedRevision: "v1",
  });
});
