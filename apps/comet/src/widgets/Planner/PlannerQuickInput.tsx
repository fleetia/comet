import { Button, MessageInput, SelectField, TextInput } from "@comet/ui";
import type { ReactElement } from "react";
import { Icon } from "@comet/icon";
import { localDay, text, type DataRecord } from "../toolData";
import { dayDate } from "./plannerData";
import * as s from "./planner.css";

export function PlannerQuickInput({
  isToday,
  embedded,
  day,
  period,
  planScope,
  title,
  busy,
  hasTodo,
  lists,
  quickList,
  onTitleChange,
  onDayChange,
  onListChange,
  onTemplates,
  onSubmit,
}: {
  isToday: boolean;
  embedded: boolean;
  day: string;
  period: string;
  planScope: string;
  title: string;
  busy: boolean;
  hasTodo: boolean;
  lists: DataRecord[];
  quickList: string;
  onTitleChange: (title: string) => void;
  onDayChange: (day: string) => void;
  onListChange: (listId: string) => void;
  onTemplates: () => void;
  onSubmit: () => Promise<void>;
}): ReactElement {
  const diaryQuickAdd = embedded && isToday;
  const Input = diaryQuickAdd ? MessageInput : TextInput;
  return (
    <>
      <p
        className={diaryQuickAdd ? s.visuallyHidden : s.caption}
        id={`planner-add-scope-${isToday ? "day" : "period"}`}
      >
        {isToday
          ? `새 할 일 계획일 · 선택일 ${day}`
          : `새 할 일 · ${planScope}${period === "inbox" ? "" : " · 계획일 없음"}`}
      </p>
      <form
        className={diaryQuickAdd ? s.diaryQuickAdd : s.quick}
        onSubmit={async (e) => {
          e.preventDefault();
          await onSubmit();
        }}
      >
        {diaryQuickAdd && <Icon name="plus" size={16} />}
        <div className={diaryQuickAdd ? s.diaryInput : s.grow}>
          <Input
            fill={!diaryQuickAdd}
            className={s.grow}
            aria-label="새 할 일"
            aria-describedby={`planner-add-scope-${isToday ? "day" : "period"}`}
            disabled={busy}
            placeholder={
              diaryQuickAdd
                ? "새 할 일 · Enter로 추가"
                : isToday
                  ? "할 일을 입력하고 Enter"
                  : period === "inbox"
                    ? "날짜 없이 할 일을 적어 보세요."
                    : "이 기간에 하고 싶은 일을 적어 보세요."
            }
            required
            maxLength={500}
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
          />
        </div>
        {diaryQuickAdd ? (
          <>
            <span className={s.diaryDate}>
              <span aria-hidden="true">
                {day === localDay()
                  ? "오늘"
                  : dayDate(day).toLocaleDateString("ko-KR", {
                      month: "numeric",
                      day: "numeric",
                    })}
                <Icon name="chevdown" size={12} />
              </span>
              <TextInput
                type="date"
                fill
                aria-label="새 할 일 계획일"
                value={day}
                disabled={busy}
                required
                onChange={(event) => {
                  if (event.target.value) onDayChange(event.target.value);
                }}
              />
            </span>
            <SelectField
              className={s.diaryList}
              controlSize={32}
              leading={<span className={s.diaryListDot} />}
              aria-label="새 할 일 목록"
              disabled={busy}
              value={quickList}
              onChange={(event) => onListChange(event.target.value)}
            >
              {lists.map((list) => (
                <option key={text(list.id)} value={text(list.id)}>
                  {text(list.name)}
                </option>
              ))}
            </SelectField>
            <Button className={s.diaryTemplate} variant="link" onClick={onTemplates}>
              템플릿에서 고르기
              <Icon name="arrowright" size={14} />
            </Button>
            <button type="submit" hidden disabled={busy || !hasTodo}>
              추가
            </button>
          </>
        ) : (
          <Button type="submit" variant="primary" disabled={busy || !hasTodo}>
            추가
          </Button>
        )}
      </form>
    </>
  );
}
