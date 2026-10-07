import { FormField, Button, DateField, Select, TextField } from "@fleetia/lagrange";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { localDay, record, rows, text, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
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
export { TimerTool } from "./FocusTimerTool";
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
    </>
  );
}

export function ClockSettings({ widget, act }: Pick<Props, "widget" | "act">): ReactElement {
  const d = record(widget.data);
  return (
    <FormField className={c.field} label="시계 형식">
      <Select
        value={text(d.format)}
        onChange={(e) => void act("configure", { format: e.target.value })}
      >
        <option value="24h">24시간</option>
        <option value="12h">12시간</option>
      </Select>
    </FormField>
  );
}
