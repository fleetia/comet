import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { WidgetValue, WidgetView } from "../types";
import { FishingTool, GuessingTool, PlantTool } from "./PlayWidgets";
import { CompletionJarTool } from "../CompletionJar/CompletionJarTool";
import { BatteryTool } from "../ConnectionTools/BatteryTool";
import { command, isDesktop } from "../../hooks/useSnapshot";

vi.mock("../../hooks/useSnapshot", async (original) => ({
  ...(await original<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: vi.fn(() => true),
}));

function widget(kind: string, data: WidgetValue): WidgetView {
  return {
    id: kind,
    kind,
    installed: true,
    enabled: true,
    revision: 3,
    version: 1,
    data,
    error: null,
    missing: [],
    status: "enabled",
    packageBytes: 1,
  };
}
const act = vi.fn(() => Promise.resolve(true));
beforeEach(() => {
  act.mockClear();
  vi.mocked(command).mockReset().mockResolvedValue(undefined);
  vi.mocked(isDesktop).mockReturnValue(true);
});
afterEach(cleanup);

it("reels in on a bite and casts again from the collection with unknown slots", () => {
  const { rerender } = render(
    <FishingTool widget={widget("fishing", { phase: "bite", catches: 0 })} act={act} />,
  );
  expect(screen.getByRole("status").textContent).toBe("입질이에요! 지금 거둬 보세요.");
  fireEvent.click(screen.getByRole("button", { name: "낚싯줄 거두기" }));
  expect(act).toHaveBeenCalledWith("reel");
  rerender(
    <FishingTool
      widget={widget("fishing", {
        phase: "idle",
        catches: 9,
        lastCatch: "조개껍데기",
        collected: { shell: 3, conch: 1, "glass-marble": 2 },
      })}
      act={act}
    />,
  );
  expect(screen.getByText("9번 낚았어요")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("조개껍데기를 낚았어요!");
  expect(screen.getByText("×3")).toBeTruthy();
  expect(screen.getAllByLabelText("아직 못 잡은 것")).toHaveLength(3);
  fireEvent.click(screen.getByRole("button", { name: "낚싯줄 던지기" }));
  expect(act).toHaveBeenLastCalledWith("cast");
});

it("stops watering once the plant has three drops or has bloomed", () => {
  const { rerender } = render(
    <PlantTool widget={widget("plant", { stage: 2, water: 1 })} act={act} />,
  );
  expect(screen.getByText("새싹 · 2/3단계")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "물 주기" }));
  expect(act).toHaveBeenCalledWith("water");
  rerender(<PlantTool widget={widget("plant", { stage: 2, water: 3 })} act={act} />);
  expect(screen.getByRole("button", { name: "물 주기" })).toHaveProperty("disabled", true);
  rerender(<PlantTool widget={widget("plant", { stage: 3, water: 0 })} act={act} />);
  expect(screen.getByRole("button", { name: "물 주기" })).toHaveProperty("disabled", true);
  expect(screen.getByText("꽃이 피었어요")).toBeTruthy();
});

it("guesses only whole numbers within range and shows the hint with the attempt count", () => {
  render(
    <GuessingTool
      widget={widget("guessing", {
        mode: "number",
        playing: true,
        hint: "50보다 더 커요",
        attempts: 2,
      })}
      act={act}
    />,
  );
  expect(screen.getByText("50보다 더 커요")).toBeTruthy();
  expect(screen.getByText("세 번째 도전")).toBeTruthy();
  const input = screen.getByRole("spinbutton", { name: "맞혀 볼 숫자" });
  fireEvent.change(input, { target: { value: "101" } });
  fireEvent.click(screen.getByRole("button", { name: "맞혀 보기" }));
  expect(act).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "64" } });
  fireEvent.click(screen.getByRole("button", { name: "맞혀 보기" }));
  expect(act).toHaveBeenCalledWith("guess", { value: 64 });
});

it("picks a cup, then offers another round or stopping after the answer", () => {
  const { rerender } = render(
    <GuessingTool
      widget={widget("guessing", { mode: "cups", playing: true, hint: "", attempts: 0 })}
      act={act}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "2번" }));
  expect(act).toHaveBeenCalledWith("guess", { value: 2 });
  rerender(
    <GuessingTool
      widget={widget("guessing", {
        mode: "cups",
        playing: false,
        hint: "정답! 1번 만에 맞혔어요.",
        attempts: 1,
      })}
      act={act}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "한 판 더" }));
  expect(act).toHaveBeenLastCalledWith("start", { mode: "cups" });
  fireEvent.click(screen.getByRole("button", { name: "그만" }));
  fireEvent.click(screen.getByRole("button", { name: "숫자 맞히기" }));
  expect(act).toHaveBeenLastCalledWith("start", { mode: "number" });
});

it("counts every marble but draws at most the twelve jar slots", () => {
  const completed = Array.from({ length: 14 }, (_, index) => ({
    id: `t${index}`,
    title: index === 0 ? "동네 한 바퀴 걷기" : index === 1 ? "메일 정리하기" : "할 일",
  }));
  const { container } = render(
    <CompletionJarTool widget={widget("completion-jar", { completed })} />,
  );
  expect(screen.getByLabelText("완료 구슬 수").textContent).toBe("14");
  expect(screen.getByText("최근 · 동네 한 바퀴 걷기, 메일 정리하기")).toBeTruthy();
  expect(container.querySelectorAll("svg g")).toHaveLength(12);
});

it("asks for battery access once before the first refresh", async () => {
  render(<BatteryTool widget={widget("device", { configured: false })} />);
  fireEvent.click(screen.getByRole("button", { name: "새로고침" }));
  await waitFor(() =>
    expect(command).toHaveBeenLastCalledWith("refresh_connection_widget", { id: "device" }),
  );
  expect(command).toHaveBeenNthCalledWith(1, "configure_connection_widget", {
    id: "device",
    input: {},
  });
});

it("shows the reading of the first battery and the power source", () => {
  render(
    <BatteryTool
      widget={widget("device", {
        configured: true,
        observation: {
          hasBattery: true,
          powerSource: "ac",
          batteries: [{ percent: 64, status: "charging" }],
        },
      })}
    />,
  );
  expect(screen.getByText("64%")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toBe("충전 중 · 전원 연결됨");
});
