import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const workspace = style({
  display: "flex",
  flexDirection: "column",
  height: "100%",
  minWidth: 0,
  minHeight: 0,
});
export const identity = style({
  display: "grid",
  gap: 6,
  marginBottom: tokens["spacing/space-12"],
  minHeight: 96,
  alignContent: "center",
});
export const actions = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,880fr) minmax(0,544fr)",
  gap: tokens["spacing/space-16"],
  flex: 1,
  minHeight: 0,
});
export const commandRow = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: tokens["spacing/space-16"],
  minHeight: 64,
  "@media": {
    "(max-width: 1280px)": { flexDirection: "column", alignItems: "start", gap: tokens["spacing/space-8"] },
  },
});
export const boundary = style({
  borderTop: `1px solid ${tokens["color/line"]}`,
  marginTop: tokens["spacing/space-16"],
  paddingTop: tokens["spacing/space-16"],
});
export const detailRow = style({
  display: "grid",
  gridTemplateColumns: "140px minmax(0,1fr)",
  gap: tokens["spacing/space-16"],
  alignItems: "center",
  minHeight: 40,
  marginBlock: tokens["spacing/space-12"],
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "72px minmax(0,1fr)" } },
});
