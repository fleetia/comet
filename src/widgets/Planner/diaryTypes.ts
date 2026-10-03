import type { DataRecord } from "../toolData";

export type DiaryEntryKind = "note" | "todo" | "event" | "envelope" | "widget";

export type DiaryEntry = {
  id: string;
  kind: DiaryEntryKind;
  text: string;
  refId?: string;
  itemId?: string;
  time?: string;
};

export type DiaryPage = {
  id: string;
  title: string;
  date: string | null;
  entries: DiaryEntry[];
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
};

export type DiaryAction = (action: string, input?: DataRecord) => Promise<boolean>;
