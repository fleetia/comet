import type { ReactElement } from "react";
import { IconButton as CometIconButton, SidebarItem } from "@comet/ui";
import { WindowHeader } from "../../components/WindowHeader/WindowHeader";
import { localDay, type DataRecord } from "../toolData";
import type { DiaryTool, View } from "./diaryNavigation";
import * as s from "./diary.css";

export function DiaryRail({
  notesOpen,
  collection,
  tool,
  view,
  day,
  items,
  noteCount,
  envelopes,
  saving,
  onClose,
  onOpenDay,
  onOpenTool,
  onOpenNotes,
  onOpenEnvelopes,
  onOpenPages,
  onOpenSettings,
}: {
  notesOpen: boolean;
  collection: "pages" | "envelopes" | null;
  tool: DiaryTool | null;
  view: View;
  day: string;
  items: DataRecord[];
  noteCount: number;
  envelopes: DataRecord[];
  saving: boolean;
  onClose: () => void;
  onOpenDay: (date: string, view?: View) => void;
  onOpenTool: (tool: DiaryTool) => void;
  onOpenNotes: () => void;
  onOpenEnvelopes: () => void;
  onOpenPages: () => void;
  onOpenSettings: () => void;
}): ReactElement {
  return (
    <nav className={s.rail} aria-label="내 다이어리 목차">
      <WindowHeader
        nativeControls
        className={s.railHeader}
        label="다이어리 닫기"
        onClose={async () => onClose()}
      />
      <SidebarItem
        href="#today"
        icon="today"
        current={!notesOpen && !collection && !tool && view === "day"}
        onClick={(event) => {
          event.preventDefault();
          onOpenDay(localDay());
        }}
      >
        오늘
      </SidebarItem>
      <SidebarItem
        href="#calendar"
        icon="calendar"
        current={!notesOpen && !collection && !tool && view !== "day"}
        onClick={(event) => {
          event.preventDefault();
          onOpenDay(day, "month");
        }}
      >
        캘린더
      </SidebarItem>
      <SidebarItem
        href="#tasks"
        icon="todo"
        badge={items.filter((item) => item.completedAt === null).length || undefined}
        current={!notesOpen && tool === "today"}
        onClick={(event) => {
          event.preventDefault();
          onOpenTool("today");
        }}
      >
        할 일
      </SidebarItem>
      {(["habits", "ledger"] as const).map((section) => (
        <SidebarItem
          key={section}
          href={`#${section}`}
          icon={section === "habits" ? "habit" : "ledger"}
          current={!notesOpen && tool === section}
          onClick={(event) => {
            event.preventDefault();
            onOpenTool(section);
          }}
        >
          {section === "habits" ? "습관" : "가계부"}
        </SidebarItem>
      ))}
      <SidebarItem
        href="#notes"
        icon="memo"
        badge={noteCount || undefined}
        current={notesOpen}
        onClick={(event) => {
          event.preventDefault();
          onOpenNotes();
        }}
      >
        메모
      </SidebarItem>
      <SidebarItem
        href="#envelopes"
        icon="envelope"
        badge={envelopes.filter((value) => !value.archived).length || undefined}
        current={!notesOpen && collection === "envelopes"}
        onClick={(event) => {
          event.preventDefault();
          onOpenEnvelopes();
        }}
      >
        준비 봉투
      </SidebarItem>
      <span className={s.railDivider} />
      <SidebarItem
        href="#organizer"
        icon="organize"
        current={!notesOpen && tool === "organizer"}
        onClick={(event) => {
          event.preventDefault();
          onOpenTool("organizer");
        }}
      >
        정리 기록
      </SidebarItem>
      <SidebarItem
        href="#pages"
        icon="page"
        current={!notesOpen && collection === "pages"}
        onClick={(event) => {
          event.preventDefault();
          onOpenPages();
        }}
      >
        내 페이지
      </SidebarItem>
      <span className={s.spread} />
      <CometIconButton
        icon="gear"
        aria-label="연결·알림 설정"
        disabled={saving}
        onClick={onOpenSettings}
      />
    </nav>
  );
}
