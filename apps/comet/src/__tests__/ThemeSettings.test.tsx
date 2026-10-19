import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { ThemeSettings } from "../components/ThemeSettings/ThemeSettings";
import { updateAppearance } from "../hooks/useAppearance";
import { DEFAULT_APPEARANCE } from "../appearance";
import { PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";
import { BALLOON_SPRITE } from "../components/characterIdentity";

beforeEach(() => updateAppearance(DEFAULT_APPEARANCE));
afterEach(cleanup);

function modeOption(name: string): HTMLInputElement {
  return within(screen.getByRole("radiogroup", { name: "화면 모드" })).getByRole("radio", {
    name,
  }) as HTMLInputElement;
}

it("locks the color mode while a single-look skin is chosen and restores it for the night skin", () => {
  render(<ThemeSettings snapshot={PREVIEW_SNAPSHOT} onOpenBalloon={() => {}} />);
  fireEvent.click(modeOption("다크"));
  expect(modeOption("다크").checked).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: /따뜻한 종이/ }));
  expect(screen.getByRole("button", { name: /따뜻한 종이/ }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  expect(modeOption("다크").disabled).toBe(true);
  expect(screen.getByText(/한 가지 모습뿐이라/)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: /밤하늘/ }));
  expect(modeOption("다크").disabled).toBe(false);
  expect(modeOption("다크").checked).toBe(true);
});

it("starts a custom skin from the add tile and edits its colors", () => {
  render(<ThemeSettings snapshot={PREVIEW_SNAPSHOT} onOpenBalloon={() => {}} />);
  expect(screen.queryByRole("textbox", { name: "강조" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /내 스킨/ }));
  expect(screen.getByRole("button", { name: /내 스킨/ }).getAttribute("aria-pressed")).toBe("true");
  for (const label of ["배경", "말풍선", "위젯", "강조"]) {
    expect(screen.getByRole("textbox", { name: label })).toBeTruthy();
  }
});

it("sets each desktop opacity separately and lists which friends keep their own balloon", () => {
  const onOpenBalloon = vi.fn();
  const [first, second] = PREVIEW_SNAPSHOT.characters.installed;
  const snapshot = {
    ...PREVIEW_SNAPSHOT,
    characters: {
      ...PREVIEW_SNAPSHOT.characters,
      active: [first.id, second.id],
      installed: [
        first,
        { ...second, sprites: { ...second.sprites, [BALLOON_SPRITE]: { mime: "image/png", updatedAt: 1 } } },
      ],
    },
  };
  render(<ThemeSettings snapshot={snapshot} onOpenBalloon={onOpenBalloon} />);
  fireEvent.change(screen.getByRole("slider", { name: "말풍선 불투명도" }), {
    target: { value: "60" },
  });
  expect(screen.getByText("60%")).toBeTruthy();
  expect((screen.getByRole("slider", { name: "위젯 불투명도" }) as HTMLInputElement).value).toBe(
    "100",
  );

  const followed = screen.getByRole("button", { name: new RegExp(`${first.definition.name} 말풍선`) });
  expect(followed.textContent).toContain("전체 테마를 따라요");
  const own = screen.getByRole("button", { name: new RegExp(`${second.definition.name} 말풍선`) });
  expect(own.textContent).toContain("따로 꾸몄어요");
  fireEvent.click(own);
  expect(onOpenBalloon).toHaveBeenCalledWith(second.id);
});
