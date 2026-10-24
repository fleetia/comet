import { globalStyle, style, styleVariants } from "@vanilla-extract/css";
import { tokens } from "@comet/token";
import { stateTransition } from "../motion/motion.css";
import * as buttons from "../controls/button.css";

export const base = style({
  boxSizing: "border-box",
  color: tokens["color/ink"],
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 13,
  lineHeight: "18px",
  textAlign: "left",
  overflowWrap: "anywhere",
});
export const action = style([
  base,
  stateTransition,
  {
    appearance: "none",
    margin: 0,
    cursor: "pointer",
    textDecoration: "none",
    selectors: {
      "&:hover:not(:disabled)": { backgroundColor: tokens["color/hover"] },
      "&:active:not(:disabled)": { backgroundColor: tokens["color/pressed"] },
      "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
      "&:disabled": { opacity: 0.45, cursor: "not-allowed" },
    },
  },
]);
export const card = style([
  action,
  {
    display: "flex",
    flexDirection: "column",
    alignItems: "stretch",
    gap: 4,
    padding: "10px 12px",
    border: `1px solid ${tokens["color/card-border"]}`,
    borderRadius: tokens["radius/radius-14"],
    background: tokens["color/card"],
    maxWidth: "100%",
  },
]);
export const selected = style({
  background: tokens["color/selected"],
  borderColor: tokens["color/selected-border"],
  selectors: {
    "&:hover:not(:disabled)": {
      backgroundColor: tokens["color/component/selected-icon-alpha-230"],
    },
    "&:active:not(:disabled)": {
      backgroundColor: tokens["color/component/selected-icon-alpha-310"],
    },
  },
});
export const transparent = style({ background: "transparent", borderColor: "transparent" });
export const title = style({ fontSize: 14, fontWeight: 600, lineHeight: "19px", minWidth: 0 });
export const body = style({ fontSize: 12.5, lineHeight: "17px", color: tokens["color/ink-2"] });
export const caption = style({ fontSize: 12, lineHeight: "16px", color: tokens["color/ink-2"] });
export const meta = style({ fontSize: 11.5, lineHeight: "15px", color: tokens["color/ink-3"] });
export const muted = style({ color: tokens["color/ink-3"] });
export const danger = style({ color: tokens["color/danger"], fontWeight: 600 });
export const grow = style({ flex: 1, minWidth: 0 });
export const heading = style({ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 });
export const row = style({ display: "flex", alignItems: "center", gap: 10, minWidth: 0 });
export const column = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "stretch",
  gap: 2,
  minWidth: 0,
});
export const wrap = style({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 });
export const noWrap = style({ whiteSpace: "nowrap", flexShrink: 0 });
export const note = style({ width: 320, gap: 4 });
export const notePreview = styleVariants({
  tagged: { width: 296 },
  plain: { width: 410, gap: 3, padding: "12px 14px", borderRadius: tokens["radius/radius-16"] },
});
export const tag = style({
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  alignSelf: "flex-start",
  flexShrink: 0,
  height: 24,
  padding: "0 10px",
  boxSizing: "border-box",
  fontSize: 12,
  lineHeight: "18px",
  borderRadius: tokens["radius/radius-12"],
  border: `1px solid ${tokens["color/chip-border"]}`,
  background: tokens["color/chip"],
  color: tokens["color/ink-2"],
});
export const tagVariants = styleVariants({
  desktop: {
    background: tokens["color/document/live-chip-background"],
    borderColor: tokens["color/document/live-chip-border"],
    color: tokens["color/document/live-chip-label"],
  },
  envelope: {
    height: 20,
    gap: 4,
    padding: "0 7px",
    border: "none",
    borderRadius: 10,
    background: tokens["color/component/byul-ink-alpha-140"],
    color: tokens["color/byul-ink"],
    fontSize: 11.5,
    lineHeight: "15px",
  },
  focus: {},
  saved: {
    background: tokens["color/document/live-chip-background"],
    borderColor: tokens["color/document/live-chip-border"],
    color: tokens["color/document/live-chip-label"],
  },
  reverted: {},
  conflict: {
    background: tokens["color/component/danger-alpha-100"],
    borderColor: tokens["color/danger-border"],
    color: tokens["color/cat-life"],
  },
  confirmation: {
    background: tokens["color/component/danger-alpha-100"],
    borderColor: tokens["color/danger-border"],
    color: tokens["color/cat-life"],
  },
});
export const envelope = style({ width: 280, padding: "12px 14px 4px", gap: 6, borderRadius: 16 });
export const envelopePreview = style({
  width: 276,
  minHeight: 77,
  padding: "10px 12px 5px",
  gap: 4,
  border: 0,
  borderRadius: 14,
  background: "transparent",
});
export const envelopeProgress = style({
  display: "flex",
  alignItems: "center",
  gap: 4,
  minHeight: 18,
  marginTop: -6,
});
export const envelopePercent = style({
  width: 32,
  flexShrink: 0,
  textAlign: "right",
  fontSize: 12,
  lineHeight: "16px",
  color: tokens["color/ink-3"],
});
export const archived = style({ color: tokens["color/ink-2"] });
export const progress = style({
  appearance: "none",
  display: "block",
  width: "100%",
  height: 4,
  border: 0,
  borderRadius: 2,
  overflow: "hidden",
  background: tokens["color/track"],
  selectors: {
    "&::-webkit-progress-bar": { background: tokens["color/track"] },
    "&::-webkit-progress-value": { background: tokens["color/byul-ink"], borderRadius: 2 },
    "&::-moz-progress-bar": { background: tokens["color/byul-ink"], borderRadius: 2 },
  },
});
export const archivedProgress = style({
  selectors: {
    "&::-webkit-progress-value": { background: tokens["color/ink-3"] },
    "&::-moz-progress-bar": { background: tokens["color/ink-3"] },
  },
});
export const organization = style({ width: 290, minHeight: 89 });
export const activity = style({ width: 276 });
export const character = style([
  base,
  { display: "flex", alignItems: "center", gap: 16, maxWidth: "100%", width: 335 },
]);
export const characterTitle = style({
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 22,
  lineHeight: "28px",
});
export const characterHalo = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 124,
  height: 124,
  flexShrink: 0,
  borderRadius: 62,
  background:
    "radial-gradient(circle, rgba(182,160,234,.3), rgba(182,160,234,.06) 62%, transparent 72%)",
});
export const characterFace = style({
  boxSizing: "border-box",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  border: "1px solid rgba(143,227,214,.5)",
  backdropFilter: "blur(8px)",
  background: "radial-gradient(circle at 50% 30%, rgba(38,51,111,.6), rgba(20,28,68,.38) 70%)",
  boxShadow: "0 0 15px rgba(119,217,202,.28), 0 0 0 rgba(119,217,202,.06)",
  color: tokens["color/ink"],
  fontFamily: tokens["typography/sans/body/fontFamily"],
});
export const characterSizes = styleVariants({
  large: { width: 78, height: 78, borderRadius: 23, fontSize: 16, letterSpacing: 0.32 },
  compact: { width: 32, height: 32, borderRadius: 10, fontSize: 9, letterSpacing: 0.18 },
  conversation: { width: 34, height: 34, borderRadius: 10, fontSize: 10, letterSpacing: 0.2 },
});
export const addCard = style([
  action,
  {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    width: 370.667,
    maxWidth: "100%",
    minHeight: 116,
    padding: 0,
    background: "transparent",
    border: `1.5px dashed ${tokens["color/card-border"]}`,
    borderRadius: 22,
  },
]);
export const customizeCard = style({ width: 366, minHeight: 160, borderRadius: 18 });
export const addIcon = style({
  boxSizing: "border-box",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: 54,
  height: 54,
  borderRadius: 26,
  border: `1px solid ${tokens["color/card-border"]}`,
  background: tokens["color/card"],
});
export const addTitle = style({
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 16,
});
export const addCopy = style({
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  gap: 10,
});
export const customizeCopy = style({ gap: 2 });
export const customizeIcon = style({ width: 42, height: 42, borderRadius: 20 });
export const customizeTitle = style({
  fontFamily: tokens["typography/sans/body/fontFamily"],
  fontSize: 14.5,
  fontWeight: 600,
});
export const iconTile = style({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  flexShrink: 0,
  width: 40,
  height: 40,
  borderRadius: 20,
  background: tokens["color/icon-tile"],
});
export const settingsLink = style([
  action,
  {
    display: "flex",
    alignItems: "center",
    gap: 14,
    width: 372,
    maxWidth: "100%",
    padding: "14px 16px",
    border: `1px solid ${tokens["color/card-border"]}`,
    borderRadius: 18,
    background: tokens["color/card"],
  },
]);
export const animationCard = style([
  card,
  {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    width: "max-content",
    minWidth: 178.5,
    minHeight: 62,
    padding: "8px 10px",
  },
]);
export const sourceLink = style([
  action,
  {
    display: "inline-flex",
    alignItems: "center",
    height: 22,
    padding: "0 8px",
    border: 0,
    borderRadius: 11,
    background: tokens["color/component/selected-icon-alpha-140"],
    color: tokens["color/selected-icon"],
    fontSize: 12,
    lineHeight: "16px",
  },
]);
export const recordEntry = style([
  base,
  {
    display: "flex",
    alignItems: "flex-start",
    gap: 14,
    width: 560,
    maxWidth: "100%",
    padding: "10px 10px 12px 16px",
    minHeight: 48,
    borderTop: `1px solid ${tokens["color/divider"]}`,
  },
]);
export const recordEntryLinked = style({ minHeight: 70, borderTop: 0 });
export const recordEntryReview = style({ minHeight: 67 });
export const recordEntryFill = style({
  width: "100%",
  paddingTop: 12,
  fontSize: 14,
  lineHeight: "20px",
});
export const recordEntryFirst = style({ borderTop: 0 });
export const date = style({
  width: 66,
  flexShrink: 0,
  color: tokens["color/ink-3"],
  fontSize: 12.5,
  lineHeight: "20px",
});
export const rating = style({
  display: "inline-flex",
  color: tokens["color/cat-record"],
  verticalAlign: "middle",
  gap: 1,
});
export const timeline = style([
  base,
  {
    display: "flex",
    alignItems: "flex-start",
    gap: 8,
    width: 538,
    maxWidth: "100%",
    minHeight: 38,
    padding: "8px 10px",
    borderTop: `1px solid ${tokens["color/divider"]}`,
  },
]);
export const timelineSelected = style({
  background: tokens["color/selected"],
  borderRadius: 12,
  paddingBottom: 12,
});
export const timelineMemo = style({ minHeight: 37, borderTop: 0 });
export const timelineTime = style({
  width: 62,
  flexShrink: 0,
  fontSize: 11.5,
  lineHeight: "18px",
  color: tokens["color/ink-3"],
});
export const timelineMark = style({
  color: tokens["color/selected-ink"],
  width: 16,
  flexShrink: 0,
  textAlign: "center",
  fontWeight: 700,
});
export const textAction = style([
  action,
  {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: 0,
    background: "transparent",
    border: 0,
    color: tokens["color/selected-icon"],
    whiteSpace: "nowrap",
  },
]);
export const quickAdd = style([
  base,
  {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: 540,
    maxWidth: "100%",
    height: 42,
    padding: "6px 7px 6px 9px",
    border: `1px solid ${tokens["color/input-border"]}`,
    borderRadius: 14,
    background: tokens["color/input"],
  },
]);
export const pageQuickAdd = style({
  width: "100%",
  height: 46,
  padding: "6px 8px 6px 16px",
  borderRadius: tokens["radius/radius-16"],
  fontSize: 14,
});
export const quickKind = style({
  appearance: "none",
  border: `1px solid ${tokens["color/card-border"]}`,
  borderRadius: 10,
  background: tokens["color/card"],
  color: "inherit",
  font: "inherit",
  height: 28,
  padding: "0 28px 0 12px",
  maxWidth: 160,
});
export const quickKindWrap = style({ position: "relative", display: "flex", alignItems: "center" });
export const kindChevron = style({ position: "absolute", right: 10, pointerEvents: "none" });
export const bareInput = style({
  flex: 1,
  minWidth: 0,
  width: "100%",
  boxSizing: "border-box",
  border: 0,
  outline: "none",
  background: "transparent",
  color: tokens["color/ink"],
  font: "inherit",
  selectors: {
    "&::placeholder": { color: tokens["color/component/placeholder"] },
    "&:focus-visible": { outline: `2px solid ${tokens["color/focus-ring"]}`, outlineOffset: 2 },
    "&:disabled": { cursor: "not-allowed", opacity: 0.45 },
  },
});
export const header = style([
  base,
  {
    display: "flex",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: 14,
    width: 760,
    maxWidth: "100%",
  },
]);
export const envelopeIcon = style([
  iconTile,
  {
    width: 48,
    height: 48,
    borderRadius: 16,
    background: tokens["color/component/byul-ink-alpha-150"],
    color: tokens["color/byul-ink"],
  },
]);
export const envelopeTitle = style({
  margin: 0,
  fontFamily: tokens["typography/display/title/fontFamily"],
  fontSize: 24,
  lineHeight: "30px",
  fontWeight: 400,
});
export const headerContent = style([column, { flex: "1 1 320px", gap: 4 }]);
export const headerProgress = style([row, { marginTop: 4, gap: 10 }]);
export const headerBar = style([progress, { width: 180, height: 6, borderRadius: 3 }]);
export const eventDot = style({
  display: "inline-block",
  width: 7,
  height: 7,
  borderRadius: 3,
  flexShrink: 0,
  background: tokens["color/event-comet"],
});
export const task = style([
  base,
  {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: 868,
    maxWidth: "100%",
    minHeight: 46,
    padding: "8px 12px",
    borderTop: `1px solid ${tokens["color/divider"]}`,
  },
]);
export const taskSelected = style({
  background: tokens["color/component/selected-icon-alpha-140"],
  borderRadius: 12,
});
export const taskDiary = style({ width: 1180, minHeight: 40, padding: "6px 12px" });
export const taskWithoutDivider = style({ borderTop: "none" });
export const taskEnvelope = style({
  width: "100%",
  minHeight: 40,
  gap: 10,
  padding: "6px 12px",
  selectors: { "&:first-child": { borderTop: 0 } },
});
export const taskText = style({ display: "flex", alignItems: "center", gap: 6, minWidth: 0 });
export const taskTitle = style({ fontSize: 14, lineHeight: "19px" });
export const taskDone = style({ textDecoration: "line-through", color: tokens["color/list-gray"] });
export const taskDue = style([
  caption,
  noWrap,
  { display: "inline-flex", alignItems: "center", gap: 4, color: tokens["color/list-gray"] },
]);
/** Resets a native button without touching size or color, so caption/danger rules still apply. */
export const taskPlainButton = style({
  border: 0,
  padding: 0,
  background: "transparent",
  fontFamily: "inherit",
  cursor: "pointer",
  selectors: {
    "&:disabled": { cursor: "default" },
    "&:focus-visible": {
      outline: `2px solid ${tokens["color/selected-icon"]}`,
      outlineOffset: 2,
      borderRadius: 4,
    },
  },
});
export const deadlineChip = style([
  caption,
  noWrap,
  {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    height: 22,
    padding: "0 8px",
    boxSizing: "border-box",
    border: `1px solid ${tokens["color/input-border"]}`,
    borderRadius: tokens["radius/radius-12"],
    color: tokens["color/ink-2"],
  },
]);
export const deadlineOverdue = style({
  borderColor: tokens["color/danger-border"],
  color: tokens["color/danger"],
  fontWeight: 600,
});
export const taskList = style([row, caption, { width: 74, gap: 6, flexShrink: 0 }]);
export const taskRepeat = style([
  row,
  caption,
  { width: 104, gap: 4, flexShrink: 0, color: tokens["color/list-gray"] },
]);
export const listDot = style({
  display: "inline-block",
  width: 7,
  height: 7,
  borderRadius: 3,
  flexShrink: 0,
});
export const listColors = styleVariants({
  blue: { background: tokens["color/list-blue"] },
  coral: { background: tokens["color/list-coral"] },
  green: { background: tokens["color/list-green"] },
  violet: { background: tokens["color/list-violet"] },
  pink: { background: tokens["color/list-pink"] },
  yellow: { background: tokens["color/list-yellow"] },
  gray: { background: tokens["color/list-gray"] },
});
export const settingsRow = style([
  action,
  {
    display: "flex",
    alignItems: "center",
    gap: 10,
    height: 46,
    width: 202,
    maxWidth: "100%",
    padding: "0 14px",
    border: `1px solid ${tokens["color/card-border"]}`,
    borderRadius: 14,
    background: tokens["color/card"],
    fontSize: 13.5,
  },
]);
export const controlRow = style([
  base,
  {
    display: "flex",
    alignItems: "center",
    gap: 14,
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    minHeight: 59,
    padding: "11px 16px",
    borderTop: `1px solid ${tokens["color/divider"]}`,
  },
]);
export const settingControl = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  flex: "0 1 auto",
  minWidth: 0,
  maxWidth: "50%",
});
export const manageRow = style([
  base,
  {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: 516,
    maxWidth: "100%",
    minHeight: 47,
    padding: "8px 12px",
    borderTop: `1px solid ${tokens["color/divider"]}`,
  },
]);
export const manageInput = style([
  bareInput,
  {
    height: 30,
    padding: "0 10px",
    flex: "0 1 160px",
    border: `1px solid ${tokens["color/input-border"]}`,
    borderRadius: 9,
    background: tokens["color/input"],
  },
]);
export const colorAction = style([
  action,
  { width: 22, height: 22, padding: 0, border: 0, borderRadius: 11, flexShrink: 0 },
]);
export const contentChoice = style([
  action,
  {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: 332,
    maxWidth: "100%",
    minHeight: 57,
    padding: "10px 12px",
    border: `1px solid ${tokens["color/card-border"]}`,
    borderRadius: 14,
    background: tokens["color/card"],
  },
]);
export const choiceLayouts = styleVariants({
  character: {},
  memory: { borderRadius: 16, paddingRight: 14 },
  scene: {},
  story: { width: 208, minHeight: 55, padding: "9px 12px" },
  location: {
    width: 241.333,
    minHeight: 61,
    alignItems: "flex-start",
    gap: 10,
    padding: "12px 14px",
    borderRadius: 16,
  },
  reference: {
    width: 268,
    minHeight: 40,
    gap: 10,
    padding: "4px 10px",
    borderRadius: 11,
    background: "transparent",
    borderColor: "transparent",
  },
  conversation: {
    width: 312,
    minHeight: 60,
    alignItems: "flex-start",
    gap: 10,
    background: "transparent",
    borderColor: "transparent",
  },
  "organizer-record": {
    width: 276,
    flexDirection: "column",
    alignItems: "stretch",
    gap: 4,
    padding: "10px 12px",
  },
  launcher: {
    width: 608,
    minHeight: 54,
    padding: "7px 12px",
    background: "transparent",
    borderColor: "transparent",
  },
});
export const organizerHeading = style({
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 8,
  minWidth: 0,
});
export const choiceSelected = style({
  background: tokens["color/component/selected-icon-alpha-140"],
  borderColor: tokens["color/selected-border"],
  selectors: {
    "&:hover:not(:disabled)": {
      backgroundColor: tokens["color/component/selected-icon-alpha-230"],
    },
    "&:active:not(:disabled)": {
      backgroundColor: tokens["color/component/selected-icon-alpha-310"],
    },
  },
});
export const radioMark = style({
  width: 20,
  height: 20,
  boxSizing: "border-box",
  flexShrink: 0,
  border: `1.5px solid ${tokens["color/ink-3"]}`,
  borderRadius: 10,
});
export const radioMarkSelected = style({ border: `6px solid ${tokens["color/cat-record"]}` });
export const contentRow = style([
  action,
  {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: 708,
    maxWidth: "100%",
    minHeight: 56,
    padding: "10px 14px",
    border: `1px solid ${tokens["color/card-border"]}`,
    borderRadius: 14,
    background: tokens["color/card"],
  },
]);
export const contentRowLayouts = styleVariants({
  memory: {},
  story: { padding: "12px 16px", borderRadius: 18 },
  character: { width: 744, minHeight: 74, padding: "14px 16px", borderRadius: 18, gap: 14 },
  visitor: { width: 560, minHeight: 72, padding: "12px 16px", borderRadius: 18, gap: 14 },
  resource: {
    width: 410,
    minHeight: 40,
    gap: 10,
    padding: "6px 12px",
    background: "transparent",
    border: 0,
  },
  knowledge: {
    width: 744,
    border: 0,
    borderTop: `1px solid ${tokens["color/divider"]}`,
    borderRadius: 0,
    padding: "9px 14px",
  },
});
export const summary = style([
  action,
  {
    display: "flex",
    alignItems: "center",
    gap: 14,
    width: 744,
    maxWidth: "100%",
    minHeight: 74,
    padding: "12px 16px",
    border: `1px solid ${tokens["color/card-border"]}`,
    borderRadius: 18,
    background: tokens["color/card"],
  },
]);
export const summaryLayouts = styleVariants({
  badges: { padding: "14px 16px", minHeight: 80 },
  avatarCount: { width: 366 },
  categoryCount: {
    width: 320,
    minHeight: 41,
    padding: "11px 16px",
    gap: 10,
    background: "transparent",
    border: 0,
  },
  choice: { width: 332, minHeight: 61, gap: 12, padding: "12px 14px", borderRadius: 14 },
  status: {},
  compactIcon: {
    width: 332,
    minHeight: 45,
    gap: 12,
    padding: "4px 2px",
    background: "transparent",
    border: 0,
  },
  textAvatar: { width: 366 },
  plain: {
    minHeight: 56,
    gap: 12,
    padding: "9px 14px 9px 16px",
    background: "transparent",
    border: 0,
  },
  profile: { width: 366 },
  textCount: {
    minHeight: 59,
    padding: "11px 16px",
    background: "transparent",
    border: 0,
    borderTop: `1px solid ${tokens["color/divider"]}`,
    borderRadius: 0,
  },
  inline: { width: 322, minHeight: 37, gap: 12, padding: 0, background: "transparent", border: 0 },
});
export const summaryAction = style([
  buttons.button,
  buttons.sizes.small,
  buttons.variants.ghost,
  {
    width: 67,
    minWidth: 67,
    justifyContent: "center",
    gap: 7,
    paddingInline: 5,
    borderWidth: 0,
    boxShadow: `inset 0 0 0 1px ${tokens["color/card-border"]}`,
    fontSize: 13.5,
    fontWeight: 400,
  },
]);
globalStyle(`${summaryAction} > svg`, { flexShrink: 0 });
export const summaryTitle = style({ fontSize: 15, lineHeight: "20px", fontWeight: 600 });
export const gesture = style([
  action,
  {
    display: "grid",
    gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1fr) minmax(0,1fr) minmax(0,1.6fr)",
    alignItems: "center",
    gap: 10,
    width: 744,
    maxWidth: "100%",
    padding: "10px 16px",
    border: 0,
    background: "transparent",
  },
]);
export const sceneSummary = style([
  base,
  {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 30,
    padding: "0 12px",
    border: `1px solid ${tokens["color/chip-border"]}`,
    borderRadius: 15,
    background: tokens["color/chip"],
  },
]);
export const statusLink = style([
  action,
  {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: 0,
    border: 0,
    background: "transparent",
    color: tokens["color/cat-record"],
  },
]);
export const sidebar = style([
  action,
  {
    position: "relative",
    display: "inline-flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "center",
    gap: 5,
    width: 76,
    height: 58,
    padding: 0,
    border: 0,
    borderRadius: 14,
    background: "transparent",
    color: tokens["color/ink-2"],
    fontSize: 11,
    lineHeight: "14px",
  },
]);
export const sidebarSelected = style({
  background: tokens["color/component/selected-icon-alpha-140"],
  color: tokens["color/comet"],
  fontWeight: 600,
});
export const sidebarBadge = style({
  position: "absolute",
  right: 7,
  top: 2,
  minWidth: 18,
  height: 16,
  boxSizing: "border-box",
  padding: "0 4px",
  background: tokens["color/component/nav-badge"],
  borderRadius: 8,
  color: tokens["color/ink"],
  fontSize: 10.5,
  lineHeight: "16px",
  textAlign: "center",
});
export const profileLink = style([
  action,
  {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: 0,
    border: 0,
    background: "transparent",
    color: tokens["color/ink-2"],
  },
]);
export const profileAvatar = style({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 26,
  height: 26,
  flexShrink: 0,
  borderRadius: 13,
  background: tokens["color/component/nav-badge"],
  color: tokens["color/ink"],
  fontSize: 12,
});

export const timelineEventMark = style({ color: tokens["color/list-blue"] });
export const entryMenuButton = style({ width: 26, height: 26, borderRadius: 13, marginTop: -1 });
export const timelineMenuButton = style({ width: 24, height: 24, borderRadius: 12, marginTop: -3 });
export const animationTile = style([iconTile, { width: 44, height: 44, borderRadius: 12 }]);
export const animationTitle = style({ fontSize: 12.5, lineHeight: "16px" });
export const animationDescription = style({
  fontSize: 11,
  lineHeight: "14px",
  color: tokens["color/ink-3"],
});
export const checklistAdd = style([
  base,
  {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: 420,
    maxWidth: "100%",
    minHeight: 38,
    padding: "9px 12px",
    borderTop: `1px solid ${tokens["color/divider"]}`,
    color: tokens["color/ink-3"],
  },
]);

globalStyle(`${envelopePreview} > ${row}`, { minHeight: 21 });
globalStyle(`${envelopePreview} > ${envelopeProgress}`, { marginTop: 0 });
globalStyle(`${envelopePreview} > ${caption}`, {
  fontSize: 11.5,
  lineHeight: "15px",
  color: tokens["color/ink-3"],
});

globalStyle(`${envelopePreview} ${progress}::-webkit-progress-value`, { background: tokens["color/focus-ring"] });
globalStyle(`${envelopePreview} ${progress}::-moz-progress-bar`, { background: tokens["color/focus-ring"] });
