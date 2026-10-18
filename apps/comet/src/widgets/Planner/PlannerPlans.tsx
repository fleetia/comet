import type { ReactElement, ReactNode } from "react";
import { Button, Checkbox, Select } from "../../ui";
import { localDay, text, type DataRecord, type ToolAction } from "../toolData";
import { PlannerTodoEmpty } from "./PlannerTodoEmpty";
import {
  dueLabel,
  movePeriod,
  PERIODS,
  periodAnchor,
  plannedDay,
  repeatLabel,
} from "./plannerData";
import * as s from "./planner.css";

/** The period plan tab: tasks planned for a week, month, year, someday or the inbox. */
export function PlannerPlans({
  period,
  planDay,
  planScope,
  shown,
  lists,
  visibleList,
  showCompleted,
  hasTodo,
  todoInstalled,
  headerActions,
  busy,
  act,
  quickInput,
  renderCheck,
  onPeriodChange,
  onPlanDayChange,
  onVisibleListChange,
  onShowCompletedChange,
  onManageLists,
  onEdit,
  onEnableTodo,
}: {
  period: string;
  planDay: string;
  planScope: string;
  shown: DataRecord[];
  lists: DataRecord[];
  visibleList: string;
  showCompleted: boolean;
  hasTodo: boolean;
  todoInstalled: boolean;
  /** The diary header already offers list management. */
  headerActions: boolean;
  busy: boolean;
  act: ToolAction;
  quickInput: ReactNode;
  renderCheck: (item: DataRecord) => ReactElement;
  onPeriodChange: (period: string) => void;
  onPlanDayChange: (day: string) => void;
  onVisibleListChange: (listId: string) => void;
  onShowCompletedChange: (show: boolean) => void;
  onManageLists: () => void;
  onEdit: (item: DataRecord) => void;
  onEnableTodo: () => Promise<void>;
}): ReactElement {
  return (
    <>
      <div className={s.toolbar}>
        <div className={s.actions} role="group" aria-label="계획 기간">
          {[...PERIODS, ["inbox", "수집함"]].map(([key, label]) => (
            <Button
              key={key}
              variant="quiet"
              size="compact"
              className={s.categoryButton}
              aria-pressed={period === key}
              onClick={() => onPeriodChange(key)}
            >
              {label}
            </Button>
          ))}
        </div>
        <div className={s.spacer} />
        {!["someday", "inbox"].includes(period) && (
          <>
            <Button
              variant="quiet"
              size="compact"
              aria-label="이전 계획 기간"
              onClick={() => onPlanDayChange(movePeriod(planDay, period, -1))}
            >
              ‹
            </Button>
            <span className={s.caption}>{periodAnchor(period, planDay)}</span>
            <Button
              variant="quiet"
              size="compact"
              aria-label="다음 계획 기간"
              onClick={() => onPlanDayChange(movePeriod(planDay, period, 1))}
            >
              ›
            </Button>
          </>
        )}
      </div>
      {hasTodo ? (
        <>
          {quickInput}
          <div className={s.actions}>
            <Select
              className={s.listSelect}
              aria-label="조회할 목록"
              value={visibleList}
              onChange={(e) => onVisibleListChange(e.target.value)}
            >
              <option value="all">모든 목록</option>
              {lists.map((l) => (
                <option key={text(l.id)} value={text(l.id)}>
                  {text(l.name)}
                </option>
              ))}
            </Select>
            <Checkbox
              checked={showCompleted}
              onChange={(e) => onShowCompletedChange(e.target.checked)}
            >
              완료 포함
            </Checkbox>
            {!headerActions && (
              <Button variant="quiet" size="compact" onClick={onManageLists}>
                목록 관리
              </Button>
            )}
          </div>
          <h2 className={s.heading}>
            {planScope} · 표시 {shown.length}개
          </h2>
          <p className={s.caption}>
            {visibleList === "all"
              ? "모든 목록"
              : text(lists.find((list) => list.id === visibleList)?.name)}{" "}
            · {showCompleted ? "완료 포함" : "미완료만"}
          </p>
          <div style={{ overflow: "auto" }}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>할 일</th>
                  <th>목록</th>
                  <th>기한·반복</th>
                  <th>오늘 계획 · {localDay()}</th>
                  <th>
                    <span className={s.visuallyHidden}>편집</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {shown.map((item) => (
                  <tr key={text(item.id)}>
                    <td>{renderCheck(item)}</td>
                    <td className={s.caption}>
                      {text(lists.find((l) => l.id === item.listId)?.name)}
                    </td>
                    <td className={s.caption}>
                      {[dueLabel(item) || "기한 없음", repeatLabel(item)]
                        .filter(Boolean)
                        .join(" · ")}
                    </td>
                    <td>
                      <Button
                        variant={plannedDay(item) === localDay() ? "quiet" : "secondary"}
                        size="compact"
                        disabled={busy}
                        onClick={() =>
                          void act("plan", {
                            ids: [text(item.id)],
                            date: plannedDay(item) === localDay() ? null : localDay(),
                          })
                        }
                      >
                        {plannedDay(item) === localDay() ? "오늘에 있음" : "오늘에 넣기"}
                      </Button>
                    </td>
                    <td>
                      <Button
                        variant="quiet"
                        size="compact"
                        aria-label={`${text(item.title)} 편집`}
                        onClick={() => onEdit(item)}
                      >
                        편집
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!shown.length && (
              <p className={s.empty}>
                {planScope}에 표시할 할 일이 없어요. 위에서 하나씩 추가해 보세요.
              </p>
            )}
          </div>
        </>
      ) : (
        <PlannerTodoEmpty installed={todoInstalled} busy={busy} onEnable={onEnableTodo} />
      )}
    </>
  );
}
