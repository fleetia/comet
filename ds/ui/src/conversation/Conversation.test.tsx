import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Balloon, ConstellationChoices, InputCapsule } from "./Conversation";
import { OrbitExpandedMenu, OrbitNode } from "./Orbit";

afterEach(cleanup);
describe("conversation primitives", () => {
  it("sends the original text once and keeps sending input unavailable", async () => {
    const user = userEvent.setup();
    const send = vi.fn();
    const { rerender } = render(
      <InputCapsule defaultValue={"  오늘  생각\n다음 줄 "} form="multiline" onSend={send} />,
    );
    await user.click(screen.getByRole("button", { name: "보내기" }));
    expect(send).toHaveBeenCalledWith("  오늘  생각\n다음 줄 ");
    rerender(<InputCapsule value="아직 보내는 중" sending onSend={send} />);
    expect((screen.getByRole("textbox", { name: "메시지" }) as HTMLInputElement).disabled).toBe(
      true,
    );
    await user.click(screen.getByRole("button", { name: "보내는 중" }));
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("shows speaker, original whitespace and typing status without losing its text", () => {
    render(
      <Balloon speaker="nadir" content="typing">
        {"같은  음절\n다음 줄"}
      </Balloon>,
    );
    expect(screen.getByText("나디르")).toBeTruthy();
    expect(screen.getByText(/같은/).textContent).toContain("같은  음절\n다음 줄");
    expect(screen.getByRole("status", { name: "대답을 적고 있어요" })).toBeTruthy();
  });
  it("chooses by id and makes unchosen options inert after a choice", async () => {
    const user = userEvent.setup();
    const choose = vi.fn();
    const options = [
      { id: "river", label: "강가를 따라서" },
      { id: "market", label: "시장 골목으로" },
      { id: "rest", label: "오늘은 쉬자" },
    ] as const;
    const { rerender } = render(<ConstellationChoices options={options} onChoose={choose} />);
    await user.click(screen.getByRole("button", { name: "시장 골목으로" }));
    expect(choose).toHaveBeenCalledWith("market");
    rerender(<ConstellationChoices options={options} selectedId="market" onChoose={choose} />);
    expect(screen.getByRole("button", { name: "시장 골목으로" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    await user.click(screen.getByRole("button", { name: "강가를 따라서" }));
    expect(choose).toHaveBeenCalledTimes(1);
    rerender(
      <ConstellationChoices options={options} selectedId="removed-option" onChoose={choose} />,
    );
    expect(
      (screen.getByRole("button", { name: "강가를 따라서" }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });
  it("keeps orbit actions keyboard accessible, disables unavailable nodes and delegates Escape", async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    const back = vi.fn();
    render(
      <>
        <OrbitNode icon="gift" label="선물 건네기" disabled onClick={action} />
        <OrbitExpandedMenu
          parent="나디르"
          title="교감"
          items={[{ id: "pet", label: "쓰다듬기", icon: "pet" }]}
          onAction={action}
          onBack={back}
        />
      </>,
    );
    await user.click(screen.getByRole("button", { name: "선물 건네기" }));
    expect(action).not.toHaveBeenCalled();
    await user.tab();
    await user.keyboard("{Enter}");
    expect(action).toHaveBeenCalledWith("pet");
    await user.keyboard("{Escape}");
    expect(back).toHaveBeenCalledOnce();
  });
});
