import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const root = style({
  maxWidth: 1184,
  height: "100%",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-12"],
  overflow: "hidden",
});
export const actual = style({
  display: "grid",
  gridTemplateColumns: "248px minmax(0, 1fr)",
  alignItems: "center",
  gap: tokens["spacing/space-16"],
  minHeight: tokens["size/control-36"],
  flexShrink: 0,
});
export const actualLabel = style({
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.462",
  fontWeight: 600,
});
export const caption = style({
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
  color: tokens["color/ink-2"],
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
  gap: tokens["spacing/space-12"],
});
export const modeChoices = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-16"],
  minHeight: tokens["size/control-36"],
  flexShrink: 0,
  flexWrap: "wrap",
});
export const modeButton = style({ width: 136, flexShrink: 0, textAlign: "center" });
export const connectionLayout = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 800px) 368px",
  gap: tokens["spacing/space-16"],
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
  gap: tokens["spacing/space-12"],
  overflow: "hidden",
});
export const body = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-12"],
  minHeight: 0,
  overflowY: "auto",
  flex: 1,
});
export const heading = style({
  minHeight: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: tokens["spacing/space-16"],
  flexShrink: 0,
});
export const title = style({
  fontSize: tokens["typography/display/title-sm/fontSize"],
  lineHeight: "1.385",
  fontWeight: 600,
});
export const field = style({ flexShrink: 0 });
export const fileField = style({ display: "flex", alignItems: "center", gap: tokens["spacing/space-16"] });
export const actions = style({
  minHeight: tokens["size/control-36"],
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: tokens["spacing/space-16"],
  flexShrink: 0,
});
export const downloadButton = style({ width: 144 });
export const testButton = style({ width: 112 });
export const result = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
  minHeight: 128,
  flexShrink: 0,
  marginTop: 0,
});
export const resultHeading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  minHeight: tokens["spacing/space-32"],
  fontSize: tokens["typography/sans/body/fontSize"],
  fontWeight: 600,
});
export const resultMessage = style({
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.462",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});
export const summary = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-12"],
  minWidth: 0,
  minHeight: 208,
  overflowWrap: "anywhere",
  "@media": { "(max-width: 1400px)": { display: "none" } },
});
export const summaryName = style({
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.385",
  fontWeight: 600,
});
export const editButton = style({ width: "100%", marginTop: "auto" });
export const memorySearch = style({ minHeight: 132, flex: "0 1 270px" });
export const organizer = style({ minHeight: 0, flex: 1, overflowY: "auto" });
globalStyle(`${root} [hidden]`, { display: "none" });

export const boundary = style({ height: 1, flexShrink: 0, background: tokens["color/line"] });
