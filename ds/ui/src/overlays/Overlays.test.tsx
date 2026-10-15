import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ColorPicker } from "./ColorPicker";
import { CometNotification, ContextMenu, OsNotification } from "./Overlays";

afterEach(cleanup);
describe("overlay primitives", () => {
  it("selects swatches, edits valid HEX and changes saturation with the keyboard", async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const { rerender } = render(<ColorPicker value="#77D9CA" onValueChange={change} />);
    await user.click(screen.getByRole("button", { name: "#FFCC33" }));
    expect(change).toHaveBeenCalledWith("#FFCC33");
    const hex = screen.getByRole("textbox", { name: "HEX 색상" });
    fireEvent.change(hex, { target: { value: "#GG" } });
    expect(hex.getAttribute("aria-invalid")).toBe("true");
    fireEvent.change(hex, { target: { value: "#00ff00" } });
    expect(change).toHaveBeenLastCalledWith("#00FF00");
    rerender(<ColorPicker value="#00FF00" onValueChange={change} />);
    fireEvent.keyDown(screen.getByRole("slider", { name: "채도와 밝기" }), { key: "ArrowLeft" });
    expect(change).toHaveBeenLastCalledWith("#03FF03");
    fireEvent.change(screen.getByRole("slider", { name: "색조" }), { target: { value: "240" } });
    expect(change).toHaveBeenLastCalledWith("#0000FF");
  });
  it("wraps keyboard menu navigation, skips disabled items and delegates Escape", async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    const dismiss = vi.fn();
    render(
      <ContextMenu
        actions={[
          { id: "first", label: "메모" },
          { id: "skip", label: "사용 불가", disabled: true },
          { id: "last", label: "해제" },
        ]}
        onAction={action}
        onDismiss={dismiss}
      />,
    );
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "메모" }));
    await user.keyboard("{ArrowDown}{Enter}");
    expect(action).toHaveBeenCalledWith("last");
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "메모" }));
    await user.keyboard("{Escape}");
    expect(dismiss).toHaveBeenCalledOnce();
  });
  it("announces failures and routes notifications without performing side effects", async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(
      <>
        <CometNotification
          title="저장 실패"
          description="원문은 남아 있어요"
          status="save-failed"
          actions={[{ id: "retry", label: "다시 요청", primary: true }]}
          onAction={action}
        />
        <OsNotification title="책 모임" description="10분 뒤" />
      </>,
    );
    expect(screen.getByRole("alert").textContent).toContain("원문은 남아 있어요");
    expect(screen.getByRole("status").textContent).toContain("책 모임");
    await user.click(screen.getByRole("button", { name: "다시 요청" }));
    expect(action).toHaveBeenCalledWith("retry");
  });
});
