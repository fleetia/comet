import { globalStyle, style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

export const page = style({
  display: "flex",
  flexDirection: "column",
  minWidth: 0,
  gap: 32,
  paddingBottom: 32,
});

export const log = style({
  listStyle: "none",
  padding: 0,
  margin: 0,
});

export const heading = style({
  margin: `0 0 ${tokens["spacing/space-16"]}`,
  fontFamily: tokens["typography/display/title-sm/fontFamily"],
  fontSize: 17,
  fontWeight: 400,
  lineHeight: "24px",
});

export const appointments = style({ display: "grid", gap: tokens["spacing/space-8"] });
export const appointment = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: tokens["spacing/space-12"],
  minHeight: 64,
  paddingBlock: 10,
  borderBottom: `1px solid ${tokens["color/divider"]}`,
});
export const records = style({ minWidth: 0 });

export const line = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
  minWidth: 0,
  padding: "10px 0",
  minHeight: 48,
  borderBottom: `1px solid ${tokens["color/divider"]}`,
});

export const rowActions = style({
  display: "inline-flex",
  flexShrink: 0,
  alignItems: "center",
  gap: tokens["spacing/space-6"],
  opacity: 0,
  selectors: {
    [`${line}:hover &`]: { opacity: 1 },
    [`${line}:focus-within &`]: { opacity: 1 },
  },
  "@media": { "(hover: none)": { opacity: 1 } },
});

export const entryText = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-8"],
  minWidth: 0,
});
export const moved = style({
  display: "flex",
  flex: 1,
  minWidth: 0,
  alignItems: "center",
  flexWrap: "wrap",
  gap: tokens["spacing/space-16"],
});

export const bullet = style({
  flex: "0 0 18px",
  textAlign: "center",
  lineHeight: "28px",
  color: tokens["color/ink-2"],
});

export const content = style({ minWidth: 0, flex: 1 });

// Reserve readable text space before wrapping appointment actions to the next line.
export const appointmentContent = style([content, { flex: "1 1 160px" }]);

export const row = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: tokens["spacing/space-8"],
  minWidth: 0,
});

export const title = style({
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.462",
  overflowWrap: "anywhere",
  whiteSpace: "pre-wrap",
});

export const task = style({ minWidth: 0, flex: 1 });
globalStyle(`${task} label`, { overflowWrap: "anywhere" });

export const completed = style({
  textDecoration: "line-through",
  color: tokens["color/ink-2"],
});

export const meta = style({
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
});

export const controls = style({
  display: "flex",
  alignItems: "center",
  flexWrap: "wrap",
  gap: tokens["spacing/space-8"],
  marginTop: tokens["spacing/space-6"],
});

export const writing = style({
  display: "block",
  boxSizing: "border-box",
  width: "100%",
  minHeight: 32,
  padding: `${tokens["spacing/space-6"]} ${tokens["spacing/space-6"]}`,
  border: "1px solid transparent",
  borderRadius: tokens["radius/radius-10"],
  background: "transparent",
  color: tokens["color/ink"],
  fontFamily: `${tokens["typography/sans/body/fontFamily"]}, sans-serif`,
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: 1.75,
  resize: "none",
  overflow: "hidden",
  selectors: {
    "&:hover:not(:disabled)": { background: tokens["color/card-2"] },
    "&:focus": {
      outline: `1px solid ${tokens["color/focus-ring"]}`,
      outlineOffset: 1,
      background: tokens["color/input"],
    },
    "&::placeholder": { color: tokens["color/ink-2"] },
    "&:disabled": { color: tokens["color/ink-2"] },
  },
});

export const time = style({ width: 100, minWidth: 100 });
export const date = style({ width: 152, minWidth: 130 });

export const composer = style({
  display: "flex",
  flexDirection: "column",
  gap: 12,
  minWidth: 0,
  padding: 16,
  borderRadius: tokens["radius/radius-14"],
  background: tokens["color/component/cat-rest-alpha-80"],
  border: `1px solid ${tokens["color/card-border"]}`,
});

export const composerBody = style({ minHeight: 76 });

export const kinds = style({
  display: "flex",
  flexWrap: "wrap",
  gap: tokens["spacing/space-6"],
});

export const spacer = style({ flex: 1 });

export const error = style({
  color: tokens["color/danger"],
  fontSize: tokens["typography/sans/caption/fontSize"],
  lineHeight: "1.462",
});

export const empty = style({
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: 1.75,
  margin: `${tokens["spacing/space-16"]} 0`,
});

export const envelope = style({ textAlign: "left", whiteSpace: "normal", maxWidth: "100%" });

export const addLine = style({
  display: "flex",
  alignItems: "center",
  gap: tokens["spacing/space-12"],
  width: "100%",
  minHeight: 52,
  background: "transparent",
  border: 0,
  borderRadius: tokens["radius/radius-10"],
  padding: "10px 8px",
  color: tokens["color/ink-2"],
  font: "inherit",
  fontSize: tokens["typography/sans/body/fontSize"],
  textAlign: "left",
  cursor: "text",
  selectors: {
    "&:hover": { background: tokens["color/card-2"] },
    "&:focus-visible": { outline: `1px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
  },
});

export const footer = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  flexWrap: "wrap",
  gap: tokens["spacing/space-12"],
  marginTop: tokens["spacing/space-16"],
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/caption/fontSize"],
});

export const taskTitle = style({
  flex: 1,
  minWidth: 0,
  border: 0,
  background: "transparent",
  color: "inherit",
  font: "inherit",
  padding: `${tokens["spacing/space-6"]} 0`,
  textAlign: "left",
  cursor: "pointer",
  overflowWrap: "anywhere",
  selectors: {
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
  },
});
export const memoPreview = style([
  meta,
  { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 },
]);
