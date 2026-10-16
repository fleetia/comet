import { expect, it } from "vitest";
import desktopKinds from "../desktopKinds.json";
import type { WidgetView } from "../types";
import { FREEFORM_SKIN_OUTLINES } from "@comet/ui";
import { DESKTOP_SKINS, defaultShape, desktopSkin, resizeShape } from "./desktopShape";

const weather = { id: "weather", kind: "weather" } as WidgetView;

it("takes default sizes from the shared desktop kinds table", () => {
  expect(defaultShape(weather)).toMatchObject({
    width: desktopKinds.weather.width,
    height: desktopKinds.weather.height,
  });
});

it("resizes from the bottom-right corner within the shape limits", () => {
  const shape = defaultShape(weather);
  expect(resizeShape(shape, 20.4, -10)).toMatchObject({ width: 250, height: 140 });
  expect(resizeShape(shape, -1000, -1000)).toMatchObject({ width: 48, height: 24 });
  expect(resizeShape(shape, 5000, 5000)).toMatchObject({ width: 800, height: 600 });
});

it("maps every desktop kind to a design-system skin whose artwork matches the default size", () => {
  expect(Object.keys(DESKTOP_SKINS).sort()).toEqual(Object.keys(desktopKinds).sort());
  for (const [kind, size] of Object.entries(desktopKinds)) {
    const skin = desktopSkin(kind)?.skin;
    if (skin)
      expect(FREEFORM_SKIN_OUTLINES[skin]).toMatchObject({
        width: size.width,
        height: size.height,
      });
  }
  expect(desktopSkin("completion-jar")).toBeUndefined();
});
