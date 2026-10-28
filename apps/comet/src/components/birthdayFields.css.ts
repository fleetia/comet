import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const fields = style({
  display: "flex",
  flexWrap: "wrap",
  gap: tokens["spacing/space-12"],
});
