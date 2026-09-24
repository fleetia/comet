import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { CompanionBox } from "../components/CompanionBox/CompanionBox";
import { FaceTag } from "../components/FaceTag/FaceTag";
import { Balloon } from "../components/Balloon/Balloon";
import { CharacterEditor } from "../components/CharacterEditor/CharacterEditor";
import { PREVIEW_SNAPSHOT, command, isDesktop } from "../hooks/useSnapshot";
import type { InstalledCharacter, Playback, Snapshot } from "../types";
import { centerSlice } from "../components/characterIdentity";
import * as companion from "../components/companion.css";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string, protocol: string) => `${protocol}://localhost/${path}`,
  invoke: vi.fn(),
  isTauri: () => false,
}));
vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(() => true),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: vi.fn().mockResolvedValue(() => {}),
    startDragging: vi.fn(),
    close: vi.fn(),
  }),
}));
afterEach(cleanup);
beforeEach(() => {
  vi.mocked(command)
    .mockReset()
    .mockImplementation(async (name) =>
      name === "get_character_gesture_settings" ? { doubleClickMs: 500 } : undefined,
    );
  vi.mocked(isDesktop).mockReturnValue(true);
});

const byulkkori: InstalledCharacter = {
  id: "byul",
  packId: null,
  definition: {
    ...PREVIEW_SNAPSHOT.characters.installed[0].definition,
    name: "별꼬리",
    faceIcon: true,
    spriteSize: 128,
    expressions: { 평온: "기본", 기쁨: "기쁨", 슬픔: "슬픔" },
  },
  sprites: {
    평온: { mime: "image/svg+xml", updatedAt: 10 },
    기쁨: { mime: "image/png", updatedAt: 20 },
  },
};
function playing(expression: string, persona: "a" | "b" = "a"): Playback {
  return {
    id: "line",
    persona,
    expression,
    text: "안녕",
    source: "script",
    endsAt: 100,
    lineIndex: 0,
    lineCount: 1,
  };
}
const snapshot: Snapshot = {
  ...PREVIEW_SNAPSHOT,
  characters: {
    installed: [byulkkori, PREVIEW_SNAPSHOT.characters.installed[1]],
    active: ["byul", "builtin-b"],
  },
};
function bodyImage(): HTMLImageElement | null {
  return screen.getByRole("button", { name: "별꼬리 반응" }).querySelector("img");
}

it("shows the sprite for the spoken expression and falls back to the default sprite", () => {
  const { rerender } = render(
    <CompanionBox id="byul" snapshot={{ ...snapshot, playback: playing("기쁨") }} />,
  );
  expect(bodyImage()?.getAttribute("src")).toBe(
    "sprite://localhost/byul?expression=%EA%B8%B0%EC%81%A8&v=20&cors=1",
  );
  expect(screen.queryByText(/^\[/)).toBeNull();
  rerender(<CompanionBox id="byul" snapshot={{ ...snapshot, playback: playing("슬픔") }} />);
  expect(bodyImage()?.getAttribute("src")).toContain("expression=%ED%8F%89%EC%98%A8&v=10");
  rerender(<CompanionBox id="byul" snapshot={{ ...snapshot, playback: playing("화남") }} />);
  expect(bodyImage()?.getAttribute("src")).toContain("expression=%ED%8F%89%EC%98%A8");
  rerender(<CompanionBox id="byul" snapshot={snapshot} />);
  expect(bodyImage()?.getAttribute("alt")).toBe("별꼬리 기본");
});

it("keeps the text face for characters without sprites and outside the desktop app", () => {
  const { rerender } = render(
    <CompanionBox id="builtin-b" snapshot={{ ...snapshot, playback: playing("화남", "b") }} />,
  );
  expect(
    screen
      .getByRole("button", {
        name: `${PREVIEW_SNAPSHOT.characters.installed[1].definition.name} 반응`,
      })
      .querySelector("img"),
  ).toBeNull();
  expect(
    screen.getByText(`[${PREVIEW_SNAPSHOT.characters.installed[1].definition.expressions.평온}]`),
  ).toBeTruthy();
  vi.mocked(isDesktop).mockReturnValue(false);
  rerender(<CompanionBox id="byul" snapshot={{ ...snapshot, playback: playing("기쁨") }} />);
  expect(bodyImage()).toBeNull();
  expect(screen.getByText("[기쁨]")).toBeTruthy();
});

it("returns to the text body when only another expression has an image", () => {
  const partial: Snapshot = {
    ...snapshot,
    characters: {
      ...snapshot.characters,
      installed: [
        { ...byulkkori, sprites: { 기쁨: byulkkori.sprites.기쁨 } },
        snapshot.characters.installed[1],
      ],
    },
  };
  const { rerender } = render(
    <CompanionBox id="byul" snapshot={{ ...partial, playback: playing("기쁨") }} />,
  );
  expect(bodyImage()).toBeTruthy();
  expect(screen.queryByRole("button", { name: "캐릭터 숨기기" })).toBeNull();
  rerender(<CompanionBox id="byul" snapshot={partial} />);
  expect(bodyImage()).toBeNull();
  expect(screen.getByText("[기본]")).toBeTruthy();
  expect(screen.getByRole("button", { name: "캐릭터 숨기기" })).toBeTruthy();
  expect(document.documentElement.className).toBe("");
});

it("sizes the sprite from the character, drops the box controls, and clears the transparent root on unmount", () => {
  render(<CompanionBox id="byul" snapshot={{ ...snapshot, playback: playing("기쁨") }} />);
  expect(bodyImage()?.style.width).toBe("128px");
  expect(bodyImage()?.crossOrigin).toBe("anonymous");
  expect(screen.queryByText("기쁨")).toBeNull();
  expect(screen.queryByRole("button", { name: "캐릭터 숨기기" })).toBeNull();
  expect(document.documentElement.className).not.toBe("");
  cleanup();
  expect(document.documentElement.className).toBe("");
});

it("shows the detached expression tag with the same fallback rules and opens the menu on click", async () => {
  vi.mocked(command).mockResolvedValue(undefined);
  const { rerender } = render(
    <FaceTag id="byul" snapshot={{ ...snapshot, playback: playing("기쁨") }} />,
  );
  expect(screen.getByRole("button", { name: "별꼬리 표정" }).textContent).toBe("기쁨");
  rerender(<FaceTag id="byul" snapshot={{ ...snapshot, playback: playing("화남") }} />);
  expect(screen.getByRole("button", { name: "별꼬리 표정" }).textContent).toBe("기본");
  rerender(<FaceTag id="byul" snapshot={{ ...snapshot, playback: playing("기쁨", "b") }} />);
  expect(screen.getByRole("button", { name: "별꼬리 표정" }).textContent).toBe("기본");
  fireEvent.click(screen.getByRole("button", { name: "별꼬리 표정" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_panel", { persona: "byul", mode: "menu" }),
  );
});

it("cuts a nine-slice that keeps exactly the centre pixel stretchable", () => {
  expect(centerSlice(9, 7)).toEqual({ top: 3, right: 4, bottom: 3, left: 4 });
  expect(centerSlice(8, 8)).toEqual({ top: 3, right: 4, bottom: 4, left: 3 });
  expect(centerSlice(1, 1)).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
});

it("skins the balloon with the speaker's balloon image once its size is known", async () => {
  class FakeImage {
    naturalWidth = 9;
    naturalHeight = 7;
    onload: (() => void) | null = null;
    set src(_value: string) {
      finishLoading = () => this.onload?.();
    }
  }
  let finishLoading: (() => void) | undefined;
  vi.stubGlobal("Image", FakeImage);
  try {
    const skinned: InstalledCharacter = {
      ...byulkkori,
      sprites: { ...byulkkori.sprites, $balloon: { mime: "image/png", updatedAt: 5 } },
    };
    const { rerender } = render(
      <Balloon
        snapshot={{
          ...snapshot,
          characters: {
            ...snapshot.characters,
            installed: [skinned, snapshot.characters.installed[1]],
          },
          playback: playing("기쁨"),
        }}
      />,
    );
    const balloon = screen.getByLabelText("말풍선");
    expect(balloon.classList.contains(companion.balloonSkinned)).toBe(true);
    expect(document.documentElement.classList.contains(companion.transparentDocument)).toBe(true);
    finishLoading?.();
    await waitFor(() => expect(balloon.style.borderImageSlice).toBe("3 4 3 4 fill"));
    expect([balloon.style.borderTopWidth, balloon.style.borderRightWidth]).toEqual(["3px", "4px"]);
    expect(balloon.style.borderImageSource).toContain("expression=%24balloon&v=5");
    rerender(<Balloon snapshot={{ ...snapshot, playback: playing("평온", "b") }} />);
    expect(screen.getByLabelText("말풍선").style.borderImageSource).toBe("");
    expect(screen.getByLabelText("말풍선").classList.contains(companion.balloonSkinned)).toBe(
      false,
    );
  } finally {
    vi.unstubAllGlobals();
  }
});

it("removes the whole speech header for image and text characters while keeping close and panel controls", async () => {
  const dispatch = vi.fn().mockResolvedValue(undefined);
  const { rerender } = render(
    <Balloon dispatch={dispatch} snapshot={{ ...snapshot, playback: playing("기쁨") }} />,
  );
  expect(screen.queryByText("별꼬리")).toBeNull();
  expect(screen.getByLabelText("말풍선").querySelector("header")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "이야기 닫기" }));
  await waitFor(() => expect(dispatch).toHaveBeenCalledWith("skip_talk", undefined));
  rerender(<Balloon snapshot={{ ...snapshot, playback: playing("평온", "b") }} />);
  expect(screen.queryByText(PREVIEW_SNAPSHOT.characters.installed[1].definition.name)).toBeNull();
  expect(screen.getByLabelText("말풍선").querySelector("header")).toBeNull();
  rerender(
    <Balloon
      snapshot={{ ...snapshot, playback: playing("기쁨"), panel: { persona: "a", mode: "menu" } }}
    />,
  );
  expect(screen.getByText("무엇을 할까?")).toBeTruthy();
  expect(screen.getByRole("button", { name: "패널 닫기" })).toBeTruthy();
});

it("uses each speaker's saved typography for speech and story prompts and restores legacy defaults", () => {
  const styled: Snapshot = {
    ...snapshot,
    characters: {
      ...snapshot.characters,
      installed: snapshot.characters.installed.map((character, index) => ({
        ...character,
        definition: {
          ...character.definition,
          balloonStyle:
            index === 0
              ? { fontSize: 28, fontFamily: "Apple SD Gothic Neo", textColor: "#125678" }
              : { fontSize: 14, fontFamily: "Georgia", textColor: "#993366" },
        },
      })),
    },
    playback: { ...playing("평온"), text: " 첫 줄\n\n둘째 줄 " },
  };
  const { rerender } = render(<Balloon snapshot={styled} />);
  const speech = screen
    .getByLabelText("말풍선")
    .querySelector<HTMLElement>('[aria-live="polite"]')!;
  expect(speech.textContent).toBe(" 첫 줄\n\n둘째 줄 ");
  expect(speech.style.fontSize).toBe("28px");
  expect(speech.style.color).toBe("rgb(18, 86, 120)");
  expect(speech.style.fontFamily).toContain('"Apple SD Gothic Neo"');
  rerender(<Balloon snapshot={{ ...styled, playback: playing("평온", "b") }} />);
  expect(speech.style.fontSize).toBe("14px");
  expect(speech.style.color).toBe("rgb(153, 51, 102)");
  expect(speech.style.fontFamily).toContain('"Georgia"');
  rerender(<Balloon snapshot={{ ...snapshot, playback: playing("평온") }} />);
  expect(speech.style.fontSize).toBe("19px");
  expect(speech.style.color).toBe("");
  expect(speech.style.fontFamily).toBe("");
  rerender(
    <Balloon
      snapshot={{
        ...styled,
        story: { id: "story", persona: "b", title: "이야기", prompt: "이야기 원문", choices: [] },
      }}
    />,
  );
  expect(screen.getByText("이야기 원문").style.fontSize).toBe("14px");
  expect(screen.getByText("이야기 원문").style.fontFamily).toContain('"Georgia"');
});

it("adds and removes expressions, protects the default one, and gates images on a saved character", () => {
  const onChange = vi.fn();
  const onSprite = vi.fn();
  const { rerender } = render(
    <CharacterEditor
      definition={byulkkori.definition}
      onChange={onChange}
      onSave={() => {}}
      onSprite={onSprite}
      pending={false}
      dirty={false}
    />,
  );
  fireEvent.click(screen.getByRole("tab", { name: "모습·표정" }));
  expect(screen.queryByRole("button", { name: "평온 표정 삭제" })).toBeNull();
  expect(screen.getByText("캐릭터를 먼저 저장하면 표정마다 이미지를 넣을 수 있어요.")).toBeTruthy();
  for (const button of screen.getAllByRole("button", { name: /^(?!말풍선).* 이미지 선택$/ })) {
    expect(button).toHaveProperty("disabled", true);
  }
  fireEvent.change(screen.getByLabelText("새 표정 이름"), { target: { value: " 화남 " } });
  fireEvent.click(screen.getByRole("button", { name: "표정 추가" }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({
      expressions: { 평온: "기본", 기쁨: "기쁨", 슬픔: "슬픔", 화남: "화남" },
      faceIcon: true,
    }),
  );
  fireEvent.click(screen.getByRole("button", { name: "슬픔 표정 삭제" }));
  expect(onChange).toHaveBeenLastCalledWith(
    expect.objectContaining({ expressions: { 평온: "기본", 기쁨: "기쁨" } }),
  );
  fireEvent.click(screen.getByLabelText("텍스트 표정을 따로 움직이는 창으로 표시"));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ faceIcon: false }));
  fireEvent.change(screen.getByLabelText("이미지 크기(px)"), { target: { value: "192" } });
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ spriteSize: 192 }));
  rerender(
    <CharacterEditor
      definition={byulkkori.definition}
      character={byulkkori}
      onChange={onChange}
      onSave={() => {}}
      onSprite={onSprite}
      pending={false}
      dirty={false}
    />,
  );
  const joy = screen.getByLabelText("기쁨 이미지");
  expect(within(joy).getByRole("img").getAttribute("src")).toContain(
    "expression=%EA%B8%B0%EC%81%A8",
  );
  expect(screen.getByLabelText("슬픔 이미지").textContent).toBe("—");
  expect(screen.getAllByRole("button", { name: /^(?!말풍선).* 이미지 제거$/ })).toHaveLength(2);
  fireEvent.click(screen.getAllByRole("button", { name: /^(?!말풍선).* 이미지 선택$/ })[2]);
  expect(onSprite).toHaveBeenLastCalledWith("슬픔", false);
  fireEvent.click(screen.getAllByRole("button", { name: /^(?!말풍선).* 이미지 제거$/ })[1]);
  expect(onSprite).toHaveBeenLastCalledWith("기쁨", true);
  fireEvent.click(screen.getByRole("tab", { name: "말풍선" }));
  expect(screen.getByLabelText("말풍선 이미지").textContent).toBe("기본");
  fireEvent.click(screen.getByRole("button", { name: "말풍선 이미지 선택" }));
  expect(onSprite).toHaveBeenLastCalledWith("$balloon", false);
  expect(screen.queryByRole("button", { name: "말풍선 이미지 제거" })).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "대사·반응" }));
  fireEvent.click(screen.getByRole("button", { name: "인사 편집" }));
  expect(screen.getByLabelText("인사 1 표정")).toBeTruthy();
});
