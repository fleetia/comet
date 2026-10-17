import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../controls";
import { Dialog } from "./Dialog";

afterEach(cleanup);

function Editor({ variant }: { variant?: "sheet" | "confirm" }): ReactElement {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>열기</Button>
      <Dialog
        title="할 일 편집"
        variant={variant}
        isOpen={open}
        onOpenChange={setOpen}
        footer={<Button onClick={() => setOpen(false)}>완료</Button>}
      >
        <input aria-label="제목" />
      </Dialog>
    </>
  );
}

describe("Dialog", () => {
  it("opens as a labelled modal and returns focus to the opener after the close button", async () => {
    const user = userEvent.setup();
    render(<Editor />);
    const opener = screen.getByRole("button", { name: "열기" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "할 일 편집" });
    expect(dialog.hasAttribute("open")).toBe(true);
    expect(dialog.getAttribute("data-variant")).toBe("sheet");
    expect(document.body.style.overflow).toBe("hidden");
    await user.click(screen.getByRole("button", { name: "닫기" }));
    await waitFor(() => expect(dialog.hasAttribute("open")).toBe(false));
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).toBe("");
  });

  it("closes on native cancel unless the consumer prevents it", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Dialog title="삭제할까요?" variant="confirm" isOpen onOpenChange={onOpenChange}>
        기록이 사라져요.
      </Dialog>,
    );
    const dialog = screen.getByRole("dialog", { name: "삭제할까요?" });
    expect(screen.queryByRole("button", { name: "닫기" })).toBeNull();
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onOpenChange).toHaveBeenCalledWith(false);

    onOpenChange.mockClear();
    rerender(
      <Dialog
        title="삭제할까요?"
        variant="confirm"
        isOpen
        onOpenChange={onOpenChange}
        onCancel={(event) => event.preventDefault()}
      >
        기록이 사라져요.
      </Dialog>,
    );
    fireEvent(dialog, new Event("cancel", { cancelable: true }));
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(dialog);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("does not report its own close as a user dismissal", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <Dialog title="설정" isOpen onOpenChange={onOpenChange}>
        내용
      </Dialog>,
    );
    rerender(
      <Dialog title="설정" isOpen={false} onOpenChange={onOpenChange}>
        내용
      </Dialog>,
    );
    fireEvent(screen.getByRole("dialog", { hidden: true }), new Event("close"));
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
