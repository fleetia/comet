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
export const actions = style({
  minHeight: tokens["size/control-36"],
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: tokens["spacing/space-16"],
  flexShrink: 0,
});
export const testButton = style({ width: 112 });
export const result = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
  minHeight: 128,
  flexShrink: 0,
  marginTop: 0,
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
export const organizer = style({ minHeight: 0, flex: 1, overflowY: "auto" });
globalStyle(`${root} [hidden]`, { display: "none" });

export const boundary = style({ height: 1, flexShrink: 0, background: tokens["color/line"] });
