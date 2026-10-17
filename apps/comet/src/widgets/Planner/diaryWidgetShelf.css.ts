import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const shelf = style({
  borderTop: `1px solid ${tokens["color/line"]}`,
  marginTop: 20,
  paddingTop: 12,
});
export const heading = style({
  fontWeight: 600,
  cursor: "pointer",
  fontSize: tokens["typography/sans/body/fontSize"],
});
export const hint = style({
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
  margin: "8px 0",
});
export const group = style({ marginTop: 8 });
export const row = style({ display: "flex", gap: 2, alignItems: "center", minWidth: 0 });
export const name = style({
  flex: 1,
  minWidth: 0,
  padding: "6px 2px",
  border: 0,
  background: "transparent",
  color: tokens["color/ink"],
  font: "inherit",
  textAlign: "left",
  cursor: "pointer",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  selectors: {
    "&:hover": { textDecoration: "underline" },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 1 },
    "&:disabled": { opacity: 0.5, cursor: "default" },
  },
});
export const itemName = style([name, { fontSize: tokens["typography/sans/caption/fontSize"] }]);
export const items = style({ paddingLeft: 24 });
export const list = style({ maxHeight: 240, overflowY: "auto" });
