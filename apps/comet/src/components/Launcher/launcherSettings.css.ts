import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const compact = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) auto",
  alignItems: "center",
  gap: 12,
  minHeight: 52,
  padding: `${tokens["spacing/space-12"]} ${tokens["spacing/space-16"]}`,
  rowGap: tokens["spacing/space-8"],
  borderBottom: `1px solid ${tokens["color/divider"]}`,
});
export const label = style({ fontSize: 13, fontWeight: 400 });
export const controls = style({ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" });
export const options = style({
  gridColumn: "1 / -1",
  color: tokens["color/ink-3"],
  fontSize: 12,
  paddingBottom: 0,
});
