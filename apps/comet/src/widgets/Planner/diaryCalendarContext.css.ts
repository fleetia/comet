import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const context = style({ borderTop: `1px solid ${tokens["color/line"]}`, paddingTop: 12 });
export const summary = style({
  cursor: "pointer",
  fontSize: tokens["typography/sans/body/fontSize"],
  fontWeight: 600,
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 3 },
  },
});
export const body = style({ display: "grid", gap: 16, paddingTop: 12, minWidth: 0 });
export const connections = style({
  display: "grid",
  gap: 12,
  padding: 0,
  margin: 0,
  listStyle: "none",
});
export const heading = style({ fontSize: tokens["typography/sans/body/fontSize"], fontWeight: 500, margin: 0 });
export const caption = style({
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
  margin: "4px 0 0",
  overflowWrap: "anywhere",
});
