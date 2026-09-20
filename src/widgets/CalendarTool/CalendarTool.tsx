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
import { useEffect, useRef, useState, type ReactElement } from "react";
import { localDay, record, rows, text, type DataRecord, type ToolAction } from "../toolData";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { PlannerAlerts } from "../PlannerAlerts/PlannerAlerts";
import { useConnectionCommand } from "../useConnectionCommand";
import type { WidgetView } from "../types";
import * as c from "../../lagrange.css";
import * as s from "../tools.css";
type AppleCalendarList = {
  supported: boolean;
  authorization: string;
  calendars: { id: string; name: string; sourceName: string }[];
};
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
  mode = "tool",
  active = true,
  onDirtyChange,
}: {
  widget: WidgetView;
  act: ToolAction;
  mode?: "settings" | "tool";
  active?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
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
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [appleCalendars, setAppleCalendars] = useState<AppleCalendarList | null>(null);
  const [appleIds, setAppleIds] = useState<string[]>([]);
  const [appleBusy, setAppleBusy] = useState(false);
  const [appleError, setAppleError] = useState<string | null>(null);
  const appleRequest = useRef(0);
  const [disconnect, setDisconnect] = useState<DataRecord | null>(null);
  const [alertsDirty, setAlertsDirty] = useState(false);
  const connectionDirty = Boolean(
    name ||
    url ||
    clientId ||
    clientSecret ||
    provider !== "ics" ||
    calendarIds !== "primary" ||
    editingConnectionId ||
    appleIds.length > 0,
  );
  useEffect(() => {
    onDirtyChange?.(mode === "settings" && (alertsDirty || connectionDirty));
  }, [mode, alertsDirty, connectionDirty, onDirtyChange]);
  useEffect(
    () => () => {
      appleRequest.current += 1;
    },
    [],
  );
  async function loadAppleCalendars(): Promise<void> {
    if (!isDesktop()) {
      setAppleError("Apple 캘린더 연결은 macOS 데스크톱 앱에서 사용할 수 있어요.");
      return;
    }
    const request = ++appleRequest.current;
    setAppleBusy(true);
    setAppleError(null);
    try {
      const result = await command<AppleCalendarList>("list_apple_calendars", {
        id: widget.id,
        requestAccess: true,
      });
      if (request === appleRequest.current) {
        setAppleCalendars(result);
      }
    } catch (cause: unknown) {
      if (request === appleRequest.current) {
        setAppleError(errorText(cause));
      }
    } finally {
      if (request === appleRequest.current) {
        setAppleBusy(false);
      }
    }
  }
  function resetConnection(): void {
    appleRequest.current += 1;
    setAppleCalendars(null);
    setAppleIds([]);
    setAppleBusy(false);
    setAppleError(null);
    setEditingConnectionId(null);
    setName("");
    setUrl("");
    setClientId("");
    setClientSecret("");
    setProvider("ics");
    setCalendarIds("primary");
  }
  function editConnection(connection: DataRecord): void {
    resetConnection();
    setEditingConnectionId(text(connection.id));
    setProvider(text(connection.provider));
    setName(text(connection.name));
    const selected = Array.isArray(connection.selectedCalendarIds)
      ? connection.selectedCalendarIds.filter((id): id is string => typeof id === "string")
      : [];
    if (connection.provider === "apple") {
      setAppleIds(selected);
    } else if (connection.provider === "google") {
      setCalendarIds(selected.join("\n"));
    }
  }
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
    <fieldset className={s.body} disabled={busy || appleBusy}>
      {error && !disconnect && (
        <p role="alert" className={c.error}>
          {error}
        </p>
      )}
      {mode === "tool" &&
        (connections.length === 0 ? (
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
        ))}
      {mode === "settings" && (
        <>
          <PlannerAlerts data={record(d.reminders)} act={act} onDirtyChange={setAlertsDirty} />
          <section className={s.section} aria-label="캘린더 연결 관리">
            <h2 className={s.sectionTitle}>캘린더 연결 관리</h2>
            {connections.map((connection) => (
              <section className={s.item} key={text(connection.id)}>
                <h2>{text(connection.name)}</h2>
                <p className={c.quiet}>
                  {{ google: "Google Calendar", apple: "Apple 캘린더 · 이 Mac", ics: "ICS 구독" }[
                    text(connection.provider)
                  ] || "캘린더"}{" "}
                  ·{" "}
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
                      void run("refresh_calendar", {
                        id: widget.id,
                        connectionId: text(connection.id),
                      })
                    }
                  >
                    다시 조회
                  </Button>
                  <Button variant="secondary" onClick={() => editConnection(connection)}>
                    다시 연결·캘린더 선택
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
                    : provider === "apple"
                      ? { name, calendarIds: appleIds }
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
                  await run(
                    provider === "ics"
                      ? "connect_calendar_ics"
                      : provider === "apple"
                        ? "connect_calendar_apple"
                        : "connect_calendar_google",
                    {
                      id: widget.id,
                      input,
                      ...(editingConnectionId ? { connectionId: editingConnectionId } : {}),
                    },
                  )
                ) {
                  resetConnection();
                }
              }}
            >
              <h3 className={s.sectionTitle}>
                {editingConnectionId ? "캘린더 다시 연결" : "캘린더 연결 추가"}
              </h3>
              {editingConnectionId && (
                <p className={c.quiet}>
                  다시 연결하는 동안 마지막 조회 일정과 내장 할 일은 보존합니다.
                </p>
              )}
              <FormField className={c.field} label="연결 방식">
                <Select
                  value={provider}
                  disabled={editingConnectionId !== null}
                  onChange={(e) => {
                    setProvider(e.target.value);
                    setAppleError(null);
                  }}
                >
                  <option value="ics">ICS / webcal 구독</option>
                  <option value="google">Google Calendar 읽기 연결</option>
                  <option value="apple">Apple 캘린더 읽기 연결 · macOS</option>
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
              ) : provider === "apple" ? (
                <>
                  <p className={c.quiet}>
                    이 Mac의 캘린더 목록을 읽어 연결할 캘린더를 직접 고릅니다. macOS는 조회에도 전체
                    접근 권한을 요청합니다. comet은 일정을 생성·수정·삭제하지 않습니다.
                  </p>
                  <p className={c.quiet}>
                    Google에도 연결한 캘린더가 있다면 한쪽에서만 선택해 중복 일정을 피하세요.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void loadAppleCalendars()}
                  >
                    macOS 권한 확인하고 캘린더 목록 읽기
                  </Button>
                  {appleError && (
                    <p role="alert" className={c.error}>
                      {appleError}
                    </p>
                  )}
                  {appleCalendars && !appleCalendars.supported && (
                    <p role="status">
                      Apple 직접 연결은 macOS 전용입니다. 다른 기기에서는 Google 또는 ICS 구독을
                      사용하세요.
                    </p>
                  )}
                  {appleCalendars?.supported && appleCalendars.authorization !== "full-access" && (
                    <p role="status" className={c.error}>
                      캘린더 읽기 권한이 없습니다. macOS 시스템 설정 → 개인정보 보호 및 보안 →
                      캘린더에서 comet의 전체 접근을 허용한 뒤 목록을 다시 읽어 주세요.
                    </p>
                  )}
                  {appleCalendars?.authorization === "full-access" && (
                    <fieldset className={s.section}>
                      <legend>연결할 Apple 캘린더 선택</legend>
                      {appleCalendars.calendars.length === 0 && (
                        <p>이 Mac에서 읽을 수 있는 캘린더가 없습니다.</p>
                      )}
                      {appleCalendars.calendars.map((calendar) => (
                        <Checkbox
                          key={calendar.id}
                          checked={appleIds.includes(calendar.id)}
                          onChange={(event) =>
                            setAppleIds((current) =>
                              event.target.checked
                                ? [...current, calendar.id]
                                : current.filter((id) => id !== calendar.id),
                            )
                          }
                        >
                          {calendar.name} · {calendar.sourceName}
                        </Checkbox>
                      ))}
                      {appleIds.some(
                        (id) => !appleCalendars.calendars.some((calendar) => calendar.id === id),
                      ) && (
                        <p role="alert" className={c.error}>
                          이전 선택 중 목록에서 사라진 캘린더가 있습니다. 선택을 초기화하고 다시
                          골라 주세요.
                        </p>
                      )}
                      <Button type="button" variant="quiet" onClick={() => setAppleIds([])}>
                        Apple 캘린더 선택 초기화
                      </Button>
                    </fieldset>
                  )}
                </>
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
                  <FormField
                    className={c.field}
                    label="조회할 캘린더 ID (줄바꿈 또는 쉼표)"
                    required
                  >
                    <TextArea
                      value={calendarIds}
                      onChange={(e) => setCalendarIds(e.target.value)}
                    />
                  </FormField>
                </>
              )}
              <Rule variant="structural" />
              <Button
                type="submit"
                variant="primary"
                disabled={
                  provider === "apple" &&
                  (appleCalendars?.authorization !== "full-access" ||
                    appleIds.length === 0 ||
                    appleIds.some(
                      (id) => !appleCalendars.calendars.some((calendar) => calendar.id === id),
                    ))
                }
              >
                {provider === "ics"
                  ? "구독 주소 연결"
                  : provider === "apple"
                    ? "선택한 Apple 캘린더 연결"
                    : "브라우저에서 Google 읽기 연결"}
              </Button>
              {connectionDirty && (
                <Button variant="quiet" type="button" onClick={resetConnection}>
                  연결 입력 지우기
                </Button>
              )}
            </form>
          </section>
        </>
      )}
      {appleBusy && <p role="status">macOS 권한 확인과 캘린더 목록 조회를 기다리고 있어요.</p>}
      {busy && (
        <p role="status">
          연결을 처리하고 있어요. Google 연결은 열린 브라우저에서 승인을 마쳐 주세요.
        </p>
      )}
      <Dialog
        isOpen={active && disconnect !== null}
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
