import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ChoiceButton, ChoiceTile, ColorSwatch } from "./Choices";
import { SkinScene } from "./SkinScene";
afterEach(cleanup);
it("choice tiles retain controlled selection and native keyboard activation", async () => {
  const action = vi.fn();
  render(<ChoiceTile label="별꼬리" graphic={<span>미리보기</span>} selected onClick={action} />);
  const button = screen.getByRole("button", { name: "별꼬리" });
  expect(button.getAttribute("aria-pressed")).toBe("true");
  const user = userEvent.setup();
  await user.tab();
  await user.keyboard("{Enter}");
  expect(action).toHaveBeenCalledOnce();
  expect(button.getAttribute("aria-pressed")).toBe("true");
});
it("icon-only choices remain named and disabled choices stay inert", async () => {
  const action = vi.fn();
  render(
    <>
      <ChoiceTile label="사각형" kind="element" graphic={<span>그림</span>} hideLabel />
      <ColorSwatch label="민트" color="#77d9ca" disabled onClick={action} />
      <ChoiceButton kind="weekday" disabled onClick={action}>
        월
      </ChoiceButton>
    </>,
  );
  expect(screen.getByRole("button", { name: "사각형" })).toBeTruthy();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "민트" }));
  await user.click(screen.getByRole("button", { name: "월" }));
  expect(action).not.toHaveBeenCalled();
});
it("respects explicit submit types and defaults other choices to buttons", async () => {
  const submit = vi.fn((event: React.FormEvent) => {
    event.preventDefault();
  });
  render(
    <form onSubmit={submit}>
      <ChoiceTile label="캐릭터" graphic={null} />
      <ChoiceButton>선택</ChoiceButton>
      <ColorSwatch label="민트" color="#77d9ca" type="submit" />
    </form>,
  );
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "캐릭터" }));
  await user.click(screen.getByRole("button", { name: "선택" }));
  expect(submit).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "민트" }));
  expect(submit).toHaveBeenCalledOnce();
});
it("skin scenes render the requested theme with token overrides and stay out of the accessible name", () => {
  render(
    <ChoiceTile
      kind="theme"
      label="내 스킨"
      graphic={
        <SkinScene theme="light" style={{ ["--comet-color-sky" as string]: "rgb(1 2 3)" }} />
      }
    />,
  );
  const button = screen.getByRole("button", { name: "내 스킨" });
  const scene = button.querySelector("[data-comet-theme]") as HTMLElement;
  expect(scene.dataset.cometTheme).toBe("light");
  expect(scene.style.getPropertyValue("--comet-color-sky")).toBe("rgb(1 2 3)");
});
