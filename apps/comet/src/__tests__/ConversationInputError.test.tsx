import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Balloon } from "../components/Balloon/Balloon";
import { inputError, inputErrorMessage } from "../components/Balloon/conversationSurface.css";
import { conversationMeta } from "../components/companion.css";
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

it.each([
  ["cancelled", "취소됨", "이 기기의 모델을 아직 내려받지 않았어요."],
  ["error", "모델 내려받기 서버(Hugging Face)에 연결할 수 없어요.", "모델 내려받기 서버(Hugging Face)에 연결할 수 없어요."],
])("uses only failed downloads to replace the readiness error: %s", (status, downloadError, expected) => {
  const snapshot = {
    ...PREVIEW_SNAPSHOT,
    panel: { persona: "builtin-a", mode: "input" as const },
    runtime: {
      ...PREVIEW_SNAPSHOT.runtime,
      error: "이 기기의 모델을 아직 내려받지 않았어요.",
      download: {
        model: PREVIEW_SNAPSHOT.settings.localModel,
        received: 1024,
        total: 2048,
        status,
        error: downloadError,
      },
    },
  };
  render(<Balloon snapshot={snapshot} surface="input" preview />);
  expect(screen.getByRole("alert").textContent).toBe(expected);
});

it("shows the available alternatives as a separate neutral caption for readiness errors", () => {
  const snapshot = {
    ...PREVIEW_SNAPSHOT,
    panel: { persona: "builtin-a", mode: "input" as const },
  };
  const { rerender } = render(
    <Balloon
      snapshot={{
        ...snapshot,
        runtime: { ...snapshot.runtime, error: "이 기기의 모델을 아직 내려받지 않았어요." },
      }}
      surface="input"
      preview
    />,
  );
  const hint = screen.getByText("AI 없이도 인사·단어장·대화팩은 계속 쓸 수 있어요.");
  expect(hint.className).toBe(conversationMeta);
  expect(hint.closest('[role="alert"]')).toBeNull();
  expect(hint.closest(`.${inputError}`)).toBeTruthy();
  expect(screen.getByRole("button", { name: "AI 연결 열기" }).nextElementSibling).toBe(hint);
  rerender(<Balloon snapshot={snapshot} surface="input" preview />);
  expect(screen.queryByText("AI 없이도 인사·단어장·대화팩은 계속 쓸 수 있어요.")).toBeNull();
});
