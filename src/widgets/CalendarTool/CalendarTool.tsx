import {
  FormField,
  Button,
  Checkbox,
  DateField,
  Dialog,
  Rule,
  Select,
  TextArea,
  TextField,
} from "@fleetia/lagrange";
import { useEffect, useState, type ReactElement } from "react";
import { localDay, record, rows, text, type DataRecord, type ToolAction } from "../toolData";
import { useConnectionCommand } from "../useConnectionCommand";
import type { WidgetView } from "../types";
import * as c from "../../lagrange.css";
import * as s from "../tools.css";
function startOf(event: DataRecord): number {
  return typeof event.startAt === "number"
    ? event.startAt
    : Date.parse(text(event.startDate) + "T00:00:00");
}
function endOf(event: DataRecord): number {
  return typeof event.endAt === "number"
    ? event.endAt
    : Date.parse(text(event.endDate) + "T00:00:00");
}
function timeLabel(at: number): string {
  return new Date(at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
function freeTimes(events: DataRecord[], day: string): [number, number][] {
  const start = Date.parse(day + "T00:00:00"),
    next = new Date(start);
  next.setDate(next.getDate() + 1);
  const end = next.getTime();
  const busy = events
    .map((event): [number, number] => [
      Math.max(start, startOf(event)),
      Math.min(end, endOf(event)),
    ])
    .filter(([a, b]) => a < b)
    .sort((a, b) => a[0] - b[0]);
  const free: [number, number][] = [];
  let cursor = start;
  for (const [a, b] of busy) {
    if (cursor < a) {
      free.push([cursor, a]);
    }
    cursor = Math.max(cursor, b);
  }
  if (cursor < end) {
    free.push([cursor, end]);
  }
  return free;
}
export function CalendarTool({
  widget,
  act,
}: {
  widget: WidgetView;
  act: ToolAction;
}): ReactElement {
  const d = record(widget.data),
    connections = rows(d.connections);
  const connectedIds = new Set(connections.map((connection) => text(connection.id)));
  const events = rows(d.events).filter(
    (event) => event.cancelled !== true && connectedIds.has(text(event.connectionId)),
  );
  const { busy, error, run } = useConnectionCommand();
  const [now, setNow] = useState(Date.now()),
    [day, setDay] = useState(localDay()),
    [free, setFree] = useState(false);
  const [provider, setProvider] = useState("ics"),
    [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [clientId, setClientId] = useState(""),
    [clientSecret, setClientSecret] = useState(""),
    [calendarIds, setCalendarIds] = useState("primary");
  const [disconnect, setDisconnect] = useState<DataRecord | null>(null);
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60000);
    return () => window.clearInterval(interval);
  }, []);
  const beginning = Date.parse(day + "T00:00:00"),
    nextDay = new Date(beginning);
  nextDay.setDate(nextDay.getDate() + 1);
  const today = events
    .filter((event) => startOf(event) < nextDay.getTime() && endOf(event) > beginning)
    .sort((a, b) => startOf(a) - startOf(b));
  const next = events
    .filter((event) => startOf(event) >= now)
    .sort((a, b) => startOf(a) - startOf(b))[0];
  const dayMs = 86400000;
  const minDay = localDay(new Date(now - 30 * dayMs));
  const maxDay = localDay(new Date(now + 365 * dayMs));
  const outsideRange = day < minDay || day > maxDay;
  const outdated = connections.some(
    (connection) =>
      !["ready", "syncing"].includes(text(connection.status)) ||
      typeof connection.lastSuccessAt !== "number" ||
      connection.lastSuccessAt > now ||
      now - connection.lastSuccessAt > 30 * 60000,
  );
  const hasCoverage =
    !outsideRange &&
    !outdated &&
    connections.length > 0 &&
    connections.every(
      (connection) =>
        typeof connection.lastSuccessAt === "number" &&
        beginning >= connection.lastSuccessAt - 30 * dayMs &&
        nextDay.getTime() <= connection.lastSuccessAt + 365 * dayMs,
    );
  function card(event: DataRecord): ReactElement {
    return (
      <article className={s.item} key={text(event.id)}>
        <h2>{text(event.title)}</h2>
        <p className={s.data}>
          {event.allDay === true
            ? `종일 · ${text(event.startDate)}`
            : `${new Date(startOf(event)).toLocaleString()} – ${timeLabel(endOf(event))}`}
        </p>
        <div className={s.row}>
          {text(event.meetingUrl) && (
            <Button
              variant="primary"
              onClick={() =>
                void run("open_widget_link", { id: widget.id, url: text(event.meetingUrl) })
              }
            >
              회의 열기
            </Button>
          )}
          {text(event.url) && (
            <Button
              variant="secondary"
              onClick={() => void run("open_widget_link", { id: widget.id, url: text(event.url) })}
            >
              원본 일정 열기
            </Button>
          )}
        </div>
      </article>
    );
  }
  return (
    <fieldset className={s.body} disabled={busy}>
      {error && !disconnect && (
        <p role="alert" className={c.error}>
          {error}
        </p>
      )}
      {connections.length === 0 ? (
        <p>캘린더를 읽기 연결하면 오늘과 다음 일정을 볼 수 있어요.</p>
      ) : (
        <>
          {outdated && (
            <p className={c.error}>
              일부 연결이 최신 상태가 아닙니다. 아래 일정은 마지막 성공 정보를 포함합니다.
            </p>
          )}
          <FormField className={c.field} label="조회 날짜" required>
            <DateField
              min={minDay}
              max={maxDay}
              value={day}

              onChange={(e) => {
                if (e.target.value) {
                  setDay(e.target.value);
                }
              }}
            />
          </FormField>
          <Button
            variant={free ? "primary" : "secondary"}
            aria-pressed={free}
            onClick={() => setFree((current) => !current)}
          >
            {free ? "일정 보기" : "연결한 캘린더의 빈 시간 보기"}
          </Button>
          {!hasCoverage && (
            <p role="status" className={c.error}>
              {outsideRange
                ? "선택한 날짜는 조회 범위 밖입니다."
                : "조회 정보가 오래됐거나 이 날짜 전체를 확인하지 못했습니다."}{" "}
              새로 조회하기 전에는 빈 시간을 판단하지 않습니다.
            </p>
          )}
          {free && hasCoverage ? (
            <>
              <p className={c.quiet}>
                연결하여 조회한 캘린더만 기준으로 합니다. 다른 일정은 포함하지 않아요.
              </p>
              {freeTimes(events, day).map(([a, b]) => (
                <p key={a}>
                  {timeLabel(a)} – {b === nextDay.getTime() ? "24:00" : timeLabel(b)}
                </p>
              ))}
              {freeTimes(events, day).length === 0 && <p>이 날짜에는 조회한 빈 시간이 없어요.</p>}
            </>
          ) : (
            <>
              {!free && hasCoverage && today.length === 0 && <p>조회한 날짜에 일정이 없어요.</p>}
              {!free && today.map(card)}
            </>
          )}
          {next && (free || !today.some((event) => event.id === next.id)) && (
            <section className={s.section}>
              <h2 className={s.sectionTitle}>다음 일정</h2>
              {card(next)}
            </section>
          )}
        </>
      )}
      <CalendarAlerts data={record(d.reminders)} act={act} />
      <details className={s.disclosure} open={connections.length === 0}>
        <summary>캘린더 연결 관리</summary>
        {connections.map((connection) => (
          <section className={s.item} key={text(connection.id)}>
            <h2>{text(connection.name)}</h2>
            <p className={c.quiet}>
              {text(connection.provider) === "google" ? "Google Calendar" : "ICS 구독"} ·{" "}
              {{
                ready: "조회 완료",
                syncing: "조회 중",
                stale: "이전 정보",
                offline: "오프라인",
                "auth-error": "다시 인증 필요",
                "permission-needed": "권한 필요",
              }[text(connection.status)] || "연결 확인 필요"}
            </p>
            <p className={c.quiet}>
              마지막 성공:{" "}
              {typeof connection.lastSuccessAt === "number"
                ? new Date(connection.lastSuccessAt).toLocaleString()
                : "아직 없음"}
            </p>
            {text(connection.error) && <p className={c.error}>{text(connection.error)}</p>}
            <div className={s.row}>
              <Button
                variant="secondary"
                onClick={() =>
                  void run("refresh_calendar", { id: widget.id, connectionId: text(connection.id) })
                }
              >
                다시 조회
              </Button>
              <Button variant="secondary" onClick={() => setDisconnect(connection)}>
                연결 해제
              </Button>
            </div>
          </section>
        ))}
        <form
          className={s.composer}
          onSubmit={async (e) => {
            e.preventDefault();
            const input =
              provider === "ics"
                ? { name, url }
                : {
                    name,
                    clientId,
                    clientSecret: clientSecret || null,
                    calendarIds: calendarIds
                      .split(/[,\n]/)
                      .map((value) => value.trim())
                      .filter(Boolean),
                  };
            if (
              await run(provider === "ics" ? "connect_calendar_ics" : "connect_calendar_google", {
                id: widget.id,
                input,
              })
            ) {
              setUrl("");
              setClientSecret("");
              setName("");
            }
          }}
        >
          <FormField className={c.field} label="연결 방식">
            <Select value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="ics">ICS / webcal 구독</option>
              <option value="google">Google Calendar 읽기 연결</option>
            </Select>
          </FormField>
          <FormField className={c.field} label="연결 이름" required>
            <TextField maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
          </FormField>
          {provider === "ics" ? (
            <FormField className={c.field} label="ICS / webcal 구독 주소" required>
              <TextField
                type="url"

                autoComplete="off"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </FormField>
          ) : (
            <>
              <p className={c.quiet}>
                설정한 Google OAuth 데스크톱 클라이언트로 브라우저에서 읽기 권한을 승인합니다.
                캘린더를 수정하지 않아요.
              </p>
              <FormField className={c.field} label="Google OAuth 클라이언트 ID" required>
                <TextField
                  autoComplete="off"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                />
              </FormField>
              <FormField className={c.field} label="클라이언트 보안 비밀 (선택)">
                <TextField
                  type="password"
                  autoComplete="off"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                />
              </FormField>
              <FormField className={c.field} label="조회할 캘린더 ID (줄바꿈 또는 쉼표)" required>
                <TextArea value={calendarIds} onChange={(e) => setCalendarIds(e.target.value)} />
              </FormField>
            </>
          )}
          <Rule variant="structural" />
          <Button type="submit" variant="primary">
            {provider === "ics" ? "구독 주소 연결" : "브라우저에서 Google 읽기 연결"}
          </Button>
        </form>
      </details>
      {busy && (
        <p role="status">
          연결을 처리하고 있어요. Google 연결은 열린 브라우저에서 승인을 마쳐 주세요.
        </p>
      )}
      <Dialog
        isOpen={disconnect !== null}
        title="캘린더 연결을 해제할까요?"
        closeLabel="닫기"
        size="small"
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDisconnect(null);
          }
        }}
      >
        <div className={s.body}>
          <p>
            {text(disconnect?.name)}의 일정 조회를 중단합니다. 기존 준비 봉투의 체크리스트와 자료는
            보존합니다.
          </p>
          {error && (
            <p role="alert" className={c.error}>
              {error}
            </p>
          )}
          <div className={s.row}>
            <Button
              variant="primary"
              disabled={busy}
              onClick={async () => {
                if (
                  disconnect &&
                  (await run("disconnect_calendar", {
                    id: widget.id,
                    connectionId: text(disconnect.id),
                  }))
                ) {
                  setDisconnect(null);
                }
              }}
            >
              연결 해제 확인
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setDisconnect(null)}>
              취소
            </Button>
          </div>
        </div>
      </Dialog>
    </fieldset>
  );
}

function CalendarAlerts({ data, act }: { data: DataRecord; act: ToolAction }): ReactElement {
  const [enabled, setEnabled] = useState(data.enabled === true);
  const [leadMinutes, setLeadMinutes] = useState(
    typeof data.leadMinutes === "number" ? data.leadMinutes : 10,
  );
  const [includeAllDay, setIncludeAllDay] = useState(data.includeAllDay === true);
  const [quietStart, setQuietStart] = useState(text(data.quietStart) || "22:00");
  const [quietEnd, setQuietEnd] = useState(text(data.quietEnd) || "08:00");
  const [saved, setSaved] = useState(false);
  return (
    <details className={s.disclosure}>
      <summary>일정 알림</summary>
      <form
        className={s.composer}
        onChange={() => setSaved(false)}
        onSubmit={async (event) => {
          event.preventDefault();
          setSaved(
            await act("configure-alerts", {
              enabled,
              leadMinutes,
              includeAllDay,
              quietStart,
              quietEnd,
            }),
          );
        }}
      >
        <Checkbox checked={enabled} onChange={(event) => setEnabled(event.target.checked)}>
          일정 알림 켜기
        </Checkbox>
        <FormField className={c.field} label="몇 분 전에 알릴까요?" required>
          <TextField
            type="number"
            min="0"
            max="120"

            value={leadMinutes}
            onChange={(event) => setLeadMinutes(Number(event.target.value))}
          />
        </FormField>
        <Checkbox
          checked={includeAllDay}
          onChange={(event) => setIncludeAllDay(event.target.checked)}
        >
          종일 일정도 알림
        </Checkbox>
        <p className={c.quiet}>
          기기 시간대 기준입니다. 종일 일정은 오전 9시에서 설정한 분만큼 앞서 알립니다.
        </p>
        <FormField className={c.field} label="조용한 시간 시작" required>
          <TextField
            type="time"

            value={quietStart}
            onChange={(event) => setQuietStart(event.target.value)}
          />
        </FormField>
        <FormField className={c.field} label="조용한 시간 끝" required>
          <TextField
            type="time"

            value={quietEnd}
            onChange={(event) => setQuietEnd(event.target.value)}
          />
        </FormField>
        <p className={c.quiet}>시작과 끝이 같으면 조용한 시간을 사용하지 않아요.</p>
        <Button type="submit" variant="secondary">
          알림 설정 저장
        </Button>
        {saved && <p role="status">알림 설정을 저장했어요.</p>}
      </form>
    </details>
  );
}
