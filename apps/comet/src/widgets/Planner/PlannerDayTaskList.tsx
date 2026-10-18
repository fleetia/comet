import { Button } from "@comet/ui";
import type { ReactElement, ReactNode } from "react";
import { localDay, text, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import { PlannerAlertNotice } from "../PlannerAlerts/PlannerAlerts";
import { PlannerTodoEmpty } from "./PlannerTodoEmpty";
import { repeatLabel } from "./plannerData";
import * as s from "./planner.css";

export function PlannerDayTaskList({
  day,
  allTasks,
  displayedTasks,
  lists,
  inboxCount,
  selectedTask,
  hasTodo,
  todoInstalled,
  calendar,
  busy,
  act,
  quickInput,
  taskActions,
  renderCheck,
  onToggleAllTasks,
  onOpenInbox,
  onEnableTodo,
  onTemplates,
  onSelectTask,
  onEdit,
}: {
  day: string;
  allTasks: boolean;
  displayedTasks: DataRecord[];
  lists: DataRecord[];
  inboxCount: number;
  selectedTask: string;
  hasTodo: boolean;
  todoInstalled: boolean;
  calendar: WidgetView | undefined;
  busy: boolean;
  act: ToolAction;
  quickInput: ReactNode;
  taskActions: ReactNode;
  renderCheck: (item: DataRecord) => ReactElement;
  onToggleAllTasks: () => void;
  onOpenInbox: () => void;
  onEnableTodo: () => Promise<void>;
  onTemplates: () => void;
  onSelectTask: (id: string) => void;
  onEdit: (item: DataRecord) => void;
}): ReactElement {
  return (
    <section
      className={s.column}
      aria-label={
        allTasks ? "모든 날짜 할 일" : day === localDay() ? "오늘 할 일" : "선택 날짜 할 일"
      }
    >
      <div className={s.actions}>
        <h2 className={s.heading}>
          {allTasks ? "모든 날짜 할 일" : `${day} 할 일`} · {displayedTasks.length}개
        </h2>
        <Button variant="ghost" size="small" aria-pressed={allTasks} onClick={onToggleAllTasks}>
          {allTasks ? "선택 날짜만 보기" : "모든 할 일 보기"}
        </Button>
        <div className={s.spacer} />
        <Button variant="ghost" size="small" onClick={onOpenInbox}>
          수집함 · 날짜 없음 · 미완료 {inboxCount}개
        </Button>
      </div>
      {!hasTodo ? (
        <PlannerTodoEmpty installed={todoInstalled} busy={busy} onEnable={onEnableTodo} />
      ) : (
        <>
          {quickInput}
          {!displayedTasks.length && (
            <div className={s.empty}>
              <p>
                {allTasks
                  ? "모든 날짜와 날짜 없는 항목에 저장한 할 일이 없어요."
                  : `${day}에 계획한 할 일이 없어요.`}
              </p>
              <Button variant="ghost" size="small" onClick={onTemplates}>
                템플릿에서 고르기
              </Button>
            </div>
          )}
          <div className={s.list}>
            {displayedTasks.map((item) => (
              <article
                key={text(item.id)}
                className={s.task}
                data-selected={selectedTask === item.id}
                onClick={() => onSelectTask(text(item.id))}
              >
                {renderCheck(item)}
                <span className={s.meta}>
                  {repeatLabel(item) || text(lists.find((l) => l.id === item.listId)?.name)}
                </span>
                <Button
                  variant="ghost"
                  size="small"
                  aria-label={`${text(item.title)} 편집`}
                  onClick={() => onEdit(item)}
                >
                  편집
                </Button>
              </article>
            ))}
          </div>
          {taskActions}
        </>
      )}
      {calendar && <PlannerAlertNotice widget={calendar} act={act} />}
    </section>
  );
}
