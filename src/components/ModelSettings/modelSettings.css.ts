import { globalStyle, style } from "@vanilla-extract/css";
import { semanticVars as vars } from "@fleetia/lagrange/theme";

export const root = style({
  maxWidth: 1184,
  height: "100%",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
  overflow: "hidden",
});
export const actual = style({
  display: "grid",
  gridTemplateColumns: "248px minmax(0, 1fr)",
  alignItems: "center",
  gap: vars.space.lg,
  minHeight: vars.dimension.control,
  flexShrink: 0,
});
export const actualLabel = style({
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.body,
  fontWeight: 600,
});
export const caption = style({
  fontSize: vars.typography.size.caption,
  lineHeight: vars.typography.lineHeight.body,
  color: vars.color.content.secondary,
  overflowWrap: "anywhere",
});
export const configuration = style({
  border: 0,
  padding: 0,
  margin: 0,
  minWidth: 0,
  minHeight: 240,
  flex: "0 1 572px",
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
});
export const modeChoices = style({
  display: "flex",
  alignItems: "center",
  gap: vars.space.lg,
  minHeight: vars.dimension.control,
  flexShrink: 0,
});
export const modeButton = style({ width: 176, flexShrink: 0, textAlign: "center" });
export const connectionLayout = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 800px) 368px",
  gap: vars.space.lg,
  alignItems: "start",
  minHeight: 0,
  flex: 1,
  "@media": { "(max-width: 1400px)": { gridTemplateColumns: "minmax(0, 800px)" } },
});
export const connectionPanel = style({
  minWidth: 0,
  height: "100%",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
  overflow: "hidden",
});
export const body = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
  minHeight: 0,
  overflowY: "auto",
  flex: 1,
});
export const heading = style({
  minHeight: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: vars.space.lg,
  flexShrink: 0,
});
export const title = style({
  fontSize: vars.typography.size.headingSm,
  lineHeight: vars.typography.lineHeight.compact,
  fontWeight: 600,
});
export const field = style({ flexShrink: 0 });
export const fileField = style({ display: "flex", alignItems: "center", gap: vars.space.lg });
export const actions = style({
  minHeight: vars.dimension.control,
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: vars.space.lg,
  flexShrink: 0,
});
export const downloadButton = style({ width: 144 });
export const testButton = style({ width: 112 });
export const result = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.sm,
  minHeight: 128,
  flexShrink: 0,
  marginTop: 0,
});
export const resultHeading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  minHeight: vars.dimension.row,
  fontSize: vars.typography.size.label,
  fontWeight: 600,
});
export const resultMessage = style({
  fontSize: vars.typography.size.body,
  lineHeight: vars.typography.lineHeight.body,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});
export const summary = style({
  display: "flex",
  flexDirection: "column",
  gap: vars.space.md,
  minWidth: 0,
  minHeight: 208,
  overflowWrap: "anywhere",
  "@media": { "(max-width: 1400px)": { display: "none" } },
});
export const summaryName = style({
  fontSize: vars.typography.size.label,
  lineHeight: vars.typography.lineHeight.compact,
  fontWeight: 600,
});
export const editButton = style({ width: "100%", marginTop: "auto" });
export const memorySearch = style({ minHeight: 132, flex: "0 1 270px" });
globalStyle(`${root} [hidden]`, { display: "none" });

export const boundary = style({ height: 1, flexShrink: 0, background: vars.color.border.subtle });
