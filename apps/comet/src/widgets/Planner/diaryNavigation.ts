import type { PlannerToolTab } from "./Planner";

export type View = "month" | "week" | "day";
export const VIEWS: [View, string][] = [
  ["day", "하루"],
  ["week", "주"],
  ["month", "월"],
];

export type DiaryTool = PlannerToolTab | "organizer" | "habits" | "ledger";
export function toolForTab(tab: string | null): DiaryTool | null {
  switch (tab) {
    case "todos":
      // The task tool uses "today" internally; the native "today" route is the diary summary.
      return "today";
    case "plans":
    case "templates":
    case "organizer":
    case "habits":
    case "ledger":
      return tab;
    default:
      return null;
  }
}
export function isPlannerTool(tool: DiaryTool | null): tool is PlannerToolTab {
  return tool === "today" || tool === "plans" || tool === "templates";
}
export const TOOL_MENU: [DiaryTool, string][] = [
  ["plans", "기간 계획"],
  ["templates", "템플릿"],
  ["today", "할 일"],
  ["organizer", "정리 기록"],
  ["habits", "습관"],
  ["ledger", "가계부"],
];
