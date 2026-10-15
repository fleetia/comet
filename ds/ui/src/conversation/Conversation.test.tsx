import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Balloon, ConstellationChoices, InputCapsule } from "./Conversation";
import { OrbitBranch, OrbitExpandedMenu, OrbitNode } from "./Orbit";
import { fold } from "./orbit.css";
import { ThemeRoot } from "../theme/ThemeRoot";
import compactLines from "./assets/orbit-compact-lines.svg";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function finishOrbitAnimation(element: Element): void {
  const event = new Event("animationend", { bubbles: true });
  Object.defineProperty(event, "animationName", { value: fold });
  fireEvent(element, event);
}
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
  it("keeps the Figma artwork by default and corrects only the external character connector", () => {
    const props = {
      size: "compact" as const,
      parent: "나디르",
      title: "교감",
      items: [{ id: "pet", label: "쓰다듬기", icon: "pet" }] as const,
    };
    const view = render(<OrbitExpandedMenu {...props} />);
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(compactLines);
    const position = screen
      .getByRole("button", { name: "쓰다듬기" })
      .parentElement?.getAttribute("style");
    view.rerender(<OrbitExpandedMenu {...props} characterAnchor={{ x: 20, y: 490 }} />);
    expect(view.container.querySelector("img")).toBeNull();
    const body = view.container.querySelector("[data-orbit-body-ring]");
    expect(body?.getAttribute("cx")).toBe("20");
    expect(body?.getAttribute("cy")).toBe("490");
    expect(view.container.querySelector("[data-orbit-connector]")?.getAttribute("d")).toBe(
      "M156 186L20 439",
    );
    expect(view.container.querySelector("[data-orbit-menu-ring]")?.getAttribute("cy")).toBe("144");
    expect(
      screen.getByRole("button", { name: "쓰다듬기" }).parentElement?.getAttribute("style"),
    ).toBe(position);
  });
  it("ignores non-finite external anchors instead of drawing invalid SVG coordinates", () => {
    const view = render(
      <OrbitExpandedMenu
        size="compact"
        parent="나디르"
        title="교감"
        items={[]}
        characterAnchor={{ x: NaN, y: Infinity }}
      />,
    );
    expect(view.container.querySelector("[data-orbit-anchored-lines]")).toBeNull();
    expect(view.container.querySelector("img")?.getAttribute("src")).toBe(compactLines);
  });
  it("hides closed menu controls while retaining the untransformed character measurement slot", () => {
    const props = {
      size: "compact" as const,
      parent: "나디르",
      title: "교감",
      items: [{ id: "pet", label: "쓰다듬기", icon: "pet" }] as const,
      character: (
        <span data-character-orbit-anchor aria-hidden="true" style={{ width: 52, height: 52 }} />
      ),
    };
    const view = render(<OrbitExpandedMenu {...props} open={false} />);
    const visual = view.container.querySelector("[data-orbit-visual]");
    const marker = view.container.querySelector("[data-character-orbit-anchor]");
    expect(visual?.hasAttribute("inert")).toBe(true);
    expect(visual?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByRole("button")).toBeNull();
    expect(visual?.contains(marker)).toBe(false);
    expect(marker?.parentElement?.style.transform).toBe("");
    view.rerender(<OrbitExpandedMenu {...props} />);
    expect(view.container.querySelector("[data-character-orbit-anchor]")).toBe(marker);
    expect(screen.getByRole("button", { name: "쓰다듬기" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "궤도 위치" })).toBeNull();
  });
  it("launches the hub from the actual character and staggers primary nodes from the hub in array order", () => {
    const view = render(
      <OrbitExpandedMenu
        size="compact"
        parent="나디르"
        title="교감"
        characterAnchor={{ x: 40, y: 400 }}
        items={[
          { id: "one", label: "왼쪽", icon: "pet" },
          { id: "two", label: "다음", icon: "gift" },
        ]}
      />,
    );
    expect(
      view.container.querySelector<HTMLElement>("[data-orbit-hub]")?.style.transformOrigin,
    ).toBe("-97px 275px");
    const nodes = Array.from(view.container.querySelectorAll<HTMLElement>("[data-orbit-primary]"));
    expect(nodes.map((node) => node.textContent)).toEqual(["왼쪽", "다음"]);
    expect(nodes[0].style.transformOrigin).toBe("72.91px -20px");
    expect(nodes[0].style.animationDelay).toContain("* 0");
    expect(nodes[1].style.animationDelay).toContain("* 1");
    expect(screen.getByRole("button", { name: "왼쪽" }).style.animationDelay).toBe("");
  });
  it("keeps the main controls mounted and emphasizes their parent while a named child grows from it", () => {
    const main = (expanded: boolean) => (
      <OrbitExpandedMenu
        size="compact"
        parent="나디르"
        title="함께하기"
        selectedId={expanded ? "interact" : undefined}
        items={[{ id: "interact", label: "교감", icon: "heart" }]}
      />
    );
    const view = render(<div>{main(false)}</div>);
    const parent = screen.getByRole("button", { name: "교감" });
    const visual = parent.closest("[data-orbit-visual]");
    view.rerender(
      <div>
        {main(true)}
        <OrbitBranch
          title="교감"
          origin={{ x: 214.9, y: 178 }}
          center={{ x: 406, y: 234 }}
          items={[{ id: "pet", label: "쓰다듬기", icon: "pet" }]}
        />
      </div>,
    );
    expect(screen.getByRole("button", { name: "교감" })).toBe(parent);
    expect(parent.closest("[data-orbit-visual]")).toBe(visual);
    expect(parent.getAttribute("aria-expanded")).toBe("true");
    const branch = screen.getByRole("group", { name: "교감" });
    expect(branch.style.left).toBe("250px");
    expect(branch.style.top).toBe("90px");
    expect(branch.querySelector("[data-orbit-body-ring]")?.getAttribute("r")).toBe("14");
    expect(branch.querySelector("[data-character-orbit-anchor]")).toBeNull();
    expect(branch.querySelector("img")).toBeNull();
    expect(screen.getByRole("button", { name: "교감 접기" })).toBeTruthy();
  });
  it("fans two pause choices separately without replacing the parent cluster", () => {
    const view = render(
      <OrbitBranch
        title="쉬기"
        origin={{ x: 473, y: 222.19 }}
        center={{ x: 500, y: 390 }}
        items={[
          { id: "hour", label: "한 시간", icon: "pause" },
          { id: "restart", label: "다시 켤 때까지", icon: "pause" },
        ]}
      />,
    );
    const branch = screen.getByRole("group", { name: "쉬기" });
    expect(branch.style.left).toBe("344px");
    expect(branch.style.top).toBe("246px");
    const nodes = Array.from(view.container.querySelectorAll<HTMLElement>("[data-orbit-primary]"));
    expect(nodes.map((node) => [node.style.left, node.style.top])).toEqual([
      ["178px", "75px"],
      ["142px", "198px"],
    ]);
    expect(nodes[0].style.transformOrigin).toBe("-22px 69px");
    expect(nodes[1].style.transformOrigin).toBe("14px -54px");
  });
  it("reverses node order before returning the hub and completes only after the hub exits", () => {
    vi.useFakeTimers();
    const complete = vi.fn();
    const items = [
      { id: "one", label: "첫째", icon: "pet" },
      { id: "two", label: "둘째", icon: "gift" },
    ] as const;
    const view = render(
      <OrbitExpandedMenu parent="나디르" title="교감" items={items} onExitComplete={complete} />,
    );
    const first = screen.getByRole("button", { name: "첫째" });
    first.parentElement!.style.opacity = "0";
    first.parentElement!.style.transform = "scale(0.6)";
    const visual = view.container.querySelector<HTMLElement>("[data-orbit-visual]")!;
    view.rerender(
      <OrbitExpandedMenu
        open={false}
        parent="나디르"
        title="교감"
        items={items}
        onExitComplete={complete}
      />,
    );
    expect(visual.dataset.state).toBe("exiting");
    expect(visual.hasAttribute("inert")).toBe(true);
    expect(screen.queryByRole("button")).toBeNull();
    expect(first.isConnected).toBe(true);
    const nodes = Array.from(view.container.querySelectorAll<HTMLElement>("[data-orbit-primary]"));
    expect(nodes[0].style.animationDelay).toContain("* 1");
    expect(nodes[1].style.animationDelay).toContain("* 0");
    expect(nodes[0].style.getPropertyValue("--comet-orbit-exit-opacity")).toBe("0");
    expect(nodes[0].style.getPropertyValue("--comet-orbit-exit-transform")).toBe("scale(0.6)");
    finishOrbitAnimation(nodes[0]);
    expect(complete).not.toHaveBeenCalled();
    finishOrbitAnimation(view.container.querySelector("[data-orbit-hub]")!);
    expect(visual.dataset.state).toBe("closed");
    expect(complete).toHaveBeenCalledTimes(1);
    act(() => vi.runAllTimers());
    expect(complete).toHaveBeenCalledTimes(1);
  });
  it("cancels stale exits on reopening, uses the latest callback, and cleans up on unmount", () => {
    vi.useFakeTimers();
    const stale = vi.fn();
    const latest = vi.fn();
    const props = { parent: "나디르", title: "교감", items: [] as const };
    const view = render(<OrbitExpandedMenu {...props} onExitComplete={stale} />);
    view.rerender(<OrbitExpandedMenu {...props} open={false} onExitComplete={stale} />);
    view.rerender(<OrbitExpandedMenu {...props} onExitComplete={stale} />);
    act(() => vi.runAllTimers());
    expect(stale).not.toHaveBeenCalled();
    view.rerender(<OrbitExpandedMenu {...props} open={false} onExitComplete={stale} />);
    view.rerender(<OrbitExpandedMenu {...props} open={false} onExitComplete={latest} />);
    act(() => vi.advanceTimersByTime(400));
    expect(latest).toHaveBeenCalledTimes(1);
    expect(stale).not.toHaveBeenCalled();
    view.rerender(<OrbitExpandedMenu {...props} onExitComplete={latest} />);
    view.rerender(<OrbitExpandedMenu {...props} open={false} onExitComplete={latest} />);
    view.unmount();
    act(() => vi.runAllTimers());
    expect(latest).toHaveBeenCalledTimes(1);
  });
  it("completes reduced motion exits immediately and observes changes during an exit", async () => {
    vi.useFakeTimers();
    const complete = vi.fn();
    const props = { parent: "나디르", title: "교감", items: [] as const, onExitComplete: complete };
    const view = render(
      <ThemeRoot motion="reduced">
        <OrbitExpandedMenu {...props} />
      </ThemeRoot>,
    );
    view.rerender(
      <ThemeRoot motion="reduced">
        <OrbitExpandedMenu {...props} open={false} />
      </ThemeRoot>,
    );
    act(() => vi.advanceTimersByTime(0));
    expect(complete).toHaveBeenCalledTimes(1);
    view.rerender(
      <ThemeRoot>
        <OrbitExpandedMenu {...props} />
      </ThemeRoot>,
    );
    view.rerender(
      <ThemeRoot>
        <OrbitExpandedMenu {...props} open={false} />
      </ThemeRoot>,
    );
    view.rerender(
      <ThemeRoot motion="reduced">
        <OrbitExpandedMenu {...props} open={false} />
      </ThemeRoot>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(complete).toHaveBeenCalledTimes(2);
  });
});
