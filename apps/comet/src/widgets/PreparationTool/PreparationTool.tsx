import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { Button, EnvelopeCard, SegmentedControl, Dialog } from "@comet/ui";
import { FormField, Select } from "../../ui";
import { command, errorText } from "../../hooks/useSnapshot";
import { localDay, record, rows, text, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import { DiaryEnvelope, envelopeTitle } from "../Planner/DiaryEnvelope";
import { useDiary } from "../Planner/useDiary";
import { frequencyRecords, plannedDay, ruleOf } from "../Planner/plannerData";
import { preparationFocusInput, preparationProgress } from "./preparationData";
import * as s from "./preparationRuntime.css";

export function PreparationTool({
  widget,
  widgets,
  act,
  onDirtyChange,
  onBusyChange,
  selectedId,
}: {
  widget: WidgetView;
  widgets: WidgetView[];
  act: ToolAction;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  selectedId?: string;
}): ReactElement {
  const diary = useDiary();
  const envelopes = rows(record(widget.data).envelopes);
  const [archived, setArchived] = useState(false);
  const [selected, setSelected] = useState(
    selectedId || text(envelopes.find((value) => value.archived !== true)?.id || envelopes[0]?.id),
  );
  const [nextSelection, setNextSelection] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { dirty: boolean; busy: boolean }>>({});
  const reportDraft = useCallback(
    (id: string, dirty: boolean, busy: boolean) =>
      setDrafts((previous) => ({ ...previous, [id]: { dirty, busy } })),
    [],
  );
  const taskRequest = useRef<{
    id: string;
    title: string;
    targetId: string;
    revision: number;
    scope: string;
  } | null>(null);
  const report = useRef({ onDirtyChange, onBusyChange });
  report.current = { onDirtyChange, onBusyChange };
  const dirty = Object.values(drafts).some((value) => value.dirty);
  const busy = Object.values(drafts).some((value) => value.busy) || diary.busy;
  useEffect(() => {
    report.current.onDirtyChange?.(dirty);
    report.current.onBusyChange?.(busy);
  }, [dirty, busy]);
  useEffect(
    () => () => {
      report.current.onDirtyChange?.(false);
      report.current.onBusyChange?.(false);
    },
    [],
  );
  useEffect(() => {
    if (selectedId) setSelected(selectedId);
  }, [selectedId]);
  const calendar = widgets.find(
    (value) => value.kind === "calendar" && value.installed && value.enabled,
  );
  const todo = widgets.find((value) => value.kind === "todo" && value.installed && value.enabled);
  const timer = widgets.find(
    (value) => value.kind === "focus-timer" && value.installed && value.enabled,
  );
  const connections = rows(record(calendar?.data).connections);
  const allEvents = rows(record(calendar?.data).events);
  const events = allEvents.filter(
    (event) =>
      event.cancelled !== true &&
      typeof event.connectionId === "string" &&
      event.connectionId.trim() &&
      (event.connectionId === "local" ||
        connections.some((value) => value.id === event.connectionId)),
  );
  const items = rows(record(todo?.data).items);
  const envelope =
    envelopes.find((value) => value.id === selected) ||
    envelopes.find((value) => Boolean(value.archived) === archived) ||
    envelopes[0];
  const event = allEvents.find((value) => value.id === envelope?.eventId);
  const source = connections.find((value) => value.id === event?.connectionId);
  const connectionMessage = !text(envelope?.eventId)
    ? ""
    : !calendar
      ? "연결 끊김 · 캘린더가 꺼져 있거나 제거되었습니다. 준비 내용은 계속 편집할 수 있어요."
      : !event || event.cancelled === true || (!source && event.connectionId !== "local")
        ? "연결 끊김 · 원본 일정을 현재 찾을 수 없거나 취소되었습니다. 준비 내용은 보존됩니다."
        : event.connectionId === "local"
          ? ""
          : source?.status === "syncing"
            ? "일정 조회 중 · 마지막으로 확인한 준비 내용을 표시합니다."
            : source?.status !== "ready"
              ? "이전 일정 정보 · 원본 연결이 최신 상태가 아닙니다. 캘린더 연결을 확인해 주세요."
              : "";
  function select(id: string): void {
    if (busy) return;
    if (dirty) setNextSelection(id);
    else setSelected(id);
  }
  async function openDiary(): Promise<void> {
    try {
      await command("open_planner_view", { tab: "envelopes" });
    } catch (cause) {
      setError(errorText(cause));
    }
  }
  return (
    <section className={s.root} aria-label="준비 봉투">
      {!selectedId && (
        <header className={s.header}>
          <h1 className={s.title}>준비 봉투</h1>
          <div className={s.actions}>
            <SegmentedControl
              label="준비 봉투 상태"
              value={archived ? "archived" : "preparing"}
              options={[
                { value: "preparing", label: "준비 중" },
                { value: "archived", label: "보관함" },
              ]}
              onValueChange={(value) => setArchived(value === "archived")}
              disabled={busy}
            />
            <Button size="small" onClick={() => void openDiary()}>
              준비 봉투 만들기
            </Button>
          </div>
        </header>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      {connectionMessage && (
        <p className={s.caption} role="status">
          {connectionMessage}
        </p>
      )}
      <div className={s.workspace} data-single={Boolean(selectedId)}>
        {!selectedId && (
          <aside className={s.list} aria-label="준비 봉투 목록">
            <span className={s.caption}>
              {archived ? "보관함" : "준비 중"} ·{" "}
              {envelopes.filter((value) => Boolean(value.archived) === archived).length}
            </span>
            {envelopes
              .filter((value) => Boolean(value.archived) === archived)
              .map((value) => (
                <EnvelopeCard
                  key={text(value.id)}
                  title={envelopeTitle(value)}
                  description={text(value.date) || text(value.eventLabel) || "날짜 없이 준비 중"}
                  selected={value.id === envelope?.id}
                  archived={value.archived === true}
                  {...preparationProgress(value, items)}
                  disabled={busy}
                  onClick={() => select(text(value.id))}
                />
              ))}
          </aside>
        )}
        {envelope ? (
          <DiaryEnvelope
            key={`${widget.id}:${text(envelope.id)}:${version}`}
            envelope={envelope}
            preparation={widget}
            items={items}
            events={events}
            notes={diary.state?.notes ?? []}
            pages={diary.state?.pages ?? []}
            busy={busy}
            act={(action, input, target) => act(action, input, target ?? widget)}
            diaryAction={async (action, input) => Boolean(await diary.mutate(action, input))}
            onDirtyChange={(value) => reportDraft(`detail:${text(envelope.id)}`, value, false)}
            onBusyChange={(value) => reportDraft(`detail-busy:${text(envelope.id)}`, false, value)}
            scheduleEditor={
              <EnvelopeSchedule
                widget={widget}
                envelope={envelope}
                events={events}
                act={act}
                reportDraft={reportDraft}
              />
            }
            onPlanTask={async (item) => {
              if (!todo) return false;
              const fromDate = plannedDay(item);
              return fromDate
                ? Boolean(
                    await diary.mutate("move-record", {
                      todoId: text(item.id),
                      fromDate,
                      toDate: localDay(),
                      title: text(item.title),
                    }),
                  )
                : act("plan", { ids: [text(item.id)], date: localDay() }, todo);
            }}
            onToggleTask={async (item) => {
              if (!todo) return false;
              const frequency = ruleOf(item).mode === "frequency";
              const entry = frequencyRecords(item, localDay()).find(
                (value) => value.date === localDay(),
              );
              return act(
                frequency
                  ? entry
                    ? "undo-frequency"
                    : "record-frequency"
                  : typeof item.completedAt === "number"
                    ? "undo"
                    : "complete",
                {
                  id: text(item.id),
                  ...(frequency
                    ? entry
                      ? { recordId: text(entry.id) }
                      : { date: localDay() }
                    : {}),
                },
                todo,
              );
            }}
            onCreateTask={async (title) => {
              if (!todo) {
                setError("할 일 위젯을 켜면 봉투에서 바로 할 일을 만들 수 있어요.");
                await command("open_planner_settings", { kind: "todo" });
                return null;
              }
              if (
                !taskRequest.current ||
                taskRequest.current.title !== title ||
                taskRequest.current.targetId !== todo.id ||
                taskRequest.current.scope !== `${widget.id}:${text(envelope.id)}`
              )
                taskRequest.current = {
                  id: crypto.randomUUID(),
                  title,
                  targetId: todo.id,
                  revision: todo.revision,
                  scope: `${widget.id}:${text(envelope.id)}`,
                };
              const request = taskRequest.current;
              const id = await command<string | null>("execute_widget", {
                request: {
                  requestId: request.id,
                  instanceId: request.targetId,
                  expectedRevision: request.revision,
                  action: "add",
                  input: { title, plannedDate: null },
                },
              });
              if (typeof id === "string" && id) {
                if (taskRequest.current === request) taskRequest.current = null;
                return id;
              }
              return null;
            }}
            onFocusEnvelope={() => {
              void (async () => {
                if (!timer) {
                  await command("open_planner_settings", { kind: "focus-timer" });
                  return;
                }
                if (
                  await act(
                    "start",
                    preparationFocusInput(
                      envelope,
                      events.find((value) => value.id === envelope.eventId),
                      calendar,
                    ),
                    timer,
                  )
                )
                  await command("open_widget", { id: timer.id });
              })().catch((cause) => setError(errorText(cause)));
            }}
            onOpenPage={(page) => {
              void command("open_planner_view", {
                tab: "today",
                entity: "page",
                targetId: page.id,
              }).catch((cause: unknown) => setError(errorText(cause)));
            }}
            onOpenEvent={(event) => {
              void command("open_planner_view", {
                tab: "calendar",
                entity: "event",
                targetId: text(event.id),
              }).catch((cause: unknown) => setError(errorText(cause)));
            }}
          />
        ) : (
          <div className={s.empty}>
            <p>준비할 것과 자료를 봉투에 모아 두세요.</p>
            <Button onClick={() => void openDiary()}>다이어리에서 새 준비 봉투 만들기</Button>
          </div>
        )}
      </div>
      <Dialog
        isOpen={nextSelection !== null}
        title="작성 중인 준비 내용이 있어요"
        onOpenChange={(open) => {
          if (!open) setNextSelection(null);
        }}
        variant="confirm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setNextSelection(null)}>
              계속 편집
            </Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (nextSelection !== null) setSelected(nextSelection);
                setNextSelection(null);
                setDrafts({});
                setVersion((value) => value + 1);
              }}
            >
              저장하지 않고 이동
            </Button>
          </>
        }
      >
        <p>입력한 내용을 버리고 다른 봉투로 이동할까요?</p>
      </Dialog>
    </section>
  );
}

function EnvelopeSchedule({
  widget,
  envelope,
  events,
  act,
  reportDraft,
}: {
  widget: WidgetView;
  envelope: DataRecord;
  events: DataRecord[];
  act: ToolAction;
  reportDraft: (id: string, dirty: boolean, busy: boolean) => void;
}): ReactElement {
  const id = text(envelope.id);
  const saved = text(envelope.eventId);
  const [base, setBase] = useState({ eventId: saved, revision: widget.revision });
  const [selected, setSelected] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const savedRequest = useRef<number | null>(null);
  const dirty = selected !== base.eventId;
  const conflict = dirty && widget.revision !== base.revision;
  useEffect(() => {
    if (savedRequest.current !== null && widget.revision <= savedRequest.current) return;
    savedRequest.current = null;
    if (!dirty && !pending.current) {
      setSelected(saved);
      setBase({ eventId: saved, revision: widget.revision });
    }
  }, [saved, widget.revision, dirty]);
  useEffect(() => {
    reportDraft(id, dirty, busy);
  }, [id, dirty, busy, reportDraft]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      reportDraft(id, false, false);
    };
  }, [id, reportDraft]);
  function reset(): void {
    generation.current += 1;
    savedRequest.current = null;
    setSelected(saved);
    setBase({ eventId: saved, revision: widget.revision });
    setError("");
  }
  async function save(): Promise<void> {
    if (pending.current || !dirty || conflict) return;
    const event = events.find((item) => item.id === selected);
    if (selected && !event) {
      setError("현재 연결할 수 있는 일정을 골라 주세요.");
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    const version = ++generation.current;
    try {
      const ok = await act(
        "update",
        { id, eventId: selected, eventLabel: text(event?.title) },
        { ...widget, revision: base.revision },
      );
      if (!mounted.current || version !== generation.current) return;
      if (ok) {
        savedRequest.current = base.revision;
        setBase({ eventId: selected, revision: base.revision });
      } else setError("일정 연결을 저장하지 못했어요. 선택은 남아 있어요.");
    } catch (cause) {
      if (mounted.current && version === generation.current) setError(String(cause));
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <details className={s.disclosure}>
      <summary>일정 연결 · 변경</summary>
      <FormField label="봉투에 연결할 일정">
        <Select
          value={selected}
          disabled={busy}
          onChange={(event) => {
            generation.current += 1;
            setSelected(event.target.value);
            setError("");
          }}
        >
          <option value="">연결 없음</option>
          {selected && !events.some((event) => event.id === selected) && (
            <option value={selected}>
              {text(envelope.eventLabel) || selected} · 현재 조회 불가
            </option>
          )}
          {events.map((event) => (
            <option key={text(event.id)} value={text(event.id)}>
              {text(event.title)} {text(event.startDate)}
            </option>
          ))}
        </Select>
      </FormField>
      {conflict && (
        <p className={s.error} role="alert">
          다른 곳에서 봉투가 바뀌었어요. 최신 연결을 확인한 뒤 다시 선택해 주세요.
        </p>
      )}
      {error && (
        <p className={s.error} role="alert">
          {error}
        </p>
      )}
      <div className={s.row}>
        <Button variant="ghost" disabled={busy || !dirty || conflict} onClick={() => void save()}>
          일정 연결 저장
        </Button>
        <Button variant="ghost" disabled={busy || (!dirty && !conflict)} onClick={reset}>
          {conflict ? "최신 연결 불러오기" : "연결 변경 취소"}
        </Button>
      </div>
    </details>
  );
}
