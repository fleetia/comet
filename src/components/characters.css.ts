import { style } from "@vanilla-extract/css";
import { input } from "../styles.css";
export const page = style({
  maxWidth: 1100,
  margin: "0 auto",
  padding: "28px 24px 48px",
  background: "#fffdf8",
  minHeight: "100dvh",
});
export const header = style({
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: 16,
  marginBottom: 24,
});
export const layout = style({
  display: "grid",
  gridTemplateColumns: "190px minmax(0,1fr)",
  gap: 28,
  "@media": { "(max-width: 650px)": { gridTemplateColumns: "1fr" } },
});
export const list = style({
  display: "flex",
  flexDirection: "column",
  gap: 7,
  alignSelf: "start",
  position: "sticky",
  top: 16,
  "@media": { "(max-width: 650px)": { position: "static" } },
});
export const item = style({
  padding: "12px 10px",
  border: "1px solid transparent",
  borderRadius: 5,
  textAlign: "left",
  background: "transparent",
  overflowWrap: "anywhere",
  selectors: { '&[aria-pressed="true"]': { background: "#edf1e6", borderColor: "#6c8368" } },
  ":hover": { background: "#f3f4ec" },
});
export const small = style({ display: "block", marginTop: 5, color: "#6b7269", fontSize: 11 });
export const section = style({ margin: "22px 0", paddingTop: 18, borderTop: "1px solid #e4e6db" });
export const subheading = style({ fontSize: 14, fontWeight: 600, marginBottom: 12 });
export const fieldset = style({ border: 0, padding: 0, margin: 0, minWidth: 0 });
export const textarea = style([input, { resize: "vertical", minHeight: 66, lineHeight: 1.6 }]);
export const expressions = style({
  display: "grid",
  gridTemplateColumns: "repeat(3,minmax(0,1fr))",
  gap: 12,
  "@media": { "(max-width: 500px)": { gridTemplateColumns: "repeat(2,minmax(0,1fr))" } },
});
export const line = style({ paddingBottom: 12 });
export const saveBar = style({
  position: "sticky",
  bottom: 0,
  background: "#fffdf8",
  padding: "14px 0",
  display: "flex",
  flexWrap: "wrap",
  alignItems: "center",
  gap: 12,
  borderTop: "1px solid #e4e6db",
  marginTop: 18,
});
export const preview = style({
  padding: "16px 0",
  display: "flex",
  flexDirection: "column",
  gap: 12,
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
});
export const notice = style({
  margin: "12px 0",
  padding: "12px 14px",
  background: "#f1f4e9",
  fontSize: 12,
  lineHeight: 1.7,
});
