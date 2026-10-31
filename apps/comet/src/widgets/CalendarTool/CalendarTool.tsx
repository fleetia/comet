import { useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { Icon } from "@comet/icon";
import {
  Badge,
  Button,
  Checkbox,
  ContentChoice,
  Dialog,
  FormField,
  Select,
  Textarea,
  TextInput,
} from "@comet/ui";
import { localDay, record, rows, text, type DataRecord, type ToolAction } from "../toolData";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { openSystemSettings } from "../../systemSettings";
import { CalendarColors } from "../Planner/CalendarColors";
import { connectionsOutdated, freeTimeCoverage, freeTimes } from "../Planner/plannerData";
import { PlannerAlerts } from "../PlannerAlerts/PlannerAlerts";
import { useConnectionCommand } from "../useConnectionCommand";
import type { WidgetView } from "../types";
import * as c from "../../common.css";
import * as s from "../tools.css";
import * as settings from "./calendarTool.css";
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
const CONNECTION_COLORS = [
  ["#ff9f85", "코랄"],
  ["#77d9ca", "민트"],
  ["#b6a0ea", "보라"],
  ["#8c95c2", "슬레이트"],
] as const;
const DEFAULT_CONNECTION_COLOR = CONNECTION_COLORS[0][0];

export function CalendarTool({
  widget,
  act,
  mode = "tool",
  active = true,
  onDirtyChange,
  onBusyChange,
  sideContainer,
  onConnectionOpenChange,
  disabled = false,
}: {
  widget: WidgetView;
  act: ToolAction;
  mode?: "settings" | "tool";
  active?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  sideContainer?: HTMLElement | null;
  onConnectionOpenChange?: (open: boolean) => void;
  disabled?: boolean;
}): ReactElement {
  const d = record(widget.data),
    connections = rows(d.connections);
  const connectedIds = new Set(connections.map((connection) => text(connection.id)));
  const events = rows(d.events).filter(
    (event) =>
      event.cancelled !== true &&
      (event.connectionId === "local" || connectedIds.has(text(event.connectionId))),
  );
  const { busy, error, clearError, run } = useConnectionCommand();
  const [now, setNow] = useState(Date.now()),
    [day, setDay] = useState(localDay()),
    [free, setFree] = useState(false);
  const [provider, setProvider] = useState("ics"),
    [name, setName] = useState(""),
    [url, setUrl] = useState(""),
    [clientId, setClientId] = useState(""),
    [clientSecret, setClientSecret] = useState(""),
    [calendarIds, setCalendarIds] = useState("primary");
  const [connectionOpen, setConnectionOpen] = useState(false);
  const calendarSettings = record(d.settings);
  const [connectionColor, setConnectionColor] = useState(
    text(calendarSettings.connectionColor) || DEFAULT_CONNECTION_COLOR,
  );
  const customConnectionColor = !CONNECTION_COLORS.some(([color]) => color === connectionColor);
  const interval =
    typeof calendarSettings.refreshIntervalMinutes === "number"
      ? calendarSettings.refreshIntervalMinutes
      : 10;
  const lastSuccessAt = Math.max(
    0,
    ...connections.map((connection) =>
      typeof connection.lastSuccessAt === "number" ? connection.lastSuccessAt : 0,
    ),
  );
  function checkedTime(at: number): string {
    const date = new Date(at);
    const time = date.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
    if (localDay(date) === localDay(new Date(now))) return time;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    return localDay(date) === localDay(yesterday)
      ? `어제 ${time}`
      : `${date.toLocaleDateString("ko-KR", { month: "long", day: "numeric" })} ${time}`;
  }
  useEffect(() => {
    onConnectionOpenChange?.(connectionOpen);
  }, [connectionOpen, onConnectionOpenChange]);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [appleCalendars, setAppleCalendars] = useState<AppleCalendarList | null>(null);
  const [appleIds, setAppleIds] = useState<string[]>([]);
  const [appleBusy, setAppleBusy] = useState(false);
  useEffect(() => {
    onBusyChange?.(busy || appleBusy);
  }, [busy, appleBusy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  const [appleError, setAppleError] = useState<string | null>(null);
  const appleRequest = useRef(0);
  const [disconnect, setDisconnect] = useState<DataRecord | null>(null);
  const [alertsDirty, setAlertsDirty] = useState(false);
  const [connectionBaseline, setConnectionBaseline] = useState({
    provider,
    name,
    url,
    clientId,
    clientSecret,
    calendarIds,
    appleIds,
    connectionColor,
  });
  const connectionDirty =
    connectionOpen &&
    JSON.stringify({
      provider,
      name,
      url,
      clientId,
      clientSecret,
      calendarIds,
      appleIds,
      connectionColor,
    }) !== JSON.stringify(connectionBaseline);
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
    clearError();
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
    clearError();
    setAlertsDirty(false);
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
    setConnectionColor(text(calendarSettings.connectionColor) || DEFAULT_CONNECTION_COLOR);
    setConnectionBaseline({
      provider: "ics",
      name: "",
      url: "",
      clientId: "",
      clientSecret: "",
      calendarIds: "primary",
      appleIds: [],
      connectionColor: text(calendarSettings.connectionColor) || DEFAULT_CONNECTION_COLOR,
    });
  }
  function editConnection(connection: DataRecord): void {
    resetConnection();
    setConnectionOpen(true);
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
    setConnectionBaseline({
      provider: text(connection.provider),
      name: text(connection.name),
      url: "",
      clientId: "",
      clientSecret: "",
      calendarIds: connection.provider === "google" ? selected.join("\n") : "primary",
      appleIds: connection.provider === "apple" ? selected : [],
      connectionColor: text(calendarSettings.connectionColor) || DEFAULT_CONNECTION_COLOR,
    });
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
  const coverage = freeTimeCoverage(connections, day, now);
  const outsideRange = coverage === "outside";
  const outdated = connectionsOutdated(connections, now);
  const hasCoverage = coverage === "covered";
  const showFree = free && connections.length > 0;
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
              variant="ghost"
              onClick={() => void run("open_widget_link", { id: widget.id, url: text(event.url) })}
            >
              원본 일정 열기
            </Button>
          )}
        </div>
      </article>
    );
  }
  const providers = (
    <fieldset className={settings.providerPanel} disabled={disabled || busy || appleBusy}>
      <p className={settings.readOnlyCaption}>
        연결한 캘린더는 읽기만 해요. 고치려면 원본 캘린더에서 고쳐요.
      </p>
      <h3 className={settings.heading}>어디에서 가져올까요</h3>
      <div className={settings.providerChoices} aria-label="캘린더 연결 방식">
        {(
          [
            {
              value: "apple",
              title: "Apple 캘린더",
              description: "이 Mac의 캘린더 계정을 읽어요",
              icon: "star",
            },
            {
              value: "google",
              title: "Google 캘린더",
              description: "브라우저에서 읽기 권한만 승인해요",
              icon: "calendar",
            },
            {
              value: "ics",
              title: "구독 주소",
              description: "webcal이나 https로 시작하는 주소",
              icon: "link",
            },
          ] as const
        ).map((option) => (
          <ContentChoice
            key={option.value}
            title={option.title}
            description={option.description}
            leading={
              <span className={settings.providerIcon}>
                <Icon name={option.icon} size={18} />
              </span>
            }
            trailing={provider === option.value ? <Icon name="check" size={16} /> : undefined}
            selected={provider === option.value}
            disabled={editingConnectionId !== null}
            onClick={() => {
              clearError();
              setProvider(option.value);
              setAppleError(null);
            }}
          />
        ))}
      </div>
    </fieldset>
  );
  function connectionColors(connection: DataRecord): ReactElement {
    return (
      <CalendarColors
        connections={connections}
        events={rows(d.events)}
        colors={record(d.calendarColors)}
        connectionId={text(connection.id)}
        disabled={disabled || busy || appleBusy}
        onChange={(input) => void act("set-calendar-color", input)}
      />
    );
  }
  const fetchControls = (
    <section className={settings.connectionSection} aria-label="캘린더 가져오기">
      <div className={settings.fetchGroup}>
        <div className={settings.settingRow}>
          <span>확인 간격</span>
          <Select
            aria-label="캘린더 확인 간격"
            disabled={disabled || busy || appleBusy}
            value={interval}
            onChange={(event) =>
              void act("configure", { refreshIntervalMinutes: Number(event.target.value) })
            }
          >
            {[5, 10, 15, 30, 60].map((value) => (
              <option key={value} value={value}>
                {value}분마다
              </option>
            ))}
          </Select>
        </div>
        <div className={settings.settingRow}>
          <span>
            지금 다시 확인
            <span className={settings.caption}>
              {lastSuccessAt
                ? `마지막 확인 ${checkedTime(lastSuccessAt)}`
                : "아직 조회하지 않았어요"}
            </span>
          </span>
          <Button
            size="small"
            variant="ghost"
            disabled={disabled || busy || appleBusy || connections.length === 0}
            onClick={() =>
              void (async () => {
                for (const connection of connections) {
                  if (
                    !(await run("refresh_calendar", {
                      id: widget.id,
                      connectionId: text(connection.id),
                    }))
                  )
                    break;
                }
              })()
            }
          >
            <Icon name="habit" size={15} />
            다시 확인
          </Button>
        </div>
      </div>
    </section>
  );
  return (
    <fieldset
      className={mode === "settings" ? settings.root : s.body}
      disabled={disabled || busy || appleBusy}
    >
      {error && !disconnect && (
        <p role="alert" className={c.error}>
          {error}
        </p>
      )}
      {mode === "tool" &&
        (connections.length === 0 && events.length === 0 ? (
          <p>캘린더를 읽기 연결하면 오늘과 다음 일정을 볼 수 있어요.</p>
        ) : (
          <>
            {outdated && (
              <p className={c.error}>
                일부 연결이 최신 상태가 아닙니다. 아래 일정은 마지막 성공 정보를 포함합니다.
              </p>
            )}
            <FormField className={c.field} label="조회 날짜" required>
              <TextInput
                type="date"
                fill
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
            {connections.length > 0 && (
              <Button
                variant={showFree ? "primary" : "ghost"}
                aria-pressed={showFree}
                onClick={() => setFree((current) => !current)}
              >
                {showFree ? "일정 보기" : "연결한 캘린더의 빈 시간 보기"}
              </Button>
            )}
            {connections.length > 0 && !hasCoverage && (
              <p role="status" className={c.error}>
                {outsideRange
                  ? "선택한 날짜는 조회 범위 밖입니다."
                  : "조회 정보가 오래됐거나 이 날짜 전체를 확인하지 못했습니다."}{" "}
                새로 조회하기 전에는 빈 시간을 판단하지 않습니다.
              </p>
            )}
            {showFree && hasCoverage ? (
              <>
                <p className={c.quiet}>
                  Comet에 저장한 일정과 연결하여 조회한 캘린더를 기준으로 합니다.
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
                {!showFree && (hasCoverage || connections.length === 0) && today.length === 0 && (
                  <p>조회한 날짜에 일정이 없어요.</p>
                )}
                {!showFree && today.map(card)}
              </>
            )}
            {next && (showFree || !today.some((event) => event.id === next.id)) && (
              <section className={s.section}>
                <h2 className={s.sectionTitle}>다음 일정</h2>
                {card(next)}
              </section>
            )}
          </>
        ))}
      {mode === "settings" && (
        <>
          {!connectionOpen &&
            (sideContainer ? createPortal(fetchControls, sideContainer) : fetchControls)}
          <section className={settings.connectionSection} aria-label="캘린더 연결 관리">
            <div className={settings.connectionHeading} hidden={connectionOpen}>
              <h2 className={settings.heading}>연결한 캘린더</h2>
              <div className={settings.headingActions}>
                <details
                  className={settings.alerts}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.currentTarget.open = false;
                      event.currentTarget.querySelector("summary")?.focus();
                    }
                  }}
                >
                  <summary className={settings.alertsSummary} title="일정과 생활 알림">
                    <Icon name="more" size={20} />
                    일정과 생활 알림
                    {alertsDirty && (
                      <span className={settings.accessibleLabel}> · 변경사항 있음</span>
                    )}
                    {alertsDirty && <span aria-hidden className={settings.dirtyDot} />}
                  </summary>
                  <div className={settings.alertsBody}>
                    <h3 className={settings.heading}>일정과 생활 알림</h3>
                    {!connectionOpen && (
                      <PlannerAlerts
                        data={record(d.reminders)}
                        act={act}
                        onDirtyChange={setAlertsDirty}
                      />
                    )}
                  </div>
                </details>
                <Button
                  className={settings.connectButton}
                  variant="ghost"
                  size="small"
                  onClick={() => {
                    resetConnection();
                    setConnectionOpen(true);
                  }}
                >
                  + 캘린더 연결…
                </Button>
              </div>
            </div>
            <div hidden={connectionOpen} className={settings.connectionList}>
              {connections.map((connection) => (
                <section className={settings.connectionCard} key={text(connection.id)}>
                  <div className={settings.connectionName}>
                    <span className={settings.calendarIcon}>
                      <Icon name="calendar" size={18} />
                    </span>
                    <div className={settings.connectionText}>
                      <h3 className={settings.name}>{text(connection.name)}</h3>
                      <p className={settings.caption}>
                        {connection.status !== "ready" &&
                        typeof connection.lastSuccessAt === "number"
                          ? `${checkedTime(connection.lastSuccessAt)}에 받은 정보를 흐리게 보여 줘요`
                          : connection.provider === "apple"
                            ? "캘린더 앱에 있는 일정을 읽어요"
                            : typeof connection.lastSuccessAt === "number"
                              ? `읽기만 해요 · ${checkedTime(connection.lastSuccessAt)}에 확인`
                              : "읽기만 해요 · 아직 조회하지 않았어요"}
                      </p>
                    </div>
                    <Badge
                      className={
                        connection.status === "ready" && connection.provider !== "apple"
                          ? settings.readyStatus
                          : connection.status === "ready" || connection.status === "syncing"
                            ? settings.connectionStatus
                            : settings.attentionStatus
                      }
                    >
                      {connection.provider === "apple" && connection.status === "ready"
                        ? "권한 허용됨"
                        : {
                            ready: "연결됨",
                            syncing: "조회 중",
                            stale: "이전 정보",
                            offline: "연결 확인 필요",
                            "auth-error": "다시 인증 필요",
                            "permission-needed": "권한 필요",
                          }[text(connection.status)] || "연결 확인 필요"}
                    </Badge>
                    {connection.status !== "ready" && (
                      <Button
                        variant="ghost"
                        size="small"
                        onClick={() =>
                          void run("refresh_calendar", {
                            id: widget.id,
                            connectionId: text(connection.id),
                          })
                        }
                      >
                        <Icon name="habit" size={15} />
                        다시 확인
                      </Button>
                    )}
                    <details className={settings.connectionMenu}>
                      <summary aria-label={`${text(connection.name)} 메뉴`}>
                        <Icon name="more" size={20} />
                      </summary>
                      <div className={settings.menuActions}>
                        <Button
                          variant="ghost"
                          size="small"
                          onClick={() =>
                            void run("refresh_calendar", {
                              id: widget.id,
                              connectionId: text(connection.id),
                            })
                          }
                        >
                          다시 조회
                        </Button>
                        <Button
                          variant="ghost"
                          size="small"
                          onClick={() => editConnection(connection)}
                        >
                          다시 연결·캘린더 선택
                        </Button>
                        <Button
                          variant="ghost"
                          size="small"
                          onClick={() => setDisconnect(connection)}
                        >
                          연결 해제
                        </Button>
                        {connection.provider === "ics" && (
                          <div className={settings.menuColorControls}>
                            <span className={settings.caption}>캘린더 색상</span>
                            {connectionColors(connection)}
                          </div>
                        )}
                      </div>
                    </details>
                  </div>
                  {text(connection.error) && <p className={c.error}>{text(connection.error)}</p>}
                  {connection.provider !== "ics" && (
                    <div className={settings.connectionCalendars}>
                      {connectionColors(connection)}
                    </div>
                  )}
                </section>
              ))}
            </div>
            {!connectionOpen && (
              <p className={settings.caption}>
                연결한 캘린더는 읽기만 해요. 고치려면 원본 캘린더에서 고쳐요.
              </p>
            )}
            <form
              hidden={!connectionOpen}
              className={settings.connectionForm}
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
                if (!(await act("configure", { connectionColor }))) return;
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
                  setConnectionOpen(false);
                }
              }}
            >
              <div className={settings.connectionHeading}>
                <h3 className={settings.heading}>
                  {editingConnectionId
                    ? "캘린더 다시 연결"
                    : ({ apple: "Apple 캘린더", google: "Google 캘린더", ics: "구독 주소" }[
                        provider
                      ] ?? "캘린더 연결")}
                </h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="small"
                  onClick={() => {
                    resetConnection();
                    setConnectionOpen(false);
                  }}
                >
                  ‹ 연결한 캘린더
                </Button>
              </div>
              {editingConnectionId && (
                <p className={c.quiet}>
                  다시 연결하는 동안 마지막 조회 일정과 내장 할 일은 보존합니다.
                </p>
              )}
              {connectionOpen &&
                (sideContainer ? createPortal(providers, sideContainer) : providers)}
              <div className={settings.formGroup}>
                <FormField className={settings.formRow} label="이름" required>
                  <TextInput
                    fill
                    aria-label="연결 이름"
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </FormField>
                {provider === "ics" ? (
                  <FormField className={settings.formRow} label="주소" required>
                    <TextInput
                      fill
                      type="url"
                      aria-label="ICS / webcal 구독 주소"
                      autoComplete="off"
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                    />
                  </FormField>
                ) : provider === "apple" ? (
                  <>
                    <p className={c.quiet}>
                      이 Mac의 캘린더 목록을 읽어 연결할 캘린더를 직접 고릅니다. macOS는 조회에도
                      전체 접근 권한을 요청합니다. comet은 일정을 생성·수정·삭제하지 않습니다.
                    </p>
                    <p className={c.quiet}>
                      Google에도 연결한 캘린더가 있다면 한쪽에서만 선택해 중복 일정을 피하세요.
                    </p>
                    <Button type="button" variant="ghost" onClick={() => void loadAppleCalendars()}>
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
                    {appleCalendars?.supported &&
                      appleCalendars.authorization !== "full-access" && (
                        <>
                          <p role="status" className={c.error}>
                            Apple 캘린더를 읽으려면 시스템 설정 → 개인정보 보호 및 보안 → 캘린더에서
                            comet을 허용해 주세요.
                          </p>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() =>
                              void openSystemSettings("calendar").catch((cause: unknown) =>
                                setAppleError(errorText(cause)),
                              )
                            }
                          >
                            시스템 설정 열기
                          </Button>
                        </>
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
                            label={
                              <>
                                {calendar.name} · {calendar.sourceName}
                              </>
                            }
                          />
                        ))}
                        {appleIds.some(
                          (id) => !appleCalendars.calendars.some((calendar) => calendar.id === id),
                        ) && (
                          <p role="alert" className={c.error}>
                            이전 선택 중 목록에서 사라진 캘린더가 있습니다. 선택을 초기화하고 다시
                            골라 주세요.
                          </p>
                        )}
                        <Button type="button" variant="ghost" onClick={() => setAppleIds([])}>
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
                      <TextInput
                        fill
                        autoComplete="off"
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                      />
                    </FormField>
                    <FormField className={c.field} label="클라이언트 보안 비밀 (선택)">
                      <TextInput
                        fill
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
                      <Textarea
                        layout="flexible"
                        fill
                        rows={3}
                        value={calendarIds}
                        onChange={(e) => setCalendarIds(e.target.value)}
                      />
                    </FormField>
                  </>
                )}
                <div className={settings.settingRow}>
                  <span className={settings.connectionText}>
                    색
                    <span className={settings.caption}>
                      다이어리와 캘린더 위젯에서 이 색으로 보여요
                    </span>
                  </span>
                  <div className={settings.swatches} role="group" aria-label="연결할 캘린더 색">
                    {CONNECTION_COLORS.map(([color, label]) => (
                      <button
                        key={color}
                        type="button"
                        className={settings.swatch}
                        aria-label={label}
                        aria-pressed={connectionColor === color}
                        style={{ background: color }}
                        onClick={() => setConnectionColor(color)}
                      >
                        {connectionColor === color && <Icon name="check" size={14} />}
                      </button>
                    ))}
                    {customConnectionColor && (
                      <span
                        className={settings.swatch}
                        role="img"
                        aria-label={`선택한 사용자 색 ${connectionColor}`}
                        style={{ background: connectionColor }}
                      />
                    )}
                    <label className={settings.customSwatch}>
                      <Icon name="plus" size={15} />
                      <input
                        className={settings.customColorInput}
                        type="color"
                        aria-label="사용자 색 추가"
                        value={connectionColor}
                        disabled={disabled || busy || appleBusy}
                        onChange={(event) =>
                          setConnectionColor(event.currentTarget.value.toLowerCase())
                        }
                      />
                    </label>
                  </div>
                </div>
              </div>
              <p className={settings.readOnlyNotice}>
                <Icon name="shield" size={16} className={settings.noticeIcon} />
                <span>
                  {provider === "ics"
                    ? "구독 주소는 읽기만 해요. 남에게 보이지 않는 주소라면 비밀번호처럼 다뤄 주세요."
                    : "연결한 캘린더는 읽기만 해요. 구독 주소와 인증 정보는 비밀번호처럼 다뤄 주세요."}
                </span>
              </p>
              <section className={settings.localSection} aria-label="캘린더 연결 미리보기">
                <h3 className={settings.heading}>이렇게 보여요</h3>
                <div className={settings.localRow}>
                  <span
                    className={settings.previewDot}
                    style={{ backgroundColor: connectionColor }}
                    aria-hidden
                  />
                  <span className={settings.connectionText}>
                    {name || "연결 이름"}
                    <span className={settings.caption}>
                      {provider === "ics"
                        ? "구독 주소"
                        : provider === "apple"
                          ? "Apple 캘린더"
                          : "Google 캘린더"}{" "}
                      · {interval}분마다 확인 · 읽기만 해요
                    </span>
                  </span>
                  <Badge className={settings.connectionStatus}>
                    {editingConnectionId ? "다시 연결" : "새로 연결"}
                  </Badge>
                </div>
              </section>
              <div className={settings.formActions}>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => {
                    resetConnection();
                    setConnectionOpen(false);
                  }}
                >
                  취소
                </Button>
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
                  <Button variant="ghost" type="button" onClick={resetConnection}>
                    연결 입력 지우기
                  </Button>
                )}
              </div>
            </form>
          </section>
          {!connectionOpen && (
            <section className={settings.localSection} aria-label="comet 일정">
              <h2 className={settings.heading}>comet 일정</h2>
              <div className={settings.group}>
                <div className={settings.settingRow}>
                  <span>
                    comet에 저장한 일정
                    <span className={settings.caption}>
                      이 기기에만 저장돼요 · 다이어리에서 만들고 고쳐요
                    </span>
                  </span>
                  <span className={settings.caption}>
                    {events.filter((event) => event.connectionId === "local").length}개
                  </span>
                </div>
                <div className={settings.settingRow}>
                  <span>새 일정을 넣을 곳</span>
                  <Select
                    aria-label="새 일정을 넣을 곳"
                    value={text(calendarSettings.newEventTarget) || "local"}
                    onChange={(event) =>
                      void act("configure", { newEventTarget: event.target.value })
                    }
                  >
                    <option value="local">comet</option>
                  </Select>
                </div>
              </div>
            </section>
          )}
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
        variant="confirm"
        onOpenChange={(open) => {
          if (!open && !busy) {
            setDisconnect(null);
          }
        }}
        footer={
          <>
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
            <Button variant="ghost" disabled={busy} onClick={() => setDisconnect(null)}>
              취소
            </Button>
          </>
        }
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
        </div>
      </Dialog>
    </fieldset>
  );
}
