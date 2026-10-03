import { Button } from "@fleetia/lagrange";
import { useEffect, useState, type ReactElement } from "react";
import { text, type DataRecord } from "../toolData";
import { CalendarColors } from "./CalendarColors";
import {
  clockLabel,
  connectionsOutdated,
  dayDate,
  freeTimeCoverage,
  freeTimes,
  moveDay,
} from "./plannerData";
import * as s from "./diaryCalendarContext.css";

export function DiaryCalendarContext({
  day,
  events,
  connections,
  colors,
  busy,
  onColorChange,
  onOpenSettings,
}: {
  day: string;
  events: DataRecord[];
  connections: DataRecord[];
  colors: DataRecord;
  busy: boolean;
  onColorChange: (input: { connectionId: string; calendarId: string; color: string }) => void;
  onOpenSettings: () => void;
}): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(timer);
  }, []);
  const connectionIds = new Set(connections.map((connection) => text(connection.id)));
  const visibleEvents = events.filter(
    (event) =>
      !event.cancelled &&
      (event.connectionId === "local" || connectionIds.has(text(event.connectionId))),
  );
  const coverage = freeTimeCoverage(connections, day, now);
  const free = coverage === "covered" ? freeTimes(visibleEvents, day) : [];
  const dayEnd = new Date(`${moveDay(day, 1)}T00:00:00`).getTime();
  return (
    <details className={s.context}>
      <summary className={s.summary}>캘린더 정보</summary>
      <div className={s.body}>
        {connections.length === 0 ? (
          <p className={s.caption}>Comet에 저장한 일정은 외부 캘린더 연결 없이 사용할 수 있어요.</p>
        ) : (
          <>
            <ul className={s.connections} aria-label="캘린더 연결 상태">
              {connections.map((connection) => {
                const status = text(connection.status);
                const statusLabel =
                  status === "ready" && connectionsOutdated([connection], now)
                    ? "오래된 정보"
                    : {
                        ready: "조회 완료",
                        syncing: "조회 중",
                        stale: "이전 정보",
                        offline: "오프라인",
                        "auth-error": "다시 인증 필요",
                        "permission-needed": "권한 필요",
                      }[status] || "연결 확인 필요";
                return (
                  <li key={text(connection.id)}>
                    <strong className={s.heading}>{text(connection.name) || "캘린더"}</strong>
                    <p className={s.caption}>
                      {{ google: "Google Calendar", apple: "Apple 캘린더", ics: "ICS 구독" }[
                        text(connection.provider)
                      ] || "외부 캘린더"}{" "}
                      · {statusLabel}
                    </p>
                    <p className={s.caption}>
                      마지막 조회:{" "}
                      {typeof connection.lastSuccessAt === "number"
                        ? new Date(connection.lastSuccessAt).toLocaleString("ko-KR")
                        : "아직 없음"}
                    </p>
                    {text(connection.error) && (
                      <p role="status" className={s.caption}>
                        {text(connection.error)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
            <CalendarColors
              connections={connections}
              events={visibleEvents}
              colors={colors}
              disabled={busy}
              onChange={onColorChange}
            />
            <section aria-label="선택한 날짜 빈 시간">
              <h3 className={s.heading}>
                {dayDate(day).toLocaleDateString("ko-KR", { month: "long", day: "numeric" })} 빈
                시간
              </h3>
              {coverage !== "covered" ? (
                <p className={s.caption}>
                  {coverage === "outside"
                    ? "선택한 날짜는 조회 범위 밖이에요."
                    : "조회 정보가 오래됐거나 이 날짜 전체를 확인하지 못했어요."}{" "}
                  새로 조회하기 전에는 빈 시간을 판단하지 않아요.
                </p>
              ) : free.length ? (
                free.map(([start, end]) => (
                  <p className={s.caption} key={start}>
                    {clockLabel(start)} – {end === dayEnd ? "24:00" : clockLabel(end)}
                  </p>
                ))
              ) : (
                <p className={s.caption}>이 날짜에는 조회한 빈 시간이 없어요.</p>
              )}
              <p className={s.caption}>Comet 일정과 연결하여 조회한 캘린더를 기준으로 해요.</p>
            </section>
          </>
        )}
        <Button variant="quiet" size="compact" disabled={busy} onClick={onOpenSettings}>
          연결·알림 설정
        </Button>
      </div>
    </details>
  );
}
