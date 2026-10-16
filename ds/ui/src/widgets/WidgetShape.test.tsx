import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { WeatherWidget } from "./FreeformWidgets";
import type { WidgetShape } from "./WidgetShape";

afterEach(cleanup);
const shape: WidgetShape = {
  source: "preset",
  preset: "cloud",
  cloudCount: 4,
  roundness: 70,
  rotation: 0,
  flipX: false,
  flipY: false,
  fitContent: true,
  width: 230,
  height: 150,
  strokes: [],
};
it("renders changed cloud geometry and keeps actual widget content independent of the outline", () => {
  const { container, rerender } = render(
    <WeatherWidget temperature="21°C" condition="맑음" location="서울" shape={shape} />,
  );
  const original = container.querySelector("clipPath path")!.getAttribute("d");
  rerender(
    <WeatherWidget
      temperature="21°C"
      condition="맑음"
      location="서울"
      shape={{ ...shape, cloudCount: 6, roundness: 40, rotation: 30, flipX: true }}
    />,
  );
  expect(container.querySelector("clipPath path")!.getAttribute("d")).not.toBe(original);
  expect(container.querySelector("svg")!.style.transform).toContain("rotate(30deg)");
  expect(screen.getByText("21°C")).toBeTruthy();
  expect(screen.getByText("서울")).toBeTruthy();
  expect(shape.strokes).toEqual([]);
});
it("clips a caller-owned image and restores a saved drawing without treating either as widget data", () => {
  const { container, rerender } = render(
    <WeatherWidget
      temperature="21°C"
      condition="맑음"
      location="서울"
      shape={{ ...shape, source: "image" }}
      backgroundImage="widget://localhost/asset?v=2"
      imagePosition="left top"
    />,
  );
  const image = container.querySelector("image")!;
  expect(image.getAttribute("href")).toBe("widget://localhost/asset?v=2");
  expect(image.getAttribute("preserveAspectRatio")).toBe("xMinYMin slice");
  const strokes = [
    [
      { x: 1, y: 2 },
      { x: 23, y: 2 },
      { x: 12, y: 23 },
    ],
  ];
  rerender(
    <WeatherWidget
      temperature="21°C"
      condition="맑음"
      location="서울"
      shape={{ ...shape, source: "drawing", strokes }}
    />,
  );
  expect(container.querySelector("image")).toBeNull();
  expect(container.querySelector("clipPath path")!.getAttribute("d")).toContain("23.000 2.000");
  expect(strokes[0][2]).toEqual({ x: 12, y: 23 });
});
it("scales a default shape's artwork with the outline instead of stretching it over the offset", () => {
  const { container } = render(
    <WeatherWidget
      temperature="21°C"
      condition="맑음"
      location="서울"
      shape={{ ...shape, preset: "default", width: 460, height: 300 }}
    />,
  );
  const [art, outline] = container.querySelectorAll("img");
  // The 218.808×133.621 cloud sits at (8.41, 16.38) inside the 230×150 outline box.
  expect(parseFloat(art.style.left)).toBeCloseTo((8.41 / 230) * 100, 6);
  expect(parseFloat(art.style.top)).toBeCloseTo((16.38 / 150) * 100, 6);
  expect(parseFloat(art.style.width)).toBeCloseTo((218.808 / 230) * 100, 6);
  expect(parseFloat(art.style.height)).toBeCloseTo((133.621 / 150) * 100, 6);
  expect(parseFloat(art.style.left) + parseFloat(art.style.width)).toBeLessThanOrEqual(100);
  expect(outline.style.width).toBe("100%");
  expect(outline.style.height).toBe("100%");
});
it("draws a recoloured default shape with the caller's fallback preset", () => {
  const { container, rerender } = render(
    <WeatherWidget
      temperature="21°C"
      condition="맑음"
      location="서울"
      shape={{ ...shape, preset: "default" }}
      backgroundColor="#123456"
      fallbackPreset="06"
    />,
  );
  expect(container.querySelector("clipPath path")!.getAttribute("d")).toBe(
    "M12 0L24 12L12 24L0 12L12 0Z",
  );
  rerender(
    <WeatherWidget
      temperature="21°C"
      condition="맑음"
      location="서울"
      shape={{ ...shape, preset: "default" }}
      backgroundColor="#123456"
    />,
  );
  expect(container.querySelector("clipPath path")!.getAttribute("d")).toMatch(/^M5\.8 0H18\.2/);
});
