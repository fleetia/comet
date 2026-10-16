import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const settings = style({
  display: "grid",
  gap: 20,
  minWidth: 0,
  padding: 0,
  margin: 0,
  border: 0,
});
export const side = style([settings, { gap: 10 }]);
export const section = style({ display: "grid", gap: 8, minWidth: 0 });
export const heading = style({
  margin: 0,
  fontFamily: tokens["typography/display/label-display/fontFamily"],
  color: tokens["color/ink-2"],
  fontSize: 14,
  fontWeight: 400,
  lineHeight: "18px",
});
export const caption = style({
  display: "block",
  margin: 0,
  fontSize: 12,
  lineHeight: "16px",
  color: tokens["color/ink-3"],
  fontWeight: 400,
});
export const group = style({
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 18,
  background: tokens["color/card"],
  overflow: "hidden",
});
export const row = style({
  display: "flex",
  alignItems: "center",
  gap: 14,
  minHeight: 49,
  boxSizing: "border-box",
  padding: "11px 16px",
  borderTop: `1px solid ${tokens["color/divider"]}`,
  fontSize: 14,
  lineHeight: "19px",
  selectors: { "&:first-child": { borderTop: 0 } },
});
export const copy = style({ display: "grid", gap: 2, flex: 1, minWidth: 0 });
globalStyle(`${row} > span:has(> select)`, { width: "auto", flex: "0 0 auto" });
globalStyle(`${row} select`, { height: 34, maxWidth: 150, borderRadius: 10 });
export const form = style({ display: "flex", alignItems: "center", gap: 8, minWidth: 0 });
export const searchField = style({
  display: "flex",
  alignItems: "center",
  gap: 8,
  flex: 1,
  minWidth: 0,
  height: 36,
  padding: "0 12px",
  boxSizing: "border-box",
  border: `1px solid ${tokens["color/input-border"]}`,
  borderRadius: 18,
  background: tokens["color/input"],
});
globalStyle(`${searchField} > span`, { flex: 1, minWidth: 0 });
globalStyle(`${searchField} input`, {
  height: 34,
  width: "100%",
  border: 0,
  background: "transparent",
  padding: 0,
  borderRadius: 0,
  fontSize: 13.5,
});
export const searchButton = style({
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
  width: 15,
  height: 20,
  padding: 0,
  border: 0,
  background: "transparent",
  color: tokens["color/ink-3"],
  cursor: "pointer",
});
export const results = style({
  display: "grid",
  gridTemplateColumns: "repeat(3,minmax(0,1fr))",
  gap: 10,
  minWidth: 0,
  "@media": { "(max-width: 900px)": { gridTemplateColumns: "1fr" } },
});
export const result = style({
  width: "100%",
  minWidth: 0,
  selectors: { "&:disabled": { opacity: 1 } },
});
globalStyle(`${result} > svg`, { marginTop: 2, flexShrink: 0 });
export const error = style([caption, { color: tokens["color/danger"] }]);
export const observation = style({ display: "grid", gap: 12, minWidth: 0 });
