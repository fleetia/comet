import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DesktopPreview } from "../components/DesktopPreview/DesktopPreview";
import { PREVIEW_SNAPSHOT } from "../previewSnapshot";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  isDesktop: () => false,
}));
afterEach(cleanup);

it("previews click reply, a saved draft, continued input, and ended conversation history", async () => {
  render(<DesktopPreview initial={PREVIEW_SNAPSHOT} />);
  fireEvent.click(screen.getByRole("button", { name: /에게 답장:/ }));
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  expect(screen.getByText("왔네. 오늘도 여기서 같이 지내자.")).toBeTruthy();
  fireEvent.change(input, { target: { value: "미리보기에서 쓰던 말" } });
  fireEvent.click(screen.getByRole("button", { name: "대화 접어 두기" }));
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "메뉴 열어 보기" }));
  fireEvent.click(await screen.findByRole("button", { name: "이어하기" }));
  expect(screen.getByRole("textbox")).toHaveProperty("value", "미리보기에서 쓰던 말");
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
  expect(await screen.findByText("응, 듣고 있어. 더 이야기해 줘.")).toBeTruthy();
  await waitFor(() => expect(screen.getByRole("textbox")).toHaveProperty("value", ""));
  fireEvent.click(screen.getByRole("button", { name: "대화 끝내기" }));
  await waitFor(() => expect(screen.queryByRole("textbox")).toBeNull());
  fireEvent.click(screen.getByRole("button", { name: "메뉴 열어 보기" }));
  fireEvent.click(screen.getByRole("button", { name: "지난 대화" }));
  fireEvent.click(await screen.findByRole("button", { name: /미리보기에서 쓰던 말.*마침/ }));
  expect(await screen.findByText("미리보기에서 쓰던 말")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "이어서 말하기" }));
  expect(screen.getByRole("textbox")).toHaveProperty("value", "");
  expect(screen.queryByRole("alert")).toBeNull();
});
