import { style } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
export const root = style({
  height: "100%",
  minHeight: 0,
  minWidth: 0,
  display: "flex",
  flexDirection: "column",
});
export const connection = style({
  height: "100%",
  minHeight: 0,
  minWidth: 0,
  selectors: { "&[hidden]": { display: "none" } },
});
export const organizer = style({
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  display: "grid",
  gap: 18,
  selectors: { "&[hidden]": { display: "none" } },
});
export const provider = style({ width: "100%", justifyContent: "center" });
export const modelRow = style({
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr)",
  alignItems: "start",
  gap: 8,
});
export const modelSelect = style({ width: "100%" });
export const downloadPresentation = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 8,
  padding: "8px 0 0",
  textAlign: "center",
});
export const ring = style({
  position: "relative",
  width: 168,
  height: 168,
  marginBottom: 10,
  borderRadius: "50%",
  background: tokens["color/track"],
});
export const ringFill = style({
  position: "absolute",
  inset: 0,
  borderRadius: "50%",
  background: `conic-gradient(${tokens["color/live"]} var(--model-progress), transparent 0)`,
  maskImage: "radial-gradient(circle, transparent 76px, black 77px)",
});
export const ringValue = style({
  position: "absolute",
  inset: 10,
  borderRadius: "50%",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  justifyContent: "center",
  gap: 4,
  background: tokens["color/glass-panel"],
  color: tokens["color/ink"],
});
export const centerActions = style({ display: "flex", justifyContent: "center" });
export const connectionStatus = style({
  padding: 14,
  display: "grid",
  gap: 14,
  borderRadius: 18,
  border: `1px dashed ${tokens["color/input-border"]}`,
  background: tokens["color/input"],
});
export const sharingNote = style({
  display: "flex",
  gap: 10,
  padding: 14,
  borderRadius: 16,
  border: `1px solid ${tokens["color/danger-border"]}`,
  background: tokens["color/component/danger-alpha-100"],
});
export const textField = style({
  width: 330,
  maxWidth: "100%",
  "@media": { "(max-width: 1100px)": { width: 230 } },
});
export const keyActions = style({
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 8,
});
