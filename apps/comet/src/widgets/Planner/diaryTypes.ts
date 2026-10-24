import type { DataRecord } from "../toolData";
import type { DiaryTimeCategory, DiaryTimeRecord } from "./diaryTimeTypes";
import type { DiaryHabit, DiaryHabitCheck } from "./diaryHabitTypes";
import type { LedgerEntry, RecurringExpense, LedgerSettings } from "./diaryLedgerTypes";
import type {
  Booking,
  Expense,
  Person,
  Photo,
  Transfer,
  Travel,
  TravelPlan,
  TravelSettings,
} from "../Travel/travelTypes";

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
  /** When the note was last pinned; recent pins sort first. */
  pinnedAt?: number;
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
  travels?: Travel[];
  travelPlans?: TravelPlan[];
  travelBookings?: Booking[];
  travelExpenses?: Expense[];
  travelPeople?: Person[];
  travelTransfers?: Transfer[];
  travelPhotos?: Photo[];
  travelSettings?: TravelSettings;
};

export type DiaryAction = (action: string, input?: DataRecord) => Promise<boolean>;
