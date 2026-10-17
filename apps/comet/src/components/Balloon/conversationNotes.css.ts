import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const section = style({
  margin: "6px 14px",
  fontSize: tokens["typography/sans/caption/fontSize"],
  overflowWrap: "anywhere",
});
export const form = style({
  display: "grid",
  gap: tokens["spacing/space-8"],
  padding: "8px 14px 14px",
  minWidth: 0,
});
export const actions = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: tokens["spacing/space-6"],
});
export const text = style({
  margin: "6px 0",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});
export const choices = style({ display: "grid", gap: tokens["spacing/space-6"], marginTop: tokens["spacing/space-8"] });
export const choice = style({ justifyContent: "flex-start", textAlign: "left", height: "auto" });
export const bodyInput = style({ minHeight: 110, width: "100%" });
