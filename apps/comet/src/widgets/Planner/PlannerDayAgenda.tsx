import type { ReactElement, ReactNode } from "react";
import { Button } from "../../ui";
import { text, type DataRecord } from "../toolData";
import type { WidgetView } from "../types";
import { eventTime } from "./plannerData";
import * as s from "./planner.css";

export function PlannerDayAgenda({
  day,
  calendar,
  connections,
  events,
  dailyEvents,
  event,
  lastSuccess,
  preparation,
  onSelectEvent,
  onOpenSettings,
}: {
  day: string;
  calendar: WidgetView | undefined;
  connections: DataRecord[];
  events: DataRecord[];
  dailyEvents: DataRecord[];
  event: DataRecord | undefined;
  lastSuccess: number;
  /** Preparation for the selected event. */
  preparation: ReactNode;
  onSelectEvent: (id: string) => void;
  onOpenSettings: () => void;
}): ReactElement {
  return (
    <aside className={s.column}>
      <h2 className={s.heading}>
        선택일 {day} 일정 · {dailyEvents.length}개
      </h2>
      {!calendar || (!connections.length && !events.length) ? (
        <div className={s.empty}>
          <p className={s.caption}>내 캘린더도 함께 볼 수 있어요.</p>
          <Button variant="secondary" size="compact" onClick={onOpenSettings}>
            캘린더 연결
          </Button>
          <p className={s.caption}>할 일은 계정 없이 사용할 수 있어요.</p>
        </div>
      ) : (
        <>
          {connections.some((c) => !["ready", "syncing"].includes(text(c.status))) && (
            <div role="status" className={s.error}>
              캘린더를 갱신하지 못했어요.
              <Button variant="quiet" size="compact" onClick={onOpenSettings}>
                연결 확인 ↗
              </Button>
            </div>
          )}
          {!dailyEvents.length && <p className={s.caption}>{day}에 조회된 일정이 없어요.</p>}
          {dailyEvents.map((e) => (
            <button
              type="button"
              key={text(e.id)}
              className={s.eventButton}
              aria-pressed={event?.id === e.id}
              onClick={() => onSelectEvent(text(e.id))}
            >
              <span className={s.caption}>{eventTime(e)}</span>
              <span>{text(e.title)}</span>
              <span className={s.caption}>
                {e.connectionId === "local"
                  ? "Comet"
                  : text(connections.find((c) => c.id === e.connectionId)?.name)}
              </span>
            </button>
          ))}
        </>
      )}
      {event && preparation}
      {lastSuccess > 0 && (
        <p className={s.caption}>
          마지막 확인 {new Date(lastSuccess).toLocaleString("ko-KR")} · 읽기 연결
        </p>
      )}
    </aside>
  );
}
