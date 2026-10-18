import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const panel = style({
  padding: 16,
  height: 270,
  minHeight: 132,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
  overflow: "hidden",
});
export const body = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
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
  margin: 0,
  fontSize: tokens["typography/display/title-sm/fontSize"],
  lineHeight: "1.385",
  fontWeight: 600,
});
export const caption = style({
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
  overflowWrap: "anywhere",
});
export const item = style({
  display: "flex",
  flexDirection: "column",
  gap: tokens["spacing/space-8"],
  flexShrink: 0,
});
export const controls = style({
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) 208px 96px 200px",
  alignItems: "center",
  gap: tokens["spacing/space-16"],
  minHeight: 64,
  "@media": {
    "(max-width: 1400px)": { gridTemplateColumns: "minmax(0,1fr) 96px 160px" },
    "(max-width: 1000px)": { gridTemplateColumns: "minmax(0,1fr) 80px 128px", gap: tokens["spacing/space-12"] },
  },
});
export const copy = style({ display: "grid", gap: tokens["spacing/space-6"], minWidth: 0 });
export const itemTitle = style({
  margin: 0,
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.385",
  fontWeight: 600,
});
export const status = style({
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
  minHeight: tokens["spacing/space-32"],
  display: "flex",
  alignItems: "center",
  "@media": {
    "(max-width: 1400px)": {
      gridColumn: 1,
      gridRow: 2,
      marginTop: `calc(-1 * ${tokens["spacing/space-12"]})`,
    },
  },
});
export const checkbox = style({
  width: 96,
  "@media": {
    "(max-width: 1400px)": { gridColumn: 2, gridRow: "1 / 3" },
    "(max-width: 1000px)": { width: 80 },
  },
});
export const actions = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
  "@media": { "(max-width: 1400px)": { gridColumn: 3, gridRow: "1 / 3" } },
});
export const action = style({ width: "100%" });
export const boundary = style({ height: 1, flexShrink: 0, background: tokens["color/line"] });
export const queue = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: tokens["spacing/space-16"],
  minHeight: tokens["size/control-36"],
  flexShrink: 0,
});
export const retry = style({ width: 264, "@media": { "(max-width: 1400px)": { width: 200 } } });
export const confirmation = style({ display: "flex", flexDirection: "column", gap: tokens["spacing/space-8"] });
export const confirmationActions = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-16"],
});
