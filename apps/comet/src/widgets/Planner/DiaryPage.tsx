import type { ReactElement } from "react";
import type { DataRecord } from "../toolData";
import type { WidgetView } from "../types";
import type { DiaryAction, DiaryEntry, DiaryMove, DiaryPage as Page } from "./diaryTypes";
import { DiaryPageAppointments } from "./DiaryPageAppointments";
import { DiaryPageRecords } from "./DiaryPageRecords";
import { getDiaryPageData } from "./diaryPageData";
import { useDiaryPageDraft } from "./useDiaryPageDraft";
import * as s from "./diaryPage.css";

export { discardDiaryPageDraft } from "./useDiaryPageDraft";

export type DiaryPageProps = {
  page?: Page;
  date: string;
  items: DataRecord[];
  events: DataRecord[];
  envelopes: DataRecord[];
  moves: DiaryMove[];
  busy: boolean;
  onDiaryAction: DiaryAction;
  onAddTask: (title: string) => Promise<string | null>;
  onToggleTask: (item: DataRecord) => void;
  onEditTask: (item: DataRecord) => void;
  onFocusTask?: (item: DataRecord) => void;
  onQueueTask?: (item: DataRecord) => void;
  onMoveTask: (item: DataRecord, toDate: string) => Promise<boolean>;
  onOpenEnvelope: (id: string) => void;
  onCreatePage: () => Promise<string | null>;
  onDirtyChange?: (dirty: boolean) => void;
  widgets?: WidgetView[];
  onOpenWidgetEntry?: (entry: DiaryEntry) => void;
  onOpenEvent?: (event: DataRecord) => void;
};

export function DiaryPage(props: DiaryPageProps): ReactElement {
  const draft = useDiaryPageDraft(props);
  const data = getDiaryPageData(props, draft.entries, draft.drafts);
  const { storageFailure, working, dirty } = draft;
  return (
    <section className={s.page} aria-label="다이어리 본문">
      {storageFailure && (
        <p role="alert" className={s.error}>
          이 기기에 초안을 임시 저장하지 못했어요. 앱을 닫기 전에 내용을 저장해 주세요.
        </p>
      )}
      <DiaryPageAppointments source={props} data={data} draft={draft} />
      <DiaryPageRecords source={props} data={data} draft={draft} />
      <footer className={s.footer}>
        <span role="status">
          {working ? "저장 중…" : dirty ? "저장하지 않은 내용이 있어요" : "모든 기록이 저장됐어요"}
        </span>
        <span>• 할 일　○ 일정　— 메모　→ 옮김</span>
      </footer>
    </section>
  );
}
