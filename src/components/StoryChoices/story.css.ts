import { style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const story = style({ padding: "8px 32px 8px 12px", maxHeight: 410, overflowY: "auto" });
export const prompt = style({
  whiteSpace: "pre-wrap",
  lineHeight: vars.typography.lineHeight.body,
  margin: `${vars.space.sm} 0 ${vars.space.lg}`,
});
export const choices = style({ display: "flex", flexDirection: "column", gap: vars.space.sm });
export const choice = style({
  whiteSpace: "normal",
  height: "auto",
  minHeight: 36,
  textAlign: "left",
  justifyContent: "flex-start",
  overflowWrap: "anywhere",
});
