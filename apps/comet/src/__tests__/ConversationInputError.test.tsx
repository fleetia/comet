import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Balloon } from "../components/Balloon/Balloon";
import { inputErrorMessage } from "../components/Balloon/conversationSurface.css";
import { PREVIEW_SNAPSHOT } from "../hooks/useSnapshot";

vi.mock("../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../hooks/useSnapshot")>()),
  command: vi.fn().mockResolvedValue(undefined),
  isDesktop: () => false,
}));

afterEach(cleanup);

const error = "로컬 실행기가 종료되었습니다. 모델·GPU·메모리와 실행기 버전을 확인해 주세요.";

it("shows the desktop alert as red text under the composer, not a boxed panel", async () => {
  const { readFileSync } = await vi.importActual<{
    readFileSync(path: string, encoding: "utf8"): string;
  }>("node:fs");
  const source = readFileSync("src/components/Balloon/conversationSurface.css.ts", "utf8");
  const errorStyle = source.match(/export const inputError = style\(\{([\s\S]*?)\}\);/)?.[1] ?? "";
  expect(errorStyle).toContain('color: tokens["color/danger"]');
  expect(errorStyle).toContain('overflowWrap: "anywhere"');
  expect(errorStyle).not.toMatch(/\b(?:background|border|height|maxHeight|overflow|opacity)\s*:/);
});

it.each([error, `${error} ${"긴오류".repeat(120)}`])(
  "keeps the full error in the alert and removes it after recovery: %s",
  (message) => {
    const snapshot = {
      ...PREVIEW_SNAPSHOT,
      panel: { persona: "builtin-a", mode: "input" as const },
    };
    const { rerender } = render(
      <Balloon
        snapshot={{ ...snapshot, runtime: { ...snapshot.runtime, error: message } }}
        surface="input"
        preview
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(message);
    expect(alert.className).toBe(inputErrorMessage);
    expect(screen.getByRole("textbox")).toBeTruthy();
    rerender(<Balloon snapshot={snapshot} surface="input" preview />);
    expect(screen.queryByRole("alert")).toBeNull();
  },
);
