import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const editor = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-12"],
  minWidth: 0,
  minHeight: 0,
  height: "100%",
});
export const sceneLayout = style({
  display: "grid",
  gridTemplateColumns: "320px minmax(0,1fr)",
  gap: tokens["spacing/space-16"],
  minWidth: 0,
  flex: 1,
  minHeight: 0,
  height: "100%",
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "192px minmax(0,1fr)" } },
});
export const sceneList = style({ minHeight: 0 });
export const sceneRow = style({
  display: "grid",
  gap: tokens["spacing/space-6"],
  minHeight: 56,
  textAlign: "left",
  overflowWrap: "anywhere",
});
export const sceneHeading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: tokens["spacing/space-16"],
});
export const preview = style({
  padding: 16,
  display: "grid",
  gap: tokens["spacing/space-8"],
  minHeight: 160,
  marginBlock: tokens["spacing/space-16"],
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});
export const line = style({
  display: "grid",
  gap: tokens["spacing/space-8"],
  paddingBlock: tokens["spacing/space-12"],
  borderTop: `1px solid ${tokens["color/line"]}`,
});
export const structureActions = style({
  display: "flex",
  flexWrap: "wrap",
  gap: tokens["spacing/space-8"],
  marginTop: tokens["spacing/space-12"],
});

export const ownerPanel = style({
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
});
globalStyle(`${ownerPanel}[hidden]`, { display: "none" });
