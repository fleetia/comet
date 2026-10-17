import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const story = style({
  padding: `${tokens["spacing/space-8"]} ${tokens["spacing/space-40"]} ${tokens["spacing/space-8"]} ${tokens["spacing/space-12"]}`,
  maxHeight: 410,
  overflowY: "auto",
});
export const prompt = style({
  whiteSpace: "pre-wrap",
  lineHeight: "1.462",
  margin: `${tokens["spacing/space-8"]} 0 ${tokens["spacing/space-16"]}`,
});
export const choices = style({ display: "flex", flexDirection: "column", gap: tokens["spacing/space-12"], alignItems: "flex-start", paddingInline: tokens["spacing/space-8"] });
export const choice = style({
  whiteSpace: "normal",
  height: "auto",
  minHeight: 36,
  maxWidth: "100%",
  textAlign: "left",
  justifyContent: "flex-start",
  overflowWrap: "anywhere",
});
