import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { WidgetFrame } from "./WidgetFrame";
import * as styles from "./widgetFrame.css";

afterEach(cleanup);

it.each(["tool", "note"] as const)("keeps the %s footer outside the scrolling body", (variant) => {
  const view = render(
    <WidgetFrame
      title="도구"
      closeLabel="닫기"
      onClose={vi.fn()}
      variant={variant}
      footer={<button>정리하기</button>}
    >
      <p>긴 본문</p>
    </WidgetFrame>,
  );
  const frame = screen.getByRole("main");
  const body = screen.getByText("긴 본문").parentElement;
  const footer = screen.getByRole("button", { name: "정리하기" }).closest("footer");
  expect(body?.className).toContain(styles.content[variant]);
  expect(footer?.className).toContain(styles.footer[variant]);
  expect(footer?.parentElement).toBe(frame);
  expect(body?.nextElementSibling).toBe(footer);
  expect(body?.contains(footer)).toBe(false);
  expect(frame.lastElementChild).toBe(footer);
  expect(view.container.querySelectorAll("footer")).toHaveLength(1);
});

it("does not reserve an empty action region without footer actions", () => {
  const view = render(
    <WidgetFrame title="도구" closeLabel="닫기" onClose={vi.fn()}>
      <p>본문</p>
    </WidgetFrame>,
  );
  expect(view.container.querySelector("footer")).toBeNull();
  expect(screen.getByRole("main").lastElementChild).toBe(screen.getByText("본문").parentElement);
});
