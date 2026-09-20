import { localDay, type DataRecord } from "../toolData";
import { dayDate, moveDay, periodAnchor } from "./plannerData";

export type TemplateItem = { title: string; repeatRule: DataRecord | null; offset?: number };
export type PlannerTemplate = {
  id: string;
  title: string;
  description: string;
  period: "week" | "month" | "year";
  items: TemplateItem[];
};
const weekly = (weekdays: number[], interval = 1): DataRecord => ({
  mode: "calendar",
  unit: "week",
  interval,
  weekdays,
  timeZone: "local",
});
const monthly = (monthlyMode = "day-of-month"): DataRecord => ({
  mode: "calendar",
  unit: "month",
  interval: 1,
  monthlyMode,
  timeZone: "local",
});
export const PLANNER_TEMPLATES: PlannerTemplate[] = [
  {
    id: "home",
    title: "집안일",
    description: "반복할 일만 골라 시작해 보세요.",
    period: "week",
    items: [
      { title: "빨래하기", repeatRule: weekly([2, 5]) },
      { title: "침구 세탁하기", repeatRule: weekly([6], 2) },
      { title: "냉장고 재료 확인하기", repeatRule: weekly([6]) },
      {
        title: "공기청정기 필터 확인하기",
        repeatRule: { mode: "completion", unit: "day", interval: 30, timeZone: "local" },
      },
      {
        title: "서랍 한 칸 정리하기",
        repeatRule: { ...monthly("nth-weekday"), nth: -1, weekday: 6 },
      },
    ],
  },
  {
    id: "health",
    title: "건강 관리",
    description: "횟수 목표와 정해진 날짜를 따로 관리해요.",
    period: "week",
    items: [
      {
        title: "20분 산책하기",
        repeatRule: {
          mode: "frequency",
          unit: "week",
          interval: 1,
          timesPerWeek: 3,
          timeZone: "local",
        },
      },
      {
        title: "가볍게 스트레칭하기",
        repeatRule: { mode: "calendar", unit: "day", interval: 1, timeZone: "local" },
      },
      { title: "건강검진 날짜 알아보기", repeatRule: null },
      {
        title: "잠들기 전 화면 내려놓기",
        repeatRule: { mode: "calendar", unit: "day", interval: 1, timeZone: "local" },
      },
      { title: "한 주 컨디션 돌아보기", repeatRule: weekly([6]) },
    ],
  },
  {
    id: "monthly",
    title: "월간 정리",
    description: "매월 확인할 일을 한곳에 모아 두세요.",
    period: "month",
    items: [
      { title: "영수증 정리하기", repeatRule: monthly("last-day") },
      { title: "생활비 사용 내역 살펴보기", repeatRule: monthly("last-day") },
      { title: "사진 백업하기", repeatRule: monthly() },
      { title: "안 쓰는 물건 세 개 정리하기", repeatRule: monthly() },
      { title: "다음 달 일정 살펴보기", repeatRule: monthly("last-day") },
    ],
  },
  {
    id: "yearly",
    title: "연간 관리",
    description: "자주 잊는 연간 일정을 필요한 만큼 등록해요.",
    period: "year",
    items: [
      {
        title: "건강검진 받기",
        repeatRule: { mode: "calendar", unit: "year", interval: 1, timeZone: "local" },
      },
      {
        title: "구독 서비스 정리하기",
        repeatRule: { mode: "calendar", unit: "year", interval: 1, timeZone: "local" },
      },
      {
        title: "비상 연락처 정리하기",
        repeatRule: { mode: "calendar", unit: "year", interval: 1, timeZone: "local" },
      },
      {
        title: "한 해 사진 모으기",
        repeatRule: { mode: "calendar", unit: "year", interval: 1, timeZone: "local" },
      },
      { title: "올해 하고 싶은 일 적기", repeatRule: null },
    ],
  },
  {
    id: "occasion",
    title: "기념일·여행",
    description: "기준 날짜를 바꾸면 준비 날짜도 함께 옮겨집니다.",
    period: "year",
    items: [
      { title: "선물 후보 적기", repeatRule: null, offset: -14 },
      { title: "예약 확인하기", repeatRule: null, offset: -7 },
      { title: "필요한 물건 챙기기", repeatRule: null, offset: -1 },
      { title: "축하 메시지 적기", repeatRule: null, offset: 0 },
      { title: "사진 모아 두기", repeatRule: null, offset: 1 },
    ],
  },
  {
    id: "study",
    title: "집중·학습",
    description: "작게 시작하고 정해 둔 횟수만큼 이어 가요.",
    period: "week",
    items: [
      {
        title: "읽던 책 한 장 읽기",
        repeatRule: { mode: "calendar", unit: "day", interval: 1, timeZone: "local" },
      },
      {
        title: "25분 집중하기",
        repeatRule: {
          mode: "frequency",
          unit: "week",
          interval: 1,
          timesPerWeek: 3,
          timeZone: "local",
        },
      },
      { title: "배운 것 세 줄 정리하기", repeatRule: weekly([4]) },
      { title: "다음 주 공부할 것 고르기", repeatRule: weekly([6]) },
      { title: "책 모임 질문 두 개 적기", repeatRule: null },
    ],
  },
];

function firstTemplateDate(item: TemplateItem, day: string): string {
  const date = moveDay(day, item.offset ?? 0);
  const rule = item.repeatRule;
  const start = dayDate(date);
  if (rule?.mode !== "calendar" || !Number.isFinite(start.getTime())) {
    return date;
  }
  if (rule.unit === "week" && Array.isArray(rule.weekdays)) {
    const weekday = (start.getDay() + 6) % 7;
    for (let offset = 0; offset < 7; offset += 1) {
      if (rule.weekdays.includes((weekday + offset) % 7)) {
        return moveDay(date, offset);
      }
    }
    return date;
  }
  if (rule.unit !== "month" || !["last-day", "nth-weekday"].includes(String(rule.monthlyMode))) {
    return date;
  }
  const nth = rule.nth;
  const weekday = rule.weekday;
  if (
    rule.monthlyMode === "nth-weekday" &&
    (typeof nth !== "number" ||
      !Number.isInteger(nth) ||
      (nth !== -1 && (nth < 1 || nth > 5)) ||
      typeof weekday !== "number" ||
      !Number.isInteger(weekday) ||
      weekday < 0 ||
      weekday > 6)
  ) {
    return date;
  }
  const month = dayDate(periodAnchor("month", date));
  for (let offset = 0; offset < 12; offset += 1) {
    const last = new Date(month);
    last.setMonth(last.getMonth() + 1);
    last.setDate(0);
    let candidate = last;
    if (
      rule.monthlyMode === "nth-weekday" &&
      typeof nth === "number" &&
      typeof weekday === "number"
    ) {
      if (nth === -1) {
        candidate.setDate(last.getDate() - ((((last.getDay() + 6) % 7) + 7 - weekday) % 7));
      } else {
        candidate = new Date(month);
        candidate.setDate(1 + ((weekday + 7 - ((month.getDay() + 6) % 7)) % 7) + 7 * (nth - 1));
      }
    }
    if (candidate.getMonth() === month.getMonth() && candidate >= start) {
      return localDay(candidate);
    }
    month.setMonth(month.getMonth() + 1);
  }
  return date;
}

export function templateItems(template: PlannerTemplate, day: string): DataRecord[] {
  return template.items.map((item) => {
    const date = firstTemplateDate(item, day);
    return {
      title: item.title,
      memo: "",
      repeat: "none",
      repeatRule: item.repeatRule,
      dueDate: date,
      dueAt: null,
      planPeriod: template.period,
      planAnchor: periodAnchor(template.period, date),
      plannedDate: null,
    };
  });
}
