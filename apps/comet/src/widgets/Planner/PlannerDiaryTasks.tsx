import { Button, TaskRow } from "@comet/ui";
import type { ReactElement, ReactNode } from "react";
import { localDay, number, rows, text, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import { PlannerAlertNotice } from "../PlannerAlerts/PlannerAlerts";
import { envelopeTitle } from "./DiaryEnvelope";
import { TaskReadOnlyDetails, type TodoEditorField } from "./TodoEditor";
import { PlannerTodoEmpty } from "./PlannerTodoEmpty";
import type { PlannerMovingTask } from "./PlannerMoveTaskDialog";
import { TODO_DRAG_TYPE, usePlannerTaskDrag } from "./usePlannerTaskDrag";
import {
  dayDate,
  deadlineChipLabel,
  frequencyRecords,
  isOverdue,
  plannedDay,
  repeatLabel,
  ruleOf,
} from "./plannerData";
import * as s from "./planner.css";

/** The diary's task tool: every Todo grouped by its plan date relative to the selected day. */
export function PlannerDiaryTasks({
  day,
  items,
  lists,
  envelopes,
  todo,
  calendar,
  busy,
  act,
  selectedTask,
  showCompleted,
  headerActions,
  inboxCount,
  quickInput,
  taskActions,
  onSelectTask,
  onToggleCompleted,
  onCheck,
  onEdit,
  onMoveTaskDate,
  onStartMove,
  onOpenInbox,
  onManageLists,
  onWrap,
}: {
  day: string;
  items: DataRecord[];
  lists: DataRecord[];
  envelopes: DataRecord[];
  todo: WidgetView | undefined;
  calendar: WidgetView | undefined;
  busy: boolean;
  act: ToolAction;
  selectedTask: string;
  showCompleted: boolean;
  /** The diary header already shows day close and list management. */
  headerActions: boolean;
  inboxCount: number;
  quickInput: ReactNode;
  /** Actions for the selected task, shown inside its expanded row. */
  taskActions: ReactNode;
  onSelectTask: (id: string) => void;
  onToggleCompleted: () => void;
  onCheck: (item: DataRecord) => Promise<void>;
  onEdit: (item: DataRecord, field?: TodoEditorField) => void;
  onMoveTaskDate: (item: DataRecord, toDate: string | null) => Promise<boolean>;
  onStartMove: (movingTask: PlannerMovingTask) => void;
  onOpenInbox: () => void;
  onManageLists: () => void;
  onWrap: () => void;
}): ReactElement {
  const { dragging, draggedTask } = usePlannerTaskDrag({ busy, todo, items });
  const completed = (item: DataRecord): boolean =>
    typeof item.completedAt === "number" ||
    (ruleOf(item).mode === "frequency" &&
      rows(item.frequencyRecords).some((entry) => entry.date === day));
  const open = items.filter((item) => !completed(item));
  const completedToday = items.filter((item) => completed(item) && plannedDay(item) === day);
  const done = items.filter((item) => completed(item) && plannedDay(item) !== day);
  const groups = [
    {
      title: "지난 계획",
      tasks: open.filter((item) => plannedDay(item) && plannedDay(item) < day),
    },
    {
      title: day === localDay() ? "오늘" : "선택한 날",
      tasks: [...open.filter((item) => plannedDay(item) === day), ...completedToday],
      date: day,
    },
    { title: "예정", tasks: open.filter((item) => plannedDay(item) > day) },
    { title: "날짜 없음", tasks: open.filter((item) => !plannedDay(item)) },
    ...(showCompleted ? [{ title: "완료한 일", tasks: done }] : []),
  ];
  return (
    <section className={s.diaryTasks} aria-label="모든 날짜 할 일">
      {todo ? (
        <>
          {quickInput}
          {groups
            .filter((group) => group.tasks.length || group.date || group.title === "날짜 없음")
            .map((group) => (
              <section
                className={s.diaryTaskGroup}
                key={group.title}
                aria-label={group.title === "완료한 일" ? group.title : `${group.title} 할 일`}
                onDragOver={(event) => {
                  if (draggedTask(event)) event.preventDefault();
                }}
                onDrop={(event) => {
                  const source = draggedTask(event);
                  if (!source || completed(source)) return;
                  event.preventDefault();
                  dragging.current = null;
                  if (group.date || group.title === "날짜 없음") {
                    void onMoveTaskDate(source, group.date || null);
                  } else {
                    onStartMove({ id: text(source.id), date: plannedDay(source) || day });
                  }
                }}
              >
                <div className={s.diaryGroupHeading}>
                  <h2 className={s.diaryGroupTitle}>
                    {group.title === "날짜 없음" ? (
                      <button
                        type="button"
                        className={s.diaryTaskTitle}
                        aria-label={`수집함 · 날짜 없음 · 미완료 ${inboxCount}개`}
                        onClick={onOpenInbox}
                      >
                        수집함
                      </button>
                    ) : (
                      group.title
                    )}
                  </h2>
                  <span className={s.diaryGroupMeta}>
                    {group.date &&
                      `${dayDate(group.date).toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "long" })} · `}
                    {group.title === "날짜 없음" ? "날짜 없음 · " : ""}
                    {group.date
                      ? group.tasks.filter((item) => !completed(item)).length
                      : group.tasks.length}
                    개{group.date ? " 남음" : ""}
                  </span>
                  {group.title === "날짜 없음" && (
                    <span className={s.diaryInboxHint}>빠른 실행에서 적은 것도 여기로 와요</span>
                  )}
                </div>
                {group.tasks.length ? (
                  <div className={s.diaryTaskCard}>
                    {group.tasks.map((item, index) => {
                      const envelope = envelopes.find(
                        (value) => Array.isArray(value.todoIds) && value.todoIds.includes(item.id),
                      );
                      const repeat = repeatLabel(item);
                      return (
                        <article
                          key={text(item.id)}
                          draggable={!busy}
                          onDragStart={(event) => {
                            if (!todo || busy) {
                              event.preventDefault();
                              return;
                            }
                            dragging.current = { id: text(item.id), widgetId: todo.id };
                            event.dataTransfer.setData(
                              TODO_DRAG_TYPE,
                              JSON.stringify(dragging.current),
                            );
                            event.dataTransfer.effectAllowed = "move";
                          }}
                          onDragEnd={() => {
                            dragging.current = null;
                          }}
                          onDragOver={(event) => {
                            const source = draggedTask(event);
                            if (source && completed(source) === completed(item)) {
                              event.preventDefault();
                              event.stopPropagation();
                            }
                          }}
                          onDrop={(event) => {
                            event.stopPropagation();
                            const source = draggedTask(event);
                            if (!source || completed(source) !== completed(item)) return;
                            event.preventDefault();
                            dragging.current = null;
                            if (source.id === item.id) return;
                            if (plannedDay(source) === plannedDay(item)) {
                              void act("reorder", {
                                id: text(source.id),
                                beforeId: text(item.id),
                              });
                            } else if (!completed(source)) {
                              void onMoveTaskDate(source, plannedDay(item) || null);
                            }
                          }}
                          onKeyDown={(event) => {
                            if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key))
                              return;
                            const peers = group.tasks.filter(
                              (peer) =>
                                plannedDay(peer) === plannedDay(item) &&
                                completed(peer) === completed(item),
                            );
                            const at = peers.indexOf(item);
                            const next = event.key === "ArrowUp" ? at - 1 : at + 1;
                            if (busy || next < 0 || next >= peers.length) return;
                            event.preventDefault();
                            void act("reorder", {
                              id: text(item.id),
                              beforeId:
                                event.key === "ArrowUp"
                                  ? text(peers[next].id)
                                  : peers[at + 2]
                                    ? text(peers[at + 2].id)
                                    : null,
                            });
                          }}
                        >
                          <TaskRow
                            layout="diary"
                            divider={index > 0}
                            title={
                              <button
                                type="button"
                                className={s.diaryTaskTitle}
                                aria-label={`${text(item.title)} 상세 보기`}
                                aria-expanded={selectedTask === item.id}
                                onClick={() => onSelectTask(text(item.id))}
                              >
                                {text(item.title)}
                              </button>
                            }
                            completionLabel={text(item.title)}
                            completed={completed(item)}
                            disabled={
                              busy || (ruleOf(item).mode === "frequency" && day > localDay())
                            }
                            onCompletedChange={() => void onCheck(item)}
                            selected={selectedTask === item.id}
                            description={text(item.memo).split(/\r?\n/)[0] || undefined}
                            due={
                              plannedDay(item) === day
                                ? group.title
                                : plannedDay(item) || "날짜 없음"
                            }
                            dueLabel={`${text(item.title)} 계획 날짜 바꾸기`}
                            onDueClick={() => onEdit(item, "plan")}
                            deadline={deadlineChipLabel(item, day) || undefined}
                            deadlineLabel={`${text(item.title)} 마감 바꾸기`}
                            onDeadlineClick={() => onEdit(item, "deadline")}
                            overdue={isOverdue(item)}
                            list={text(lists.find((list) => list.id === item.listId)?.name)}
                            repeat={
                              ruleOf(item).mode === "frequency"
                                ? `${repeat} · ${frequencyRecords(item, day).length}/${number(ruleOf(item).timesPerWeek)}회`
                                : repeat
                            }
                            envelope={envelope ? envelopeTitle(envelope) : undefined}
                          />
                          {selectedTask === item.id && (
                            <div className={s.diaryTaskDetails}>
                              <TaskReadOnlyDetails item={item} />
                              <Button
                                variant="ghost"
                                size="small"
                                aria-label={`${text(item.title)} 편집`}
                                onClick={() => onEdit(item)}
                              >
                                편집
                              </Button>
                              {taskActions}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                ) : (
                  <p className={s.diaryGroupMeta}>
                    {group.title === "날짜 없음"
                      ? "날짜 없이 남긴 할 일이 없어요."
                      : `${day}에 계획한 할 일이 없어요.`}
                  </p>
                )}
              </section>
            ))}
          <div className={s.diaryTaskFooter}>
            <Button variant="link" aria-expanded={showCompleted} onClick={onToggleCompleted}>
              {showCompleted ? "완료한 일 접기" : `완료한 일 ${done.length}개 보기`}
            </Button>
            <div className={s.spacer} />
            {!headerActions && (
              <Button variant="link" onClick={onManageLists}>
                목록 관리
              </Button>
            )}
            <button
              type="button"
              className={s.diaryDragHint}
              disabled={busy || !open.length}
              onClick={() => {
                const source = open.find((item) => item.id === selectedTask) || open[0];
                if (source) onStartMove({ id: text(source.id), date: plannedDay(source) || day });
              }}
            >
              날짜를 눌러 바꾸거나 끌어서 옮겨요
            </button>
          </div>
          {!headerActions && (
            <div className={s.actions}>
              <Button variant="ghost" size="small" onClick={onWrap}>
                하루 마무리
              </Button>
            </div>
          )}
        </>
      ) : (
        <PlannerTodoEmpty />
      )}
      {calendar && <PlannerAlertNotice widget={calendar} act={act} />}
    </section>
  );
}
