import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

it.each(["scene-choice:1", "scene-resume:1"])(
  "shows only the supplied choices for %s",
  (id) => {
    render(<StoryChoices story={{ ...story, id }} dispatch={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "다음에 듣기" })).toBeNull();
    for (const choice of story.choices) {
      expect(screen.getByRole("button", { name: choice.label })).toBeTruthy();
    }
  },
);

it.each([2, 4])(
  "keeps %i choices and their long original text keyboard accessible",
  async (count) => {
    const user = userEvent.setup();
    const dispatch = vi.fn().mockResolvedValue(undefined);
    const original = {
      ...story,
      title: "  원래  제목\n다음 줄 ",
      prompt: "  오래된  질문\n그대로 이어지는 원문 ",
      choices: Array.from({ length: count }, (_, index) => ({
        id: `choice-${index}`,
        label: `선택 ${index}  ${"긴 한국어 원문을 그대로 유지해 주세요. ".repeat(5)}\n마지막 줄 `,
      })),
    };
    render(<StoryChoices story={original} dispatch={dispatch} />);
    expect(screen.getByRole("group", { name: /원래 제목\s+다음 줄/ })).toBeTruthy();
    expect(screen.getByText(/오래된/).textContent).toBe(original.prompt);
    const choices = within(screen.getByRole("group", { name: "이야기 선택지" })).getAllByRole(
      "button",
    );
    expect(choices).toHaveLength(count);
    choices.forEach((choice, index) =>
      expect(choice.textContent).toBe(original.choices[index].label),
    );
    for (let index = 0; index < count; index += 1) await user.tab();
    expect(document.activeElement).toBe(choices[count - 1]);
    await user.keyboard("{Enter}");
    expect(dispatch).toHaveBeenCalledExactlyOnceWith("choose_story", {
      requestId: story.id,
      choiceId: `choice-${count - 1}`,
    });
  },
);

it("can close a pending choice and ignores its late failure after the story is replaced", async () => {
  let reject!: (cause: Error) => void;
  const dispatch = vi.fn().mockImplementation((command) =>
    command === "choose_story"
      ? new Promise<void>((_, fail) => {
          reject = fail;
        })
      : Promise.resolve(),
  );
  const { rerender } = render(
    <Balloon preview snapshot={{ ...PREVIEW_SNAPSHOT, story }} dispatch={dispatch} />,
  );
  fireEvent.click(screen.getByRole("button", { name: story.choices[0].label }));
  expect(screen.getByRole("status").textContent).toBe("이야기를 이어가고 있어요.");
  fireEvent.click(screen.getByRole("button", { name: "이야기 닫기" }));
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith("skip_talk", undefined));
  rerender(
    <Balloon
      preview
      snapshot={{ ...PREVIEW_SNAPSHOT, story: { ...story, id: "request-2" } }}
      dispatch={dispatch}
    />,
  );
  await act(async () => reject(new Error("예전 선택의 늦은 오류")));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(
    (screen.getByRole("button", { name: story.choices[0].label }) as HTMLButtonElement).disabled,
  ).toBe(false);
  fireEvent.keyDown(window, { key: "Escape" });
  await waitFor(() =>
    expect(dispatch.mock.calls.filter(([name]) => name === "skip_talk")).toHaveLength(2),
  );
});

it("keeps an explicit pack text style on the story prompt", () => {
  render(
    <StoryChoices
      story={story}
      dispatch={vi.fn()}
      textStyle={{ fontFamily: "serif", fontSize: 23, fontWeight: 700, color: "rgb(12, 34, 56)" }}
    />,
  );
  const prompt = screen.getByText(story.prompt);
  expect(prompt.style.fontSize).toBe("23px");
  expect(prompt.style.fontFamily).toBe("serif");
  expect(prompt.style.fontWeight).toBe("700");
  expect(prompt.style.color).toBe("rgb(12, 34, 56)");
});
