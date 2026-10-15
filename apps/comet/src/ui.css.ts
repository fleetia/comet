import { globalStyle, style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const iconButton = style({
  width: 36,
  minWidth: 30,
  paddingInline: 0,
  aspectRatio: "1",
});
export const compactIconButton = style({ width: 30 });

export const fieldControl = style({ width: "100%" });
export const textarea = style({ height: "auto" });
export const selectControl = style({});
export const fieldGroup = style({});

globalStyle(`${fieldGroup} label`, {
  color: tokens["color/ink-2"],
  fontWeight: 400,
});
globalStyle(`select.${selectControl}`, { width: "100%", minWidth: 0 });

globalStyle(`span:has(> .${fieldControl})`, { display: "contents" });
globalStyle(`span:has(> span > .${selectControl})`, {
  display: "inline-flex",
  width: "100%",
  minWidth: 0,
});
globalStyle(`span:has(> .${selectControl})`, {
  display: "inline-flex",
  width: "100%",
  minWidth: 0,
  flex: "1 1 auto",
});

export const surface = style({
  minWidth: 0,
  minHeight: 0,
  boxShadow: `inset 0 1px 0 ${tokens["color/window-highlight"]}`,
  selectors: { "&[hidden]": { display: "none" } },
});
export const surfaceTones = styleVariants({
  parent: {},
  inset: {
    background: tokens["color/card"],
    borderColor: tokens["color/card-border"],
    borderRadius: tokens["radius/radius-14"],
    backdropFilter: "none",
  },
  inverse: {
    background: tokens["color/selected"],
    borderColor: tokens["color/selected-border"],
    color: tokens["color/selected-ink"],
    borderRadius: tokens["radius/radius-14"],
  },
  accent: {
    background: tokens["color/card-2"],
    borderColor: tokens["color/selected-border"],
    borderRadius: tokens["radius/radius-14"],
  },
});
export const surfacePaddings = styleVariants({
  default: { padding: 16 },
  compact: { padding: 12 },
  flush: { padding: 0 },
  inline: { padding: "0 12px" },
});
