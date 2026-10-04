import {
  FormField,
  Rule,
  Button,
  Checkbox,
  DateField,
  Select,
  TextArea,
  TextField,
} from "@fleetia/lagrange";
import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import {
  localDay,
  number,
  record,
  rows,
  text,
  type DataRecord,
  type ToolAction,
} from "../toolData";
import type { WidgetView } from "../types";
import { WidgetDragHandle } from "../WidgetDragHandle";
import { deviceTimeZone, dueLabel, plannedDay, repeatLabel } from "../Planner/plannerData";
import * as c from "../../lagrange.css";
import * as s from "../tools.css";
import * as todo from "./todoTool.css";

type Props = { widget: WidgetView; act: ToolAction };
const repeatLabels: Record<string, string> = { daily: "매일", weekly: "매주", monthly: "매월" };
export function TodoTool({ widget, act }: Props): ReactElement {
  const d = record(widget.data),
    items = rows(d.items),
    lists = rows(d.lists);
  const titleInput = useRef<HTMLInputElement>(null);
  const options = useRef<HTMLDetailsElement>(null);
  const detailId = useId();
  const timeZoneId = useId();
  const completionPending = useRef(false);
  const [completing, setCompleting] = useState(false);
  const [completedNotice, setCompletedNotice] = useState<{
    id: string;
    title: string;
    revision: number;
  } | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [visibleList, setVisibleList] = useState("all");
  const [list, setList] = useState("default");
  const [listName, setListName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [memo, setMemo] = useState("");
  const [dueKind, setDueKind] = useState("none");
  const [due, setDue] = useState("");
  const [repeat, setRepeat] = useState("none");
  const [rollover, setRollover] = useState<string[]>([]);
  const [rollDate, setRollDate] = useState(localDay());
  const [rolloverError, setRolloverError] = useState<string | null>(null);
  const selectedOptions = [
    memo ? "메모 있음" : "",
    list !== "default" ? text(lists.find((item) => item.id === list)?.name) : "",
    dueKind !== "none" ? due.replace("T", " ") || "기한 선택 필요" : "",
    repeatLabels[repeat],
  ]
    .filter(Boolean)
    .join(" · ");
  function resetDraft(): void {
    setEditing(null);
    setTitle("");
    setMemo("");
    setList("default");
    setDueKind("none");
    setDue("");
    setRepeat("none");
    if (options.current) {
      options.current.open = false;
    }
  }
  function edit(item: DataRecord): void {
    if (options.current) {
      options.current.open = true;
    }
    titleInput.current?.focus();
    setEditing(text(item.id));
    setTitle(text(item.title));
    setMemo(text(item.memo));
    setList(text(item.listId));
    setRepeat(text(item.repeat));
    if (typeof item.dueAt === "number") {
      const date = new Date(item.dueAt);
      setDueKind("time");
      setDue(
        `${localDay(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`,
      );
    } else {
      setDueKind(item.dueDate ? "date" : "none");
      setDue(text(item.dueDate));
    }
  }
  async function changeCompletion(item: DataRecord): Promise<void> {
    if (completionPending.current) return;
    const completed = typeof item.completedAt === "number";
    completionPending.current = true;
    setCompleting(true);
    try {
      if (await act(completed ? "undo" : "complete", { id: text(item.id) })) {
        setCompletedNotice(
          completed
            ? null
            : { id: text(item.id), title: text(item.title), revision: widget.revision },
        );
      }
    } finally {
      completionPending.current = false;
      setCompleting(false);
    }
  }
  const lastCompleted = items.find((item) => item.id === completedNotice?.id);
  useEffect(() => {
    if (
      completedNotice &&
      widget.revision !== completedNotice.revision &&
      (!lastCompleted || typeof lastCompleted.completedAt !== "number")
    ) {
      setCompletedNotice(null);
    }
  }, [completedNotice, lastCompleted, widget.revision]);
  const shown = items.filter((item) => {
    if (visibleList !== "all" && item.listId !== visibleList) {
      return false;
    }
    switch (filter) {
      case "routine":
        return ["daily", "weekly", "monthly"].includes(text(item.repeat));
      case "today":
        return plannedDay(item) === localDay();
      case "shopping":
        return lists.some((l) => l.id === item.listId && text(l.name).includes("장보기"));
      case "wrap":
        return item.completedAt === null;
      default:
        return true;
    }
  });
  return (
    <div className={todo.root}>
      <form
        className={s.composer}
        onInvalidCapture={(event) => {
          if (event.target !== titleInput.current && options.current) {
            options.current.open = true;
          }
        }}
        onSubmit={async (e) => {
          e.preventDefault();
          const input = {
            title,
            memo,
            listId: list,
            repeat,
            dueDate: dueKind === "date" ? due : null,
            dueAt: dueKind === "time" ? new Date(due).getTime() : null,
          };
          if (await act(editing ? "update" : "add", editing ? { ...input, id: editing } : input)) {
            setEditing(null);
            setTitle("");
            setMemo("");
            setDue("");
            setDueKind("none");
          }
        }}
      >
        {editing && <h2 className={s.sectionTitle}>할 일 수정</h2>}
        <div className={s.actions}>
          <div className={todo.titleField}>
            <TextField
              aria-label="할 일 제목"
              placeholder="할 일 추가"
              required
              ref={titleInput}
              maxLength={500}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className={s.actions}>
            <Button
              type="submit"
              variant="primary"
              aria-label={editing ? "변경 저장" : "할 일 추가"}
            >
              {editing ? "변경 저장" : "추가"}
            </Button>
            {editing && (
              <Button type="button" variant="secondary" onClick={resetDraft}>
                수정 취소
              </Button>
            )}
          </div>
        </div>
        <details ref={options} className={s.disclosure}>
          <summary>
            메모 · 목록 · 기한 · 반복
            {selectedOptions && <span className={s.optionSummary}>{selectedOptions}</span>}
          </summary>
          <FormField className={c.field} label="메모">
            <TextArea maxLength={20000} value={memo} onChange={(e) => setMemo(e.target.value)} />
          </FormField>
          <FormField className={c.field} label="목록">
            <Select value={list} onChange={(e) => setList(e.target.value)}>
              {lists.map((item) => (
                <option key={text(item.id)} value={text(item.id)}>
                  {text(item.name)}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField className={c.field} label="기한 종류">
            <Select
              value={dueKind}
              onChange={(e) => {
                setDueKind(e.target.value);
                setDue("");
              }}
            >
              <option value="none">기한 없음</option>
              <option value="date">날짜만</option>
              <option value="time">내 지역 날짜와 시각</option>
            </Select>
          </FormField>
          {dueKind !== "none" && (
            <FormField className={c.field} label="기한" required>
              <TextField
                type={dueKind === "date" ? "date" : "datetime-local"}
                value={due}
                aria-describedby={dueKind === "time" ? timeZoneId : undefined}
                onChange={(e) => setDue(e.target.value)}
              />
            </FormField>
          )}
          {dueKind === "time" && (
            <p id={timeZoneId} className={c.quiet}>
              기기 시간대 {deviceTimeZone()} 기준
            </p>
          )}
          <FormField className={c.field} label="반복">
            <Select value={repeat} onChange={(e) => setRepeat(e.target.value)}>
              <option value="none">반복 없음</option>
              <option value="daily">매일</option>
              <option value="weekly">매주</option>
              <option value="monthly">매월</option>
            </Select>
          </FormField>
        </details>
      </form>
      <Rule variant="structural" />
      <div className={todo.toolbar}>
        <nav className={s.filters} aria-label="할 일 보기">
          {[
            ["all", "전체"],
            ["today", "오늘"],
            ["routine", "루틴"],
            ["shopping", "장보기"],
            ["wrap", "하루 마무리"],
          ].map(([value, label]) => (
            <Button
              variant="quiet"
              size="compact"
              className={s.filterButton}
              aria-pressed={filter === value}
              key={value}
              onClick={() => setFilter(value)}
            >
              {label}
            </Button>
          ))}
        </nav>
        <Select
          className={todo.listSelect}
          aria-label="조회할 목록"
          value={visibleList}
          onChange={(event) => setVisibleList(event.target.value)}
        >
          <option value="all">모든 목록</option>
          {lists.map((item) => (
            <option key={text(item.id)} value={text(item.id)}>
              {text(item.name)}
            </option>
          ))}
        </Select>
      </div>
      <p className={todo.count}>
        진행 중 {items.filter((item) => item.completedAt === null).length} · 완료{" "}
        {items.filter((item) => typeof item.completedAt === "number").length}
      </p>
      {completedNotice &&
        lastCompleted &&
        (widget.revision === completedNotice.revision ||
          typeof lastCompleted.completedAt === "number") && (
          <div className={todo.completionNotice}>
            <p role="status">{completedNotice.title} 완료했어요.</p>
            <Button
              variant="secondary"
              size="compact"
              disabled={completing || typeof lastCompleted.completedAt !== "number"}
              onClick={() => void changeCompletion(lastCompleted)}
            >
              완료 되돌리기
            </Button>
            <Button variant="quiet" size="compact" onClick={() => setCompletedNotice(null)}>
              알림 닫기
            </Button>
          </div>
        )}
      {shown.length === 0 && (
        <p className={c.quiet}>이 보기에 할 일이 없어요. 위에서 새 항목을 작성할 수 있어요.</p>
      )}
      {shown.map((item) => (
        <article className={todo.item} key={text(item.id)}>
          <div className={todo.itemMain}>
            <div className={todo.itemHeading}>
              <Checkbox
                aria-label={text(item.title)}
                aria-labelledby={undefined}
                title={typeof item.completedAt === "number" ? "완료 취소" : "완료하기"}
                checked={typeof item.completedAt === "number"}
                disabled={completing}
                onChange={() => void changeCompletion(item)}
              >
                {null}
              </Checkbox>
              <Button
                variant="quiet"
                size="compact"
                className={todo.itemTitle}
                data-completed={typeof item.completedAt === "number" || undefined}
                aria-label={`${text(item.title)} 상세 보기`}
                aria-expanded={expanded === item.id}
                aria-controls={`${detailId}-${text(item.id)}`}
                onClick={() => setExpanded(expanded === item.id ? null : text(item.id))}
              >
                {text(item.title)}
              </Button>
            </div>
            <div className={todo.itemActions}>
              <WidgetDragHandle
                payload={{ v: 1, kind: "todo", widgetId: widget.id, itemId: text(item.id) }}
                title={text(item.title)}
              />
              <Button variant="secondary" size="compact" onClick={() => edit(item)}>
                수정
              </Button>
              <Button
                variant="quiet"
                size="compact"
                onClick={() => void act("delete", { id: text(item.id) })}
              >
                삭제
              </Button>
            </div>
          </div>
          {expanded !== item.id && (
            <>
              {text(item.memo) && <p className={todo.memoPreview}>{text(item.memo)}</p>}
              <p className={todo.metadata}>
                계획 날짜 {plannedDay(item) || "미정"} · {dueLabel(item) || "기한 없음"}
                {typeof item.dueAt === "number" && ` · ${deviceTimeZone()} 기준`}
                {repeatLabel(item) && ` · ${repeatLabel(item)}`}
              </p>
            </>
          )}
          <section
            id={`${detailId}-${text(item.id)}`}
            aria-label={`${text(item.title)} 상세`}
            className={todo.detail}
            hidden={expanded !== item.id}
          >
            <dl className={todo.detailDates}>
              <dt>계획 날짜</dt>
              <dd>{plannedDay(item) || "미정"}</dd>
              <dt>기한</dt>
              <dd>
                {dueLabel(item) || "없음"}
                {typeof item.dueAt === "number" && ` · ${deviceTimeZone()} 기준`}
              </dd>
              <dt>목록</dt>
              <dd>{text(lists.find((entry) => entry.id === item.listId)?.name) || "할 일"}</dd>
              <dt>반복</dt>
              <dd>{repeatLabel(item) || "없음"}</dd>
            </dl>
            <p className={todo.memo}>{text(item.memo) || "메모 없음"}</p>
          </section>
          {filter === "wrap" && (
            <Checkbox
              checked={rollover.includes(text(item.id))}
              onChange={(e) =>
                setRollover((current) =>
                  e.target.checked
                    ? [...current, text(item.id)]
                    : current.filter((id) => id !== item.id),
                )
              }
            >
              이월할 항목 선택
            </Checkbox>
          )}
        </article>
      ))}
      {filter === "wrap" && (
        <form
          className={s.item}
          onSubmit={async (e) => {
            e.preventDefault();
            setRolloverError(null);
            const dueAtById: Record<string, number> = {};
            const [year, month, day] = rollDate.split("-").map(Number);
            for (const item of items.filter((entry) => rollover.includes(text(entry.id)))) {
              if (typeof item.dueAt !== "number") {
                continue;
              }
              const original = new Date(item.dueAt);
              const target = new Date(item.dueAt);
              target.setFullYear(year, month - 1, day);
              if (
                !Number.isFinite(target.getTime()) ||
                localDay(target) !== rollDate ||
                target.getHours() !== original.getHours() ||
                target.getMinutes() !== original.getMinutes()
              ) {
                setRolloverError(
                  "선택한 날짜에 같은 지역 시각이 존재하지 않습니다. 항목의 기한을 직접 수정해 주세요.",
                );
                return;
              }
              dueAtById[text(item.id)] = target.getTime();
            }
            if (await act("rollover", { ids: rollover, date: rollDate, dueAtById })) {
              setRollover([]);
            }
          }}
        >
          <FormField className={c.field} label="이월 날짜" required>
            <DateField value={rollDate} onChange={(e) => setRollDate(e.target.value)} />
          </FormField>
          <Button type="submit" variant="secondary" disabled={rollover.length === 0}>
            선택한 항목만 이월
          </Button>
          {rolloverError && (
            <p role="alert" className={c.error}>
              {rolloverError}
            </p>
          )}
        </form>
      )}
      <details className={s.disclosure}>
        <summary>목록 관리</summary>
        <form
          className={s.item}
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act("list-add", { name: listName })) {
              setListName("");
            }
          }}
        >
          <FormField className={c.field} label="새 목록 이름" required>
            <TextField
              maxLength={100}
              value={listName}
              onChange={(e) => setListName(e.target.value)}
            />
          </FormField>
          <Button type="submit" variant="secondary">
            목록 추가
          </Button>
        </form>
        {lists.map((item) => (
          <ListEditor
            key={text(item.id)}
            item={item}
            act={act}
            occupied={items.some((todo) => todo.listId === item.id)}
          />
        ))}
      </details>
      <p className={c.quiet}>
        완료 {items.filter((item) => typeof item.completedAt === "number").length}개 / 전체{" "}
        {number(items.length)}개
      </p>
    </div>
  );
}
function ListEditor({
  item,
  act,
  occupied,
}: {
  item: DataRecord;
  act: ToolAction;
  occupied: boolean;
}): ReactElement {
  const [name, setName] = useState(text(item.name));
  return (
    <form
      className={s.item}
      onSubmit={(e) => {
        e.preventDefault();
        void act("list-rename", { id: text(item.id), name });
      }}
    >
      <FormField className={c.field} label={<> {text(item.name)} 이름 </>} required>
        <TextField maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
      </FormField>
      <div className={s.row}>
        <Button type="submit" variant="secondary">
          이름 저장
        </Button>
        <Button
          variant="secondary"
          type="button"
          disabled={item.id === "default" || occupied}
          onClick={() => void act("list-delete", { id: text(item.id) })}
        >
          빈 목록 삭제
        </Button>
      </div>
    </form>
  );
}
