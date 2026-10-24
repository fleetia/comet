import { Button, Checkbox, IconButton, Select, TextInput } from "@comet/ui";
import { Icon } from "@comet/icon";
import { useState, type DragEvent, type ReactElement, type ReactNode } from "react";
import { localDay, number, rows, text, type DataRecord, type ToolAction } from "../toolData";
import { PlannerTodoEmpty } from "./PlannerTodoEmpty";
import {
  dayDate,
  dueDay,
  dueLabel,
  frequencyRecords,
  inPeriod,
  moveDay,
  movePeriod,
  PERIODS,
  periodAnchor,
  periodCarryover,
  plannedDay,
  repeatLabel,
  ruleOf,
} from "./plannerData";
import * as s from "./planner.css";

/** Cards a column shows before folding the rest behind "N개 더 보기". */
const VISIBLE_CARDS = 6;
const PLAN_DRAG_TYPE = "application/x-comet-plan";
type BoardPeriod = (typeof PERIODS)[number][0];

const RELATIVE: Record<string, Record<number, string>> = {
  week: { [-1]: "지난주", 0: "이번 주", 1: "다음 주" },
  month: { [-1]: "지난달", 0: "이번 달", 1: "다음 달" },
  year: { [-1]: "작년", 0: "올해", 1: "내년" },
};

function offsetFromToday(period: string, anchor: string): number {
  const today = localDay();
  for (const offset of [-1, 0, 1]) {
    if (periodAnchor(period, movePeriod(today, period, offset)) === periodAnchor(period, anchor))
      return offset;
  }
  return Number.NaN;
}

function columnTitle(period: BoardPeriod, anchor: string): string {
  if (period === "someday") return "언젠가";
  const relative = RELATIVE[period][offsetFromToday(period, anchor)];
  if (relative) return relative;
  return periodRange(period, anchor);
}

function periodRange(period: BoardPeriod, anchor: string): string {
  if (period === "someday") return "날짜 없음";
  const start = dayDate(periodAnchor(period, anchor));
  if (period === "year") return `${start.getFullYear()}년`;
  if (period === "month") return `${start.getMonth() + 1}월`;
  const end = dayDate(moveDay(periodAnchor(period, anchor), 6));
  const endLabel =
    end.getMonth() === start.getMonth()
      ? `${end.getDate()}일`
      : `${end.getMonth() + 1}월 ${end.getDate()}일`;
  return `${start.getMonth() + 1}월 ${start.getDate()}일 – ${endLabel}`;
}

function shortDay(day: string): string {
  const date = dayDate(day);
  return `${date.getMonth() + 1}월 ${date.getDate()}일`;
}

/** The period plan tab: four period columns side by side, or the inbox list. */
export function PlannerPlans({
  period,
  anchors,
  planScope,
  shown,
  items,
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
  onAnchorChange,
  onVisibleListChange,
  onShowCompletedChange,
  onManageLists,
  onCheck,
  onEdit,
  onEnableTodo,
  draft,
  adding,
  onDraftChange,
  onAddingChange,
  onAdd,
}: {
  /** A board period selects the narrow-window tab; "inbox" shows the undated list instead. */
  period: string;
  /** The day each dated column is showing. */
  anchors: Record<string, string>;
  planScope: string;
  /** The inbox tasks after the list and completion filters. */
  shown: DataRecord[];
  /** Every task, to fill the columns and find unfinished work left in the previous period. */
  items: DataRecord[];
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
  onAnchorChange: (period: string, day: string) => void;
  onVisibleListChange: (listId: string) => void;
  onShowCompletedChange: (show: boolean) => void;
  onManageLists: () => void;
  onCheck: (item: DataRecord) => Promise<void>;
  onEdit: (item: DataRecord) => void;
  onEnableTodo: () => Promise<void>;
  /** The quick-add draft, shared with the column whose add field is open. */
  draft: string;
  adding: string | null;
  onDraftChange: (value: string) => void;
  onAddingChange: (period: string | null) => void;
  onAdd: (period: string) => Promise<void>;
}): ReactElement {
  const inbox = period === "inbox";
  const toolbar = (
    <div className={s.toolbar}>
      {inbox ? (
        <Button variant="ghost" size="small" onClick={() => onPeriodChange("week")}>
          ‹ 기간별 보기
        </Button>
      ) : (
        <Button variant="ghost" size="small" onClick={() => onPeriodChange("inbox")}>
          수집함
        </Button>
      )}
      <div className={s.spacer} />
      <div className={s.listSelect}>
        <Select
          fill
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
      </div>
      <Checkbox
        checked={showCompleted}
        onChange={(e) => onShowCompletedChange(e.target.checked)}
        label="완료 포함"
      />
      {!headerActions && (
        <Button variant="ghost" size="small" onClick={onManageLists}>
          목록 관리
        </Button>
      )}
    </div>
  );
  if (!hasTodo) {
    return <PlannerTodoEmpty installed={todoInstalled} busy={busy} onEnable={onEnableTodo} />;
  }
  if (inbox) {
    return (
      <>
        {toolbar}
        {quickInput}
        <h2 className={s.heading}>
          {planScope} · 표시 {shown.length}개
        </h2>
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
                    {[dueLabel(item) || "기한 없음", repeatLabel(item)].filter(Boolean).join(" · ")}
                  </td>
                  <td>
                    <TodayButton item={item} busy={busy} act={act} />
                  </td>
                  <td>
                    <Button
                      variant="ghost"
                      size="small"
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
    );
  }
  const columnItems = (key: BoardPeriod): DataRecord[] =>
    items.filter(
      (item) =>
        inPeriod(item, key, anchors[key] ?? localDay()) &&
        (visibleList === "all" || item.listId === visibleList) &&
        (showCompleted || typeof item.completedAt !== "number"),
    );
  function moveTo(key: BoardPeriod, event: DragEvent): void {
    const id = event.dataTransfer.getData(PLAN_DRAG_TYPE);
    if (!id || busy) return;
    event.preventDefault();
    const source = items.find((item) => item.id === id);
    const anchor = key === "someday" ? null : periodAnchor(key, anchors[key] ?? localDay());
    if (!source || (source.planPeriod === key && (source.planAnchor ?? null) === anchor)) return;
    void act("plan", { ids: [id], date: null, planPeriod: key, planAnchor: anchor });
  }
  return (
    <>
      {toolbar}
      <div className={s.planTabs} role="group" aria-label="계획 기간">
        {PERIODS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={s.planTab}
            aria-pressed={period === key}
            onClick={() => onPeriodChange(key)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => moveTo(key, event)}
          >
            {label} · {columnItems(key).length}
          </button>
        ))}
      </div>
      <div className={s.planBoard}>
        {PERIODS.map(([key]) => (
          <PlanColumn
            key={key}
            period={key}
            anchor={anchors[key] ?? localDay()}
            current={period === key}
            items={columnItems(key)}
            allItems={items}
            busy={busy}
            act={act}
            onAnchorChange={onAnchorChange}
            onCheck={onCheck}
            onEdit={onEdit}
            onDrop={(event) => moveTo(key, event)}
            draft={adding === key ? draft : null}
            onDraftChange={onDraftChange}
            onAddingChange={(open) => onAddingChange(open ? key : null)}
            onAdd={() => onAdd(key)}
          />
        ))}
      </div>
      <p className={s.planHint}>
        <span className={s.planHintWide}>
          날짜를 정하면 날짜별 목록으로 옮겨 가요. 다른 칸으로 끌면 기간을 바꿔요.
        </span>
        <span className={s.planHintNarrow}>다른 기간으로 옮기려면 탭 위로 끌어 놓아요.</span>
      </p>
    </>
  );
}

function TodayButton({
  item,
  busy,
  act,
  label = "오늘에 넣기",
}: {
  item: DataRecord;
  busy: boolean;
  act: ToolAction;
  label?: string;
}): ReactElement {
  const today = plannedDay(item) === localDay();
  return (
    <Button
      variant="ghost"
      size="small"
      disabled={busy}
      onClick={() => void act("plan", { ids: [text(item.id)], date: today ? null : localDay() })}
    >
      {today ? "오늘에 있음" : label}
    </Button>
  );
}

function PlanColumn({
  period,
  anchor,
  current,
  items,
  allItems,
  busy,
  act,
  onAnchorChange,
  onCheck,
  onEdit,
  onDrop,
  draft,
  onDraftChange,
  onAddingChange,
  onAdd,
}: {
  period: BoardPeriod;
  anchor: string;
  /** The column the narrow window shows. */
  current: boolean;
  items: DataRecord[];
  allItems: DataRecord[];
  busy: boolean;
  act: ToolAction;
  onAnchorChange: (period: string, day: string) => void;
  onCheck: (item: DataRecord) => Promise<void>;
  onEdit: (item: DataRecord) => void;
  onDrop: (event: DragEvent) => void;
  /** The add field's text while it is open in this column. */
  draft: string | null;
  onDraftChange: (value: string) => void;
  onAddingChange: (open: boolean) => void;
  onAdd: () => Promise<void>;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState("");
  const title = columnTitle(period, anchor);
  const dated = period !== "someday";
  const carryover = periodCarryover(allItems, period, anchor);
  const visible = expanded ? items : items.slice(0, VISIBLE_CARDS);
  const hidden = items.length - visible.length;
  return (
    <section
      className={s.planColumn}
      data-current={current}
      aria-label={title}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onDrop}
    >
      <header className={s.planColumnHeader}>
        <h3 className={s.planColumnTitle}>{title}</h3>
        <div className={s.planColumnRange}>
          {dated && (
            <IconButton
              icon="chevleft"
              size="compact"
              variant="ghost"
              aria-label={`${title} 이전 기간`}
              onClick={() => onAnchorChange(period, movePeriod(anchor, period, -1))}
            />
          )}
          <span>{periodRange(period, anchor)}</span>
          {dated && (
            <IconButton
              icon="chev"
              size="compact"
              variant="ghost"
              aria-label={`${title} 다음 기간`}
              onClick={() => onAnchorChange(period, movePeriod(anchor, period, 1))}
            />
          )}
        </div>
      </header>
      {carryover && (
        <div className={s.carryover} role="status">
          <span>
            {carryover.label}에 못 한 일 {carryover.items.length}개
          </span>
          <Button
            variant="ghost"
            size="small"
            disabled={busy}
            onClick={() =>
              void act("plan", {
                ids: carryover.items.map((item) => text(item.id)),
                date: null,
                planPeriod: period,
                planAnchor: periodAnchor(period, anchor),
              })
            }
          >
            가져오기
          </Button>
        </div>
      )}
      {visible.map((item) => {
        const id = text(item.id);
        const done = typeof item.completedAt === "number";
        const frequency = ruleOf(item).mode === "frequency";
        const repeat = repeatLabel(item);
        return (
          <article
            key={id}
            className={s.planCard}
            data-selected={selected === id}
            draggable={!busy && !done}
            onDragStart={(event) => {
              event.dataTransfer.setData(PLAN_DRAG_TYPE, id);
              event.dataTransfer.effectAllowed = "move";
            }}
          >
            <div className={s.planCardRow}>
              <Checkbox
                shape="round"
                aria-label={text(item.title)}
                disabled={busy || (frequency && anchor > localDay())}
                checked={
                  frequency
                    ? rows(item.frequencyRecords).some((entry) => entry.date === anchor)
                    : done
                }
                onChange={() => void onCheck(item)}
              />
              <button
                type="button"
                className={s.planCardTitle}
                data-done={done}
                aria-label={`${text(item.title)} 선택`}
                aria-expanded={selected === id}
                onClick={() => setSelected((value) => (value === id ? "" : id))}
              >
                {text(item.title)}
              </button>
              <span className={s.planCardChips}>
                {frequency ? (
                  <span className={s.planChip}>
                    {frequencyRecords(item, anchor).length}/{number(ruleOf(item).timesPerWeek)}
                  </span>
                ) : (
                  dueDay(item) && <span className={s.planChip}>{shortDay(dueDay(item))}</span>
                )}
                {repeat && !frequency && (
                  <span className={s.planRepeat}>
                    <Icon name="repeat" size={12} />
                    {repeat}
                  </span>
                )}
              </span>
            </div>
            {selected === id && (
              <div className={s.planCardActions}>
                {!done && <TodayButton item={item} busy={busy} act={act} label="오늘 하기" />}
                <Button
                  variant="ghost"
                  size="small"
                  aria-label={`${text(item.title)} 편집`}
                  onClick={() => onEdit(item)}
                >
                  편집
                </Button>
              </div>
            )}
          </article>
        );
      })}
      {hidden > 0 && (
        <Button variant="link" size="small" onClick={() => setExpanded(true)}>
          {hidden}개 더 보기
        </Button>
      )}
      {expanded && items.length > VISIBLE_CARDS && (
        <Button variant="link" size="small" onClick={() => setExpanded(false)}>
          접기
        </Button>
      )}
      {draft !== null ? (
        <form
          className={s.planAdd}
          onSubmit={(event) => {
            event.preventDefault();
            void onAdd();
          }}
        >
          <TextInput
            fill
            autoFocus
            aria-label={`${title}에 추가할 할 일`}
            maxLength={500}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !draft.trim()) onAddingChange(false);
            }}
          />
          <Button type="submit" variant="ghost" size="small" disabled={busy || !draft.trim()}>
            추가
          </Button>
        </form>
      ) : (
        <button type="button" className={s.planAddButton} onClick={() => onAddingChange(true)}>
          <Icon name="plus" size={12} />
          {dated ? "이 기간에 하고 싶은 일" : "언젠가 하고 싶은 일"}
        </button>
      )}
    </section>
  );
}
