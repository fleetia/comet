import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StoryChoices } from "../components/StoryChoices/StoryChoices";
import { Balloon } from "../components/Balloon/Balloon";
import { PREVIEW_SNAPSHOT } from "../previewSnapshot";
import type { StoryRequest } from "../types";

const story: StoryRequest = {
  id: "request-1",
  persona: "a",
  title: "멈춘 질문",
  prompt: "저기… 잠깐 괜찮아요?",
  choices: [
    { id: "listen", label: "천천히 말해도 괜찮아" },
    { id: "rush", label: "답부터 정하면 안 돼?" },
  ],
};
afterEach(cleanup);

it("shows choices in the balloon without a text composer or exposed score", () => {
  render(<Balloon preview snapshot={{ ...PREVIEW_SNAPSHOT, story }} dispatch={vi.fn()} />);
  expect(screen.getByRole("group", { name: "이야기 선택지" })).toBeTruthy();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getByText(story.prompt)).toBeTruthy();
});

it("submits the request and choice once while pending and preserves errors for retry", async () => {
  let reject: (error: Error) => void = () => {};
  const dispatch = vi.fn().mockImplementation(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  render(<StoryChoices story={story} dispatch={dispatch} />);
  const choose = screen.getByRole("button", { name: story.choices[0].label });
  fireEvent.click(choose);
  fireEvent.click(choose);
  expect(dispatch).toHaveBeenCalledExactlyOnceWith("choose_story", {
    requestId: "request-1",
    choiceId: "listen",
  });
  reject(new Error("저장하지 못했어요"));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("저장하지 못했어요"));
  expect(choose.hasAttribute("disabled")).toBe(false);
});

it("defers without submitting an affinity choice", async () => {
  const dispatch = vi.fn().mockResolvedValue(undefined);
  render(<StoryChoices story={story} dispatch={dispatch} />);
  fireEvent.click(screen.getByRole("button", { name: "다음에 듣기" }));
  await waitFor(() =>
    expect(dispatch).toHaveBeenCalledExactlyOnceWith("defer_story", { requestId: "request-1" }),
  );
});
