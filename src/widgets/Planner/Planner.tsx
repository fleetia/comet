import {
  Button,
  Checkbox,
  DateField,
  Dialog,
  FormField,
  Select,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextField,
} from "@fleetia/lagrange";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { WindowHeader } from "../../components/WindowHeader/WindowHeader";
import { useWidgets } from "../useWidgets";
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
import { PlannerAlertNotice } from "../PlannerAlerts/PlannerAlerts";
import { PlannerCalendar } from "./PlannerCalendar";
import { PlannerPreparation } from "./PlannerPreparation";
import { PlannerTemplates } from "./PlannerTemplates";
import { TodoEditor } from "./TodoEditor";
import {
  clockLabel,
  dayDate,
  dueDay,
  eventsOn,
  eventTime,
  frequencyRecords,
  inPeriod,
  moveDay,
  movePeriod,
  PERIODS,
  periodAnchor,
  plannedDay,
  repeatLabel,
  ruleOf,
} from "./plannerData";
import * as s from "./planner.css";

const NAVIGATION = [
  ["today", "오늘"],
  ["plans", "기간 계획"],
  ["calendar", "캘린더"],
  ["templates", "템플릿"],
] as const;

export function Planner(): ReactElement {
  const { snapshot, error: loadError, reload } = useWidgets();
  const [failure, setFailure] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [tab, setTab] = useState(new URLSearchParams(window.location.search).get("tab") || "today");
  const [day, setDay] = useState(localDay());
  const [period, setPeriod] = useState("week");
  const [planDay, setPlanDay] = useState(localDay());
  const [title, setTitle] = useState("");
  const [visibleList, setVisibleList] = useState("all");
  const [showCompleted, setShowCompleted] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState("");
  const [selectedTask, setSelectedTask] = useState("");
  const [editing, setEditing] = useState<{ item: DataRecord; widget: WidgetView } | null>(null);
  const [wrap, setWrap] = useState(false);
  const [rollIds, setRollIds] = useState<string[]>([]);
  const [rollDate, setRollDate] = useState(moveDay(localDay(), 1));
  const [manageLists, setManageLists] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const leaving = useRef(false);
  const dirty = Boolean(editing || title.trim());
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const widgets = snapshot?.widgets ?? [];
  const enabled = (kind: string): WidgetView | undefined =>
    widgets.find((w) => w.kind === kind && w.installed && w.enabled);
  const todo = enabled("todo"),
    calendar = enabled("calendar"),
    preparation = enabled("preparation"),
    timer = enabled("focus-timer");
  const items = rows(record(todo?.data).items),
    lists = rows(record(todo?.data).lists);
  const connections = rows(record(calendar?.data).connections);
  const events = rows(record(calendar?.data).events).filter(
    (event) => !event.cancelled && connections.some((c) => c.id === event.connectionId),
  );
  const dailyEvents = eventsOn(events, day);
  const event = dailyEvents.find((e) => e.id === selectedEvent) ?? dailyEvents[0];
  const chosen = items.filter((item) => plannedDay(item) === day);
  const remaining = chosen.filter(
    (item) =>
      typeof item.completedAt !== "number" &&
      !(
        ruleOf(item).mode === "frequency" &&
        rows(item.frequencyRecords).some((entry) => entry.date === day)
      ),
  );
  const currentTask = remaining.find((item) => item.id === selectedTask);
  const inboxCount = items.filter(
    (item) => !item.completedAt && inPeriod(item, "inbox", day),
  ).length;
  const lastSuccess = Math.max(0, ...connections.map((c) => number(c.lastSuccessAt)));

  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    let tabCleanup: (() => void) | undefined, closeCleanup: (() => void) | undefined;
    let received = false;
    const select = (value: string): void => {
      if (active && NAVIGATION.some(([key]) => key === value)) setTab(value);
    };
    void listen<string>("planner-tab", (e) => {
      received = true;
      select(e.payload);
    })
      .then(async (cleanup) => {
        if (!active) {
          cleanup();
          return;
        }
        tabCleanup = cleanup;
        const latest = await command<string>("get_planner_tab");
        if (!received) select(latest);
      })
      .catch((cause: unknown) => {
        if (active) setFailure(errorText(cause));
      });
    void getCurrentWindow()
      .onCloseRequested((e) => {
        if (!leaving.current && dirtyRef.current) {
          e.preventDefault();
          setConfirmClose(true);
        }
      })
      .then((cleanup) => {
        if (active) closeCleanup = cleanup;
        else cleanup();
      })
      .catch((cause: unknown) => {
        if (active) setFailure(errorText(cause));
      });
    return () => {
      active = false;
      tabCleanup?.();
      closeCleanup?.();
    };
  }, []);

  async function run(operation: () => Promise<unknown>): Promise<boolean> {
    if (!isDesktop()) {
      setFailure("미리보기에서는 저장하지 않아요. 실제 조작은 데스크톱 앱에서 할 수 있어요.");
      return false;
    }
    if (pending.current) return false;
    pending.current = true;
    setBusy(true);
    setFailure(null);
    setNotice("");
    try {
      await operation();
      return true;
    } catch (cause: unknown) {
      setFailure(errorText(cause));
      reload();
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const act: ToolAction = (action, input = {}, target = todo) => {
    if (!target) {
      setFailure("이 도구를 먼저 설치하고 켜 주세요.");
      return Promise.resolve(false);
    }
    return run(() =>
      command("execute_widget", {
        request: {
          requestId: crypto.randomUUID(),
          instanceId: target.id,
          expectedRevision: target.revision,
          action,
          input,
        },
      }),
    );
  };
  function openSettings(kind = "calendar"): void {
    if (isDesktop()) void run(() => command("open_planner_settings", { kind }));
    else window.location.assign(`/?view=settings&section=widgets&preview=installed`);
  }
  async function enableTodo(): Promise<void> {
    const existing = widgets.find((w) => w.kind === "todo");
    await run(() =>
      existing?.installed
        ? command("set_widget_enabled", { id: existing.id, enabled: true })
        : command("install_widgets", { kinds: ["todo"] }),
    );
  }
  function edit(item: DataRecord): void {
    if (todo) setEditing({ item, widget: todo });
  }
  async function check(item: DataRecord): Promise<void> {
    const id = text(item.id);
    if (ruleOf(item).mode === "frequency") {
      const date = tab === "plans" ? planDay : day,
        existing = rows(item.frequencyRecords).find((r) => r.date === date);
      await act(
        existing ? "undo-frequency" : "record-frequency",
        existing ? { id, recordId: text(existing.id) } : { id, date },
      );
    } else await act(typeof item.completedAt === "number" ? "undo" : "complete", { id });
  }
  function taskCheck(item: DataRecord): ReactElement {
    const frequency = ruleOf(item).mode === "frequency";
    const recordingDay = tab === "plans" ? planDay : day;
    return (
      <Checkbox
        className={s.taskCheck}
        disabled={busy || (frequency && recordingDay > localDay())}
        checked={
          frequency
            ? rows(item.frequencyRecords).some((r) => r.date === recordingDay)
            : typeof item.completedAt === "number"
        }
        onChange={() => void check(item)}
      >
        {text(item.title)}
        {frequency && (
          <span className={s.caption}>
            {" "}
            · {frequencyRecords(item, recordingDay).length}/{number(ruleOf(item).timesPerWeek)}회
          </span>
        )}
      </Checkbox>
    );
  }
  function quickInput(isToday: boolean): ReactElement {
    return (
      <form
        className={s.quick}
        onSubmit={async (e) => {
          e.preventDefault();
          if (
            await act("add", {
              title,
              listId: visibleList === "all" ? "default" : visibleList,
              plannedDate: isToday ? day : null,
              planPeriod: isToday || period === "inbox" ? "none" : period,
              planAnchor:
                isToday || ["inbox", "someday"].includes(period)
                  ? null
                  : periodAnchor(period, planDay),
            })
          )
            setTitle("");
        }}
      >
        <TextField
          className={s.grow}
          aria-label="새 할 일"
          disabled={busy}
          placeholder={isToday ? "할 일을 입력하고 Enter" : "이 기간에 하고 싶은 일을 적어 보세요."}
          required
          maxLength={500}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <Button type="submit" variant="primary" disabled={busy || !todo}>
          추가
        </Button>
      </form>
    );
  }
  function prep(): ReactElement {
    return (
      <PlannerPreparation
        event={event}
        calendar={calendar}
        preparation={preparation}
        widgets={widgets}
        act={act}
        openSettings={openSettings}
      />
    );
  }
  async function closeWindow(): Promise<void> {
    if (dirtyRef.current && !leaving.current) {
      setConfirmClose(true);
      return;
    }
    if (isDesktop()) await getCurrentWindow().close();
  }
  const shown = items.filter(
    (item) =>
      inPeriod(item, period, planDay) &&
      (visibleList === "all" || item.listId === visibleList) &&
      (showCompleted || typeof item.completedAt !== "number"),
  );
  return (
    <main className={s.window}>
      <WindowHeader className={s.header} label="플래너 닫기" onClose={closeWindow}>
        comet · 플래너
      </WindowHeader>
      {(loadError || failure) && (
        <div role="alert" className={s.error}>
          {loadError || failure}{" "}
          <Button variant="quiet" size="compact" onClick={reload}>
            다시 불러오기
          </Button>
        </div>
      )}
      {!isDesktop() && (
        <p className={s.status}>예시 데이터 미리보기 · 입력한 내용은 저장하지 않아요.</p>
      )}
      {busy && (
        <p role="status" className={s.status}>
          저장하고 있어요…
        </p>
      )}
      {notice && (
        <p role="status" className={s.status}>
          {notice}
        </p>
      )}
      {!snapshot ? (
        <div className={s.empty}>플래너를 불러오고 있어요.</div>
      ) : (
        <Tabs value={tab} onValueChange={setTab} className={s.tabs}>
          <div className={s.nav}>
            <TabList className={s.tabList} aria-label="플래너">
              {NAVIGATION.map(([key, label]) => (
                <Tab key={key} value={key} className={s.tab}>
                  {label}
                </Tab>
              ))}
            </TabList>
            <Button variant="quiet" size="compact" onClick={() => openSettings()}>
              연결·알림 설정 ↗
            </Button>
          </div>
          <TabPanel value="today" className={s.panel}>
            <div className={s.toolbar}>
              <strong>
                {dayDate(day).toLocaleDateString("ko-KR", {
                  month: "long",
                  day: "numeric",
                  weekday: "long",
                })}
              </strong>
              <Button
                variant="quiet"
                size="compact"
                aria-label="이전 날짜"
                onClick={() => setDay(moveDay(day, -1))}
              >
                ‹
              </Button>
              <Button variant="secondary" size="compact" onClick={() => setDay(localDay())}>
                오늘
              </Button>
              <Button
                variant="quiet"
                size="compact"
                aria-label="다음 날짜"
                onClick={() => setDay(moveDay(day, 1))}
              >
                ›
              </Button>
              <div className={s.spacer} />
              <span className={s.caption}>
                할 일 {chosen.length}개 · 완료 {chosen.length - remaining.length}개
              </span>
            </div>
            <div className={s.split}>
              <aside className={s.column}>
                <h2 className={s.heading}>오늘 일정 · {dailyEvents.length}</h2>
                {!calendar || !connections.length ? (
                  <div className={s.empty}>
                    <p className={s.caption}>내 캘린더도 함께 볼 수 있어요.</p>
                    <Button variant="secondary" size="compact" onClick={() => openSettings()}>
                      캘린더 연결
                    </Button>
                    <p className={s.caption}>할 일은 계정 없이 사용할 수 있어요.</p>
                  </div>
                ) : (
                  <>
                    {connections.some((c) => !["ready", "syncing"].includes(text(c.status))) && (
                      <div role="status" className={s.error}>
                        캘린더를 갱신하지 못했어요.
                        <Button variant="quiet" size="compact" onClick={() => openSettings()}>
                          연결 확인 ↗
                        </Button>
                      </div>
                    )}
                    {!dailyEvents.length && (
                      <p className={s.caption}>이 날짜에 조회된 일정이 없어요.</p>
                    )}
                    {dailyEvents.map((e) => (
                      <button
                        type="button"
                        key={text(e.id)}
                        className={s.eventButton}
                        aria-pressed={event?.id === e.id}
                        onClick={() => setSelectedEvent(text(e.id))}
                      >
                        <span className={s.caption}>{eventTime(e)}</span>
                        <span>{text(e.title)}</span>
                        <span className={s.caption}>
                          {text(connections.find((c) => c.id === e.connectionId)?.name)}
                        </span>
                      </button>
                    ))}
                  </>
                )}
                {event && prep()}
                {lastSuccess > 0 && (
                  <p className={s.caption}>
                    마지막 확인 {new Date(lastSuccess).toLocaleString("ko-KR")} · 읽기 연결
                  </p>
                )}
              </aside>
              <section className={s.column} aria-label="오늘 할 일">
                <div className={s.actions}>
                  <h2 className={s.heading}>오늘 할 일</h2>
                  <div className={s.spacer} />
                  <Button
                    variant="quiet"
                    size="compact"
                    onClick={() => {
                      setPeriod("inbox");
                      setTab("plans");
                    }}
                  >
                    수집함 {inboxCount}
                  </Button>
                </div>
                {!todo ? (
                  <div className={s.empty}>
                    <p>계정 없이 첫 할 일을 시작해 보세요.</p>
                    <Button variant="primary" disabled={busy} onClick={() => void enableTodo()}>
                      할 일 시작하기
                    </Button>
                  </div>
                ) : (
                  <>
                    {quickInput(true)}
                    {!chosen.length && (
                      <div className={s.empty}>
                        <p>오늘 할 일 하나부터 적어 볼까요?</p>
                        <Button variant="quiet" size="compact" onClick={() => setTab("templates")}>
                          템플릿에서 고르기
                        </Button>
                      </div>
                    )}
                    <div className={s.list}>
                      {chosen.map((item) => (
                        <article
                          key={text(item.id)}
                          className={s.task}
                          data-selected={selectedTask === item.id}
                          onFocusCapture={() => setSelectedTask(text(item.id))}
                          onClick={() => setSelectedTask(text(item.id))}
                        >
                          {taskCheck(item)}
                          <span className={s.meta}>
                            {repeatLabel(item) ||
                              (typeof item.dueAt === "number"
                                ? clockLabel(item.dueAt)
                                : text(lists.find((l) => l.id === item.listId)?.name))}
                          </span>
                          <Button
                            variant="quiet"
                            size="compact"
                            aria-label={`${text(item.title)} 편집`}
                            onClick={() => edit(item)}
                          >
                            편집
                          </Button>
                        </article>
                      ))}
                    </div>
                    <div className={s.actions}>
                      <Button
                        variant="secondary"
                        size="compact"
                        disabled={!currentTask || busy}
                        onClick={async () => {
                          if (!timer) {
                            openSettings("focus-timer");
                            return;
                          }
                          if (
                            await act("start", { durationMs: 1500000, todoId: selectedTask }, timer)
                          ) {
                            setNotice("25분 집중을 시작했어요. 할 일 완료는 직접 표시해 주세요.");
                            await run(() => command("open_widget", { id: timer.id }));
                          }
                        }}
                      >
                        25분 집중
                      </Button>
                      <Button
                        variant="quiet"
                        size="compact"
                        disabled={!currentTask || busy}
                        onClick={() => void act("plan", { ids: [selectedTask], date: null })}
                      >
                        오늘에서 빼기
                      </Button>
                      <div className={s.spacer} />
                      <Button
                        variant="quiet"
                        size="compact"
                        onClick={() => {
                          setRollIds([]);
                          setRollDate(moveDay(day, 1));
                          setWrap(true);
                        }}
                      >
                        하루 마무리
                      </Button>
                    </div>
                  </>
                )}
                {calendar && <PlannerAlertNotice widget={calendar} act={act} />}
              </section>
            </div>
          </TabPanel>
          <TabPanel value="plans" className={s.panel}>
            <div className={s.toolbar}>
              <div className={s.actions} role="group" aria-label="계획 기간">
                {[...PERIODS, ["inbox", "수집함"]].map(([key, label]) => (
                  <Button
                    key={key}
                    variant="quiet"
                    size="compact"
                    className={s.categoryButton}
                    aria-pressed={period === key}
                    onClick={() => setPeriod(key)}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              <div className={s.spacer} />
              {!["someday", "inbox"].includes(period) && (
                <>
                  <Button
                    variant="quiet"
                    size="compact"
                    aria-label="이전 계획 기간"
                    onClick={() => setPlanDay(movePeriod(planDay, period, -1))}
                  >
                    ‹
                  </Button>
                  <span className={s.caption}>{periodAnchor(period, planDay)}</span>
                  <Button
                    variant="quiet"
                    size="compact"
                    aria-label="다음 계획 기간"
                    onClick={() => setPlanDay(movePeriod(planDay, period, 1))}
                  >
                    ›
                  </Button>
                </>
              )}
            </div>
            {todo ? (
              <>
                {quickInput(false)}
                <div className={s.actions}>
                  <Select
                    className={s.listSelect}
                    aria-label="조회할 목록"
                    value={visibleList}
                    onChange={(e) => setVisibleList(e.target.value)}
                  >
                    <option value="all">모든 목록</option>
                    {lists.map((l) => (
                      <option key={text(l.id)} value={text(l.id)}>
                        {text(l.name)}
                      </option>
                    ))}
                  </Select>
                  <Checkbox
                    checked={showCompleted}
                    onChange={(e) => setShowCompleted(e.target.checked)}
                  >
                    완료 포함
                  </Checkbox>
                  <Button variant="quiet" size="compact" onClick={() => setManageLists(true)}>
                    목록 관리
                  </Button>
                </div>
                <div style={{ overflow: "auto" }}>
                  <table className={s.table}>
                    <thead>
                      <tr>
                        <th>할 일</th>
                        <th>목록</th>
                        <th>기한·반복</th>
                        <th>오늘 계획</th>
                        <th>
                          <span className={s.visuallyHidden}>편집</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((item) => (
                        <tr key={text(item.id)}>
                          <td>{taskCheck(item)}</td>
                          <td className={s.caption}>
                            {text(lists.find((l) => l.id === item.listId)?.name)}
                          </td>
                          <td className={s.caption}>
                            {repeatLabel(item) || dueDay(item) || "날짜 없음"}
                          </td>
                          <td>
                            <Button
                              variant={plannedDay(item) === localDay() ? "quiet" : "secondary"}
                              size="compact"
                              disabled={busy}
                              onClick={() =>
                                void act("plan", {
                                  ids: [text(item.id)],
                                  date: plannedDay(item) === localDay() ? null : localDay(),
                                })
                              }
                            >
                              {plannedDay(item) === localDay() ? "오늘에 있음" : "오늘에 넣기"}
                            </Button>
                          </td>
                          <td>
                            <Button
                              variant="quiet"
                              size="compact"
                              aria-label={`${text(item.title)} 편집`}
                              onClick={() => edit(item)}
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
                      이 기간에 계획한 일이 없어요. 위에서 하나씩 추가해 보세요.
                    </p>
                  )}
                </div>
              </>
            ) : (
              <div className={s.empty}>
                <Button variant="primary" disabled={busy} onClick={() => void enableTodo()}>
                  할 일 시작하기
                </Button>
              </div>
            )}
          </TabPanel>
          <TabPanel value="calendar" className={s.panel}>
            <PlannerCalendar
              day={day}
              setDay={setDay}
              events={events}
              selected={text(event?.id)}
              onSelect={(value) => setSelectedEvent(text(value.id))}
              connections={connections}
              side={
                <>
                  {calendar ? (
                    prep()
                  ) : (
                    <Button variant="secondary" onClick={() => openSettings()}>
                      캘린더 연결
                    </Button>
                  )}
                  <section className={s.section}>
                    <h3 className={s.heading}>시간을 정한 할 일</h3>
                    {items
                      .filter(
                        (item) =>
                          typeof item.completedAt !== "number" &&
                          typeof item.dueAt === "number" &&
                          dueDay(item) === day,
                      )
                      .sort((a, b) => number(a.dueAt) - number(b.dueAt))
                      .map((item) => (
                        <div key={text(item.id)} className={s.actions}>
                          <span className={s.caption}>{clockLabel(number(item.dueAt))}</span>
                          {taskCheck(item)}
                          <Button
                            variant="quiet"
                            size="compact"
                            aria-label={`${text(item.title)} 시간 수정`}
                            onClick={() => edit(item)}
                          >
                            수정
                          </Button>
                        </div>
                      ))}
                    <h3 className={s.heading}>아직 시간을 정하지 않은 일</h3>
                    {remaining
                      .filter((item) => typeof item.dueAt !== "number")
                      .map((item) => (
                        <div key={text(item.id)} className={s.actions}>
                          {taskCheck(item)}
                          <Button
                            variant="quiet"
                            size="compact"
                            aria-label={`${text(item.title)} 시간 잡기`}
                            onClick={() => edit(item)}
                          >
                            시간 잡기
                          </Button>
                        </div>
                      ))}
                    <p className={s.caption}>
                      내장 할 일의 기한만 바뀝니다. 외부 일정은 수정하지 않아요.
                    </p>
                  </section>
                </>
              }
            />
          </TabPanel>
          <TabPanel value="templates" className={s.panel}>
            {todo ? (
              <PlannerTemplates act={act} busy={busy} />
            ) : (
              <div className={s.empty}>
                <p>할 일을 시작하면 템플릿을 사용할 수 있어요.</p>
                <Button variant="primary" disabled={busy} onClick={() => void enableTodo()}>
                  할 일 시작하기
                </Button>
              </div>
            )}
          </TabPanel>
        </Tabs>
      )}
      <footer className={s.footer}>
        {tab === "today"
          ? "오늘에 고른 일만 모아 봅니다. 계획 기간과 기한은 그대로 유지됩니다."
          : tab === "plans"
            ? "계획 기간은 목표를 묶는 기준입니다. 오늘에 넣어도 기한이나 반복 규칙은 바뀌지 않습니다."
            : tab === "calendar"
              ? "읽기 연결 · 외부 일정은 원본 캘린더에서 관리합니다."
              : "템플릿은 새 할 일을 만듭니다. 기존 항목의 제목과 반복은 바꾸지 않습니다."}
      </footer>
      {editing && (
        <TodoEditor
          key={`${text(editing.item.id)}:${editing.widget.revision}`}
          widgetId={editing.widget.id}
          item={editing.item}
          lists={lists}
          busy={busy}
          act={(action, input) => {
            const latest = items.find((item) => item.id === editing.item.id);
            if (!todo || JSON.stringify(latest) !== JSON.stringify(editing.item)) {
              setFailure(
                "이 항목이 다른 곳에서 변경되었습니다. 최신 내용을 다시 불러와 확인해 주세요.",
              );
              return Promise.resolve(false);
            }
            return act(action, input, todo);
          }}
          onReload={() => {
            const latest = items.find((item) => item.id === editing.item.id);
            if (latest && todo) setEditing({ item: latest, widget: todo });
          }}
          onClose={() => setEditing(null)}
        />
      )}
      <Dialog
        isOpen={wrap}
        title="오늘은 여기까지"
        size="small"
        onOpenChange={(open) => {
          if (!busy) setWrap(open);
        }}
        closeLabel="하루 마무리 닫기"
      >
        <form
          className={s.form}
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act("plan", { ids: rollIds, date: rollDate })) setWrap(false);
          }}
        >
          {failure && (
            <p role="alert" className={s.error}>
              {failure}
            </p>
          )}
          <p className={s.caption}>
            오늘 {chosen.length - remaining.length}개를 마쳤어요. 남은 일은 옮길 것만 골라요.
          </p>
          {remaining.map((item) => (
            <Checkbox
              key={text(item.id)}
              checked={rollIds.includes(text(item.id))}
              onChange={(e) =>
                setRollIds((old) =>
                  e.target.checked ? [...old, text(item.id)] : old.filter((id) => id !== item.id),
                )
              }
            >
              {text(item.title)}
            </Checkbox>
          ))}
          <FormField label="옮길 날짜" className={s.field}>
            <DateField required value={rollDate} onChange={(e) => setRollDate(e.target.value)} />
          </FormField>
          <p className={s.caption}>
            선택하지 않은 일은 현재 날짜에 그대로 남아요. 원래 기한과 계획 기간은 유지합니다.
          </p>
          <div className={s.actions}>
            <Button variant="quiet" type="button" onClick={() => setWrap(false)}>
              그대로 마치기
            </Button>
            <div className={s.spacer} />
            <Button type="submit" variant="primary" disabled={busy || !rollIds.length}>
              선택한 {rollIds.length}개 옮기기
            </Button>
          </div>
        </form>
      </Dialog>
      {manageLists && (
        <ListManager
          lists={lists}
          items={items}
          act={act}
          busy={busy}
          failure={failure}
          onClose={() => setManageLists(false)}
        />
      )}
      <Dialog
        isOpen={confirmClose}
        title="작성 중인 내용이 있어요"
        size="small"
        onOpenChange={setConfirmClose}
      >
        <p>저장하지 않은 내용을 버리고 플래너를 닫을까요?</p>
        <div className={s.actions}>
          <Button variant="secondary" onClick={() => setConfirmClose(false)}>
            계속 작성
          </Button>
          <Button
            variant="critical"
            onClick={async () => {
              leaving.current = true;
              await closeWindow();
            }}
          >
            버리고 닫기
          </Button>
        </div>
      </Dialog>
    </main>
  );
}

function ListManager({
  lists,
  items,
  act,
  busy,
  failure,
  onClose,
}: {
  lists: DataRecord[];
  items: DataRecord[];
  act: ToolAction;
  busy: boolean;
  failure: string | null;
  onClose: () => void;
}): ReactElement {
  const [name, setName] = useState("");
  const [renames, setRenames] = useState<Record<string, string>>({});
  return (
    <Dialog
      isOpen
      title="목록 관리"
      size="small"
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <div className={s.form}>
        {failure && (
          <p role="alert" className={s.error}>
            {failure}
          </p>
        )}
        <form
          className={s.quick}
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act("list-add", { name })) setName("");
          }}
        >
          <TextField
            aria-label="새 목록 이름"
            required
            maxLength={100}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <Button type="submit" variant="primary" disabled={busy}>
            목록 추가
          </Button>
        </form>
        {lists.map((list) => (
          <form
            key={text(list.id)}
            className={s.quick}
            onSubmit={(e) => {
              e.preventDefault();
              void act("list-rename", {
                id: text(list.id),
                name: renames[text(list.id)] ?? text(list.name),
              });
            }}
          >
            <TextField
              aria-label={`${text(list.name)} 이름`}
              required
              maxLength={100}
              value={renames[text(list.id)] ?? text(list.name)}
              onChange={(e) => setRenames((old) => ({ ...old, [text(list.id)]: e.target.value }))}
            />
            <Button type="submit" variant="secondary" size="compact" disabled={busy}>
              이름 저장
            </Button>
            <Button
              type="button"
              variant="quiet"
              size="compact"
              disabled={
                busy || list.id === "default" || items.some((item) => item.listId === list.id)
              }
              onClick={() => void act("list-delete", { id: text(list.id) })}
            >
              빈 목록 삭제
            </Button>
          </form>
        ))}
      </div>
    </Dialog>
  );
}
