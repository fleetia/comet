import { style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";

const window = style({
  display: "flex",
  flexDirection: "column",
  height: "100dvh",
  minWidth: 0,
  overflow: "hidden",
  color: tokens["color/ink"],
  border: `1px solid ${tokens["color/glass-border"]}`,
  borderRadius: tokens["radius/radius-18"],
  backdropFilter: tokens["backdrop/backdrop-panel"],
  boxSizing: "border-box",
});
export const frame = styleVariants({
  frameless: { minWidth: 0, minHeight: 0, color: tokens["color/ink"] },
  tool: [window, { background: tokens["color/glass-window"] }],
  note: [window, { background: tokens["color/glass-widget"] }],
});
export const fixedHeader = style({ flexShrink: 0 });
export const header = styleVariants({
  tool: {
    padding: "6px 16px",
    minHeight: 44,
    boxSizing: "border-box",
    borderBottom: `1px solid ${tokens["color/divider"]}`,
  },
  note: {
    padding: `${tokens["spacing/space-6"]} ${tokens["spacing/space-8"]}`,
    background: "transparent",
    borderBottom: `1px solid ${tokens["color/divider"]}`,
  },
});
export const status = style({
  marginBottom: tokens["spacing/space-8"],
  color: tokens["color/ink-2"],
  fontSize: tokens["typography/sans/body/fontSize"],
  lineHeight: "1.462",
});
const body = style({
  flex: 1,
  minHeight: 0,
  minWidth: 0,
  overflowY: "auto",
  overscrollBehavior: "contain",
});
export const content = styleVariants({
  frameless: { minWidth: 0, minHeight: 0 },
  tool: [body, { padding: "16px 20px 20px" }],
  note: [body, { display: "flex", flexDirection: "column" }],
});
const actionArea = style({
  display: "flex",
  flexShrink: 0,
  flexWrap: "wrap",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: tokens["spacing/space-8"],
});
export const footer = styleVariants({
  frameless: [actionArea],
  tool: [
    actionArea,
    {
      padding: `${tokens["spacing/space-8"]} ${tokens["spacing/space-16"]}`,
    },
  ],
  note: [actionArea, { padding: `${tokens["spacing/space-6"]} ${tokens["spacing/space-8"]} ${tokens["spacing/space-8"]}` }],
});
