import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const workspace = style({
  display: "flex",
  flexDirection: "column",
  height: "100%",
  flex: 1,
  minWidth: 0,
  minHeight: 0,
});
export const listEditor = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,520fr) minmax(0,904fr)",
  gap: tokens["spacing/space-16"],
  flex: 1,
  minHeight: 0,
  "@media": { "(max-width: 1280px)": { gridTemplateColumns: "192px minmax(0,1fr)" } },
});
export const listRow = style({
  display: "grid",
  gap: tokens["spacing/space-4"],
  minHeight: 56,
  textAlign: "left",
  whiteSpace: "normal",
});
export const metadata = style({
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
  color: tokens["color/ink-2"],
  selectors: {
    [`${listRow}[aria-pressed="true"] &`]: { color: tokens["color/on-primary"] },
  },
});
export const editor = style({
  border: 0,
  margin: 0,
  padding: 0,
  display: "grid",
  gap: tokens["spacing/space-12"],
  minWidth: 0,
});
export const heading = style({
  fontSize: tokens["typography/display/title-sm/fontSize"],
  lineHeight: "1.385",
  fontWeight: 600,
  margin: 0,
});
export const editorHeading = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: tokens["spacing/space-16"],
  minHeight: tokens["size/control-36"],
});
export const memoryText = style({ minHeight: 192 });
export const evidence = style({
  borderTop: `1px solid ${tokens["color/line"]}`,
  paddingTop: tokens["spacing/space-12"],
});
export const original = style({ whiteSpace: "pre-wrap", overflowWrap: "anywhere" });
export const sourceEvidence = style({ padding: 16 });
