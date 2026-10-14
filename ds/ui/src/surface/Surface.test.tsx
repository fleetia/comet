import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, type FormEvent } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { MenuItem, Surface } from "./Surface";

afterEach(cleanup);

it("preserves native container attributes and children without assuming dialog or menu behavior", () => {
  const ref = createRef<HTMLDivElement>();
  render(
    <Surface
      ref={ref}
      variant="popover"
      role="region"
      aria-label="작업 도구"
      className="consumer-layout"
    >
      <span>도구 설명</span>
    </Surface>,
  );
  const surface = screen.getByRole("region", { name: "작업 도구" });
  expect(ref.current).toBe(surface);
  expect(surface.classList.contains("consumer-layout")).toBe(true);
  expect(surface.textContent).toBe("도구 설명");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByRole("menu")).toBeNull();
});

it("activates native menu buttons without submitting surrounding forms and blocks disabled actions", async () => {
  const user = userEvent.setup();
  const onAction = vi.fn();
  const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
  render(
    <form onSubmit={onSubmit}>
      <MenuItem icon="memo" onClick={onAction}>
        메모에 남기기
      </MenuItem>
      <MenuItem destructive disabled onClick={onAction}>
        기록 지우기
      </MenuItem>
    </form>,
  );
  await user.tab();
  await user.keyboard("{Enter}");
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(onSubmit).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "기록 지우기" }));
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(screen.getByRole<HTMLButtonElement>("button", { name: "기록 지우기" }).disabled).toBe(
    true,
  );
});
