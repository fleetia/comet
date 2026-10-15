import type { DataRecord } from "../toolData";
import type { DiaryTimeCategory, DiaryTimeRecord } from "./diaryTimeTypes";
import type { DiaryHabit, DiaryHabitCheck } from "./diaryHabitTypes";
import type { LedgerEntry, RecurringExpense, LedgerSettings } from "./diaryLedgerTypes";

export type DiaryEntryKind = "note" | "todo" | "event" | "envelope" | "widget";

export type DiaryEntry = {
  id: string;
  kind: DiaryEntryKind;
  text: string;
  refId?: string;
  itemId?: string;
  time?: string;
  recordDate?: string;
  rating?: number;
  review?: string;
  sourcePageId?: string;
  sourceEntryId?: string;
};

export type DiaryPage = {
  id: string;
  title: string;
  date: string | null;
  entries: DiaryEntry[];
  goalId?: string;
};

export type DiaryNote = {
  id: string;
  title: string;
  body: string;
  pinned: boolean;
  envelopeId?: string;
};

export type DiaryMove = {
  id: string;
  todoId: string;
  fromDate: string;
  toDate: string;
  title: string;
};

export type DiaryState = {
  revision: number;
  pages: DiaryPage[];
  notes: DiaryNote[];
  moves: DiaryMove[];
  timeRecords?: DiaryTimeRecord[];
  timeCategories?: DiaryTimeCategory[];
  habits?: DiaryHabit[];
  habitChecks?: DiaryHabitCheck[];
  habitFeedbackEnabled?: boolean;
  ledgerEntries?: LedgerEntry[];
  ledgerRecurring?: RecurringExpense[];
  ledgerSettings?: LedgerSettings;
};

export type DiaryAction = (action: string, input?: DataRecord) => Promise<boolean>;
