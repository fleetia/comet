import type { ReactElement } from "react";
import { IconButton as CometIconButton, SegmentedControl } from "@comet/ui";
import { Select } from "../../ui";
import type { DiaryPage } from "./diaryTypes";
import { isPlannerTool, TOOL_MENU, VIEWS, type DiaryTool, type View } from "./diaryNavigation";
import { moveDay, movePeriod } from "./plannerData";
import * as s from "./diary.css";

export function DiaryPageToolbar({
  tool,
  collection,
  view,
  day,
  pageId,
  envelopeId,
  heading,
  archived,
  pages,
  saving,
  onOpenDay,
  onOpenPage,
  onOpenTool,
  onChangeView,
  onArchivedChange,
  onPlannerHeader,
  onAdd,
}: {
  tool: DiaryTool | null;
  collection: "pages" | "envelopes" | null;
  view: View;
  day: string;
  pageId: string;
  envelopeId: string;
  heading: string;
  archived: boolean;
  pages: DiaryPage[];
  saving: boolean;
  onOpenDay: (date: string, view?: View) => void;
  onOpenPage: (page: DiaryPage) => void;
  onOpenTool: (tool: DiaryTool) => void;
  onChangeView: (view: View) => void;
  onArchivedChange: (archived: boolean) => void;
  onPlannerHeader: (element: HTMLDivElement | null) => void;
  onAdd: () => void;
}): ReactElement {
  return (
    <div
      className={s.pageNavigation}
      hidden={tool === "habits" || tool === "ledger"}
      data-tauri-drag-region
    >
      <div className={collection === "pages" ? s.pageHeading : s.toolbar}>
        {!tool && !pageId && !envelopeId && (
          <CometIconButton
            icon="chevleft"
            variant="surface"
            aria-label="이전 페이지"
            onClick={() =>
              onOpenDay(
                view === "month"
                  ? movePeriod(day, "month", -1)
                  : moveDay(day, view === "week" ? -7 : -1),
                view,
              )
            }
          />
        )}
        <h1 className={s.title} title={pageId ? heading : undefined}>
          {tool
            ? TOOL_MENU.find(([value]) => value === tool)?.[1]
            : envelopeId
              ? "준비 봉투"
              : heading}
        </h1>
        {!tool && !pageId && !envelopeId && (
          <CometIconButton
            icon="chev"
            variant="surface"
            aria-label="다음 페이지"
            onClick={() =>
              onOpenDay(
                view === "month"
                  ? movePeriod(day, "month", 1)
                  : moveDay(day, view === "week" ? 7 : 1),
                view,
              )
            }
          />
        )}
      </div>
      <div className={s.toolbar}>
        {collection === "envelopes" && (
          <SegmentedControl
            label="준비 봉투 분류"
            appearance="contained"
            value={archived ? "archived" : "preparing"}
            options={[
              { value: "preparing", label: "준비 중" },
              { value: "archived", label: "보관함" },
            ]}
            onValueChange={(value) => {
              onArchivedChange(value === "archived");
              document
                .getElementById(`envelope-group-${value}`)
                ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
            }}
          />
        )}
        {collection === "pages" && (
          <div className={s.pageSelect}>
            <Select
              aria-label="내 페이지 선택"
              value={pageId}
              onChange={(event) => {
                const selected = pages.find((value) => value.id === event.target.value);
                if (selected) onOpenPage(selected);
              }}
            >
              {!pageId && <option value="">페이지 선택</option>}
              {pages
                .filter((value) => !value.date)
                .map((value) => (
                  <option key={value.id} value={value.id}>
                    {value.title}
                  </option>
                ))}
            </Select>
          </div>
        )}
        {isPlannerTool(tool) && (
          <SegmentedControl
            label="할 일 보기"
            appearance="contained"
            value={tool}
            options={[
              { value: "today", label: "날짜별" },
              { value: "plans", label: "기간별" },
            ]}
            onValueChange={(value) => {
              if (value === "today" || value === "plans" || value === "templates") {
                onOpenTool(value);
              }
            }}
          />
        )}
        {isPlannerTool(tool) && <div ref={onPlannerHeader} />}
        {!tool && !pageId && !envelopeId && (
          <SegmentedControl
            label="다이어리 보기"
            appearance="contained"
            value={view}
            options={VIEWS.map(([value, label]) => ({ value, label }))}
            onValueChange={(value) => {
              if (value === "day" || value === "week" || value === "month") onChangeView(value);
            }}
          />
        )}
        {tool !== "habits" && tool !== "ledger" && tool !== "organizer" && (
          <CometIconButton
            icon="plus"
            variant="primary"
            aria-label={
              collection === "pages"
                ? "새 페이지"
                : collection === "envelopes"
                  ? "새 준비 봉투"
                  : !tool && view !== "day"
                    ? "새 일정"
                    : "빠른 할 일 추가"
            }
            disabled={saving}
            onClick={onAdd}
          />
        )}
      </div>
    </div>
  );
}
