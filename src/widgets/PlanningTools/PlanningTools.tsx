import { FormField, Button, DateField, Select, TextField } from "@fleetia/lagrange";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { localDay, number, record, rows, text, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import { WidgetAppearance } from "../WidgetAppearance/WidgetAppearance";
import * as c from "../../lagrange.css";
import * as s from "../tools.css";

type Props = { widget: WidgetView; widgets: WidgetView[]; act: ToolAction };
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
export function TimerTool({ widget, widgets, act }: Props): ReactElement {
  const d = record(widget.data),
    now = useNow();
  const [minutes, setMinutes] = useState("25"),
    [todoId, setTodoId] = useState("");
  const todo = widgets.find((item) => item.kind === "todo" && item.installed && item.enabled);
  const tasks = rows(record(todo?.data).items).filter((item) => item.completedAt === null);
  const remaining = Math.max(
    0,
    text(d.status) === "running" ? number(d.deadline) - now : number(d.remainingMs),
  );
  const seconds = Math.ceil(remaining / 1000);
  const linked = tasks.find((item) => item.id === d.todoId);
  return (
    <>
      <p className={s.number} aria-label="남은 시간">
        {String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}
      </p>
      <p className={s.status} role="status">
        {
          {
            idle: "시작할 준비가 됐어요.",
            running: "진행 중",
            paused: "일시정지",
            finished: "시간이 끝났어요. 계속할지 쉴지 골라 주세요.",
          }[text(d.status)]
        }
      </p>
      {text(d.status) === "idle" && (
        <form
          className={s.body}
          onSubmit={(e) => {
            e.preventDefault();
            void act("start", {
              durationMs: Math.round(Number(minutes) * 60000),
              todoId: todoId || null,
            });
          }}
        >
          <FormField className={c.field} label="집중 시간 (분)" required>
            <TextField
              type="number"
              min="0.02"
              max="1440"
              step="0.01"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </FormField>
          <FormField className={c.field} label="연결할 할 일 (선택)">
            <Select value={todoId} onChange={(e) => setTodoId(e.target.value)}>
              <option value="">연결하지 않음</option>
              {tasks.map((item) => (
                <option key={text(item.id)} value={text(item.id)}>
                  {text(item.title)}
                </option>
              ))}
            </Select>
          </FormField>
          <Button type="submit" variant="primary">
            집중 시작
          </Button>
        </form>
      )}
      <div className={s.row}>
        {text(d.status) === "running" && (
          <Button variant="primary" onClick={() => void act("pause")}>
            일시정지
          </Button>
        )}
        {text(d.status) === "paused" && (
          <Button variant="primary" onClick={() => void act("resume")}>
            다시 시작
          </Button>
        )}
        {text(d.status) === "finished" && (
          <>
            <Button variant="primary" onClick={() => void act("continue")}>
              계속 집중
            </Button>
            <Button variant="secondary" onClick={() => void act("rest")}>
              5분 쉬기
            </Button>
            {linked && todo && (
              <Button
                variant="secondary"
                onClick={() => void act("complete", { id: text(linked.id) }, todo)}
              >
                {text(linked.title)} 완료하기
              </Button>
            )}
          </>
        )}
        {text(d.status) !== "idle" && (
          <Button variant="secondary" onClick={() => void act("cancel")}>
            그만하기
          </Button>
        )}
      </div>
      <p className={c.quiet}>타이머가 끝나도 할 일은 자동 완료하지 않아요.</p>
    </>
  );
}
export function ClockTool({ widget, act }: Props): ReactElement {
  const d = record(widget.data),
    now = useNow();
  const titleInput = useRef<HTMLInputElement>(null);
  const [id, setId] = useState<string | null>(null),
    [title, setTitle] = useState(""),
    [date, setDate] = useState(localDay());
  const today = new Date(localDay(new Date(now)) + "T00:00:00Z").getTime();
  return (
    <>
      <time className={s.number}>
        {new Date(now).toLocaleTimeString(undefined, {
          hour12: d.format === "12h",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </time>
      <FormField className={c.field} label="시계 형식">
        <Select
          value={text(d.format)}
          onChange={(e) => void act("configure", { format: e.target.value })}
        >
          <option value="24h">24시간</option>
          <option value="12h">12시간</option>
        </Select>
      </FormField>
      {rows(d.anniversaries).map((item) => {
        const difference = Math.round(
          (Date.parse(text(item.date) + "T00:00:00Z") - today) / 86400000,
        );
        return (
          <article key={text(item.id)} className={s.item}>
            <h2 className={s.sectionTitle}>{text(item.title)}</h2>
            <p>
              {text(item.date)} ·{" "}
              {difference === 0 ? "D-day" : difference > 0 ? `D-${difference}` : `D+${-difference}`}
            </p>
            <div className={s.row}>
              <Button
                variant="secondary"
                onClick={() => {
                  titleInput.current?.focus();
                  setId(text(item.id));
                  setTitle(text(item.title));
                  setDate(text(item.date));
                }}
              >
                수정
              </Button>
              <Button variant="secondary" onClick={() => void act("delete", { id: text(item.id) })}>
                삭제
              </Button>
            </div>
          </article>
        );
      })}
      <form
        className={s.composer}
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act(id ? "update" : "add", id ? { id, title, date } : { title, date })) {
            setId(null);
            setTitle("");
          }
        }}
      >
        <h2 className={s.sectionTitle}>{id ? "기념일 수정" : "새 기념일"}</h2>
        <FormField className={c.field} label="기념일 이름" required>
          <TextField
            ref={titleInput}
            maxLength={500}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </FormField>
        <FormField className={c.field} label="기념일 날짜" required>
          <DateField value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <div className={s.actions}>
          <Button type="submit" variant="primary">
            {id ? "기념일 변경 저장" : "기념일 추가"}
          </Button>
          {id && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setId(null);
                setTitle("");
                setDate(localDay());
              }}
            >
              수정 취소
            </Button>
          )}
        </div>
      </form>
      <details className={s.disclosure}>
        <summary>바탕화면 표시 꾸미기</summary>
        <WidgetAppearance widget={widget} />
      </details>
    </>
  );
}
