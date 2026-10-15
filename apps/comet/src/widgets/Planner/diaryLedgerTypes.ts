import type { IconName } from "@comet/icon";
import type { LedgerCategory as LedgerColor } from "@comet/ui";

export type LedgerEntry = {
  id: string;
  date: string;
  kind: "expense" | "income";
  amount: number;
  category: string;
  title: string;
  memo: string;
  recurringId?: string;
  occurrenceDate?: string;
};
export type RecurringExpense = {
  id: string;
  title: string;
  amount: number;
  category: string;
  estimated: boolean;
  frequency: "weekly" | "monthly" | "yearly" | "interval" | "months";
  interval: number;
  day: number;
  weekday: number;
  months: number[];
  startDate: string;
  endDate: string | null;
  weekend: "keep" | "before" | "after";
  autoRecord: boolean;
  enabled: boolean;
  recordedDates: string[];
};
export type DiaryLedgerCategory = { id: string; name: string; color: LedgerColor };
export type LedgerSettings = {
  monthlyBudget: number;
  includeRecurring: boolean;
  reminderEnabled: boolean;
  reminderOffsetDays: number;
  categories: DiaryLedgerCategory[];
};
export const LEDGER_CATEGORIES: DiaryLedgerCategory[] = [
  { id: "food", name: "식비", color: "food" },
  { id: "delivery", name: "배달", color: "delivery" },
  { id: "cafe", name: "카페", color: "cafe" },
  { id: "transport", name: "교통", color: "transport" },
  { id: "living", name: "생활", color: "living" },
  { id: "culture", name: "문화", color: "culture" },
  { id: "housing", name: "주거", color: "housing" },
  { id: "telecom", name: "통신", color: "telecom" },
  { id: "subscription", name: "구독", color: "subscription" },
  { id: "other", name: "기타", color: "living" },
];
export const LEDGER_ICONS: Record<LedgerColor, IconName> = {
  food: "bowl",
  delivery: "box",
  cafe: "cup2",
  transport: "car",
  living: "drink",
  culture: "film",
  housing: "home",
  telecom: "phone",
  subscription: "repeat",
};
export const DEFAULT_LEDGER_SETTINGS: LedgerSettings = {
  monthlyBudget: 0,
  includeRecurring: false,
  reminderEnabled: false,
  reminderOffsetDays: 1,
  categories: LEDGER_CATEGORIES,
};
export const MAX_LEDGER_AMOUNT = 100_000_000_000;
