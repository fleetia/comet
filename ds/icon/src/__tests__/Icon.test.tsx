import { createRef } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import canonical from "../../figma/icons.json";
import { BellIcon, CalendarIcon, Icon, iconNames, type IconName } from "../index";

afterEach(cleanup);

function geometry(element: Element): unknown {
  return {
    tag: element.tagName,
    attributes: Array.from(element.attributes)
      .map(({ name, value }) => [name, value === "#EEF1FF" ? "currentColor" : value])
      .sort(([left], [right]) => left.localeCompare(right)),
    children: Array.from(element.children, geometry),
  };
}

it("preserves every Figma icon's geometry, stroke and viewBox while inheriting currentColor", () => {
  const names = canonical.icons.map(({ name }) => name.slice("Icon/".length));
  expect(new Set(names).size).toBe(canonical.icons.length);
  expect(iconNames).toEqual(names);

  for (const source of canonical.icons) {
    const expected = new DOMParser().parseFromString(source.svg, "image/svg+xml").documentElement;
    expect(expected.tagName).toBe("svg");
    const view = render(<Icon name={source.name.slice("Icon/".length) as IconName} />);
    const actual = view.container.querySelector("svg")!;
    for (const name of ["width", "height", "viewBox", "fill", "xmlns"]) {
      expect(actual.getAttribute(name), `${source.name}: ${name}`).toBe(
        expected.getAttribute(name),
      );
    }
    expect(Array.from(actual.children, geometry), source.name).toEqual(
      Array.from(expected.children, geometry),
    );
    view.unmount();
  }
});

it("defaults to a decorative icon and exposes a supplied accessible name", () => {
  const view = render(<BellIcon />);
  expect(view.container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  expect(screen.queryByRole("img")).toBeNull();

  view.rerender(<BellIcon label="알림" />);
  const labelled = screen.getByRole("img", { name: "알림" });
  expect(labelled.hasAttribute("aria-hidden")).toBe(false);
  expect(labelled.hasAttribute("label")).toBe(false);

  view.rerender(<CalendarIcon aria-label="일정" aria-hidden={false} />);
  expect(screen.getByRole("img", { name: "일정" }).getAttribute("aria-hidden")).toBe("false");

  view.rerender(
    <>
      <span id="calendar-label">달력</span>
      <CalendarIcon aria-labelledby="calendar-label" />
    </>,
  );
  expect(screen.getByRole("img", { name: "달력" }).getAttribute("aria-labelledby")).toBe(
    "calendar-label",
  );
});

it("forwards SVG props and refs and scales without changing the source viewBox", () => {
  const ref = createRef<SVGSVGElement>();
  const view = render(
    <Icon name="bell" ref={ref} size={32} color="tomato" className="notification" />,
  );
  const svg = view.container.querySelector("svg")!;
  expect(ref.current).toBe(svg);
  expect(svg.getAttribute("width")).toBe("32");
  expect(svg.getAttribute("height")).toBe("32");
  expect(svg.getAttribute("viewBox")).toBe("0 0 20 20");
  expect(svg.getAttribute("color")).toBe("tomato");
  expect(svg.getAttribute("class")).toBe("notification");
  expect(svg.getAttribute("focusable")).toBe("false");
  expect(
    Array.from(svg.querySelectorAll("[stroke]")).every(
      (shape) => shape.getAttribute("stroke") === "currentColor",
    ),
  ).toBe(true);

  view.rerender(<BellIcon size="1em" width={28} />);
  expect(view.container.querySelector("svg")?.getAttribute("width")).toBe("28");
  expect(view.container.querySelector("svg")?.getAttribute("height")).toBe("1em");
});
