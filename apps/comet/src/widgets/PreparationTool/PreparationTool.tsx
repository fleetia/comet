import { FormField, Button, Checkbox, Select, TextField } from "../../ui";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { record, rows, text, type DataRecord, type ToolAction } from "../toolData";
import type { WidgetView } from "../types";
import { useConnectionCommand } from "../useConnectionCommand";
import { WidgetDragHandle } from "../WidgetDragHandle";
import { errorText } from "../../hooks/useSnapshot";
import * as c from "../../lagrange.css";
import * as s from "../tools.css";
export function PreparationTool({
  widget,
  widgets,
  act,
  onDirtyChange,
  onBusyChange,
}: {
  widget: WidgetView;
  widgets: WidgetView[];
  act: ToolAction;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}): ReactElement {
  const envelopes = rows(record(widget.data).envelopes);
  const calendar = widgets.find(
    (item) => item.kind === "calendar" && item.installed && item.enabled,
  );
  const allEvents = rows(record(calendar?.data).events);
  const connections = rows(record(calendar?.data).connections);
  const events = allEvents.filter(
    (event) =>
      event.cancelled !== true &&
      typeof event.connectionId === "string" && event.connectionId.trim() !== "" &&
      (event.connectionId === "local" ||
        connections.some((connection) => connection.id === event.connectionId)),
  );
  const { busy, error, run } = useConnectionCommand();
  const todos = rows(
    record(widgets.find((item) => item.kind === "todo" && item.installed && item.enabled)?.data)
      .items,
  );
  const [eventId, setEventId] = useState("");
  const [envelopeName, setEnvelopeName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const [drafts, setDrafts] = useState<Record<string, { dirty: boolean; busy: boolean }>>({});
  const reportDraft = useCallback((id: string, dirty: boolean, busy: boolean) => {
    setDrafts((previous) => ({ ...previous, [id]: { dirty, busy } }));
  }, []);
  const report = useRef({ onDirtyChange, onBusyChange });
  report.current = { onDirtyChange, onBusyChange };
  const createPending = useRef(false);
  const mounted = useRef(true);
  const scope = useRef({ id: widget.id, version: 0 });
  if (scope.current.id !== widget.id) scope.current = { id: widget.id, version: scope.current.version + 1 };
  const dirty = Boolean(
    envelopeName || eventId || Object.values(drafts).some((draft) => draft.dirty),
  );
  const saving = creating || Object.values(drafts).some((draft) => draft.busy);
  useEffect(() => {
    report.current.onDirtyChange?.(dirty);
    report.current.onBusyChange?.(saving);
  }, [dirty, saving]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      report.current.onDirtyChange?.(false);
      report.current.onBusyChange?.(false);
    };
  }, []);
  const chosen = events.find((event) => event.id === eventId);
  return (
    <>
      {error && (
        <p className={c.error} role="alert">
          {error}
        </p>
      )}
      <p className={c.quiet}>
        날짜가 정해지기 전부터 준비할 것과 자료를 모아두세요. 일정은 나중에 연결해도 돼요.
      </p>
      {createError && (
        <p className={c.error} role="alert">
          {createError}
        </p>
      )}
      <form
        className={s.body}
        onSubmit={async (e) => {
          e.preventDefault();
          const name = envelopeName.trim() || text(chosen?.title);
          if (!name || createPending.current) return;
          createPending.current = true;
          const version = scope.current.version;
          setCreating(true);
          setCreateError("");
          try {
            const ok = await act("create", {
              title: name,
              ...(chosen ? { eventId, eventLabel: text(chosen.title) } : {}),
            });
            if (!mounted.current || version !== scope.current.version) return;
            if (ok) {
              setEnvelopeName("");
              setEventId("");
            } else setCreateError("준비 봉투를 만들지 못했어요. 입력한 내용은 남아 있어요.");
          } catch (cause) {
            if (mounted.current && version === scope.current.version) setCreateError(errorText(cause));
          } finally {
            createPending.current = false;
            if (mounted.current) setCreating(false);
          }
        }}
      >
        <FormField className={c.field} label="준비 봉투 이름" required>
          <TextField
            maxLength={500}
            value={envelopeName}
            disabled={creating}
            placeholder={text(chosen?.title) || "무엇을 준비하나요?"}
            onChange={(e) => setEnvelopeName(e.target.value)}
          />
        </FormField>
        {events.length > 0 && (
          <FormField className={c.field} label="준비할 일정 (선택)">
            <Select
              value={eventId}
              disabled={creating}
              onChange={(e) => {
                setEventId(e.target.value);
                if (!envelopeName.trim())
                  setEnvelopeName(text(events.find((event) => event.id === e.target.value)?.title));
              }}
            >
              <option value="">날짜 없이 시작</option>
              {events.map((event) => (
                <option key={text(event.id)} value={text(event.id)}>
                  {text(event.title)} {text(event.startDate)}
                </option>
              ))}
            </Select>
          </FormField>
        )}
        <Button type="submit" variant="primary" disabled={creating || !envelopeName.trim()}>
          준비 봉투 만들기
        </Button>
      </form>
      {envelopes.map((envelope) => (
        <Envelope
          key={`${widget.id}:${text(envelope.id)}`}
          widget={widget}
          widgetId={widget.id}
          envelope={envelope}
          todos={todos}
          act={act}
          event={allEvents.find((item) => item.id === envelope.eventId)}
          connections={connections}
          hasCalendar={Boolean(calendar)}
          events={events}
          reportDraft={reportDraft}
          openingLink={busy}
          openLink={(url) => run("open_widget_link", { id: widget.id, url })}
        />
      ))}
    </>
  );
}
function Envelope({
  widget,
  widgetId,
  envelope,
  todos,
  act,
  event,
  connections,
  hasCalendar,
  openingLink,
  openLink,
  events,
  reportDraft,
}: {
  widget: WidgetView;
  widgetId: string;
  envelope: DataRecord;
  todos: DataRecord[];
  act: ToolAction;
  event: DataRecord | undefined;
  connections: DataRecord[];
  hasCalendar: boolean;
  openingLink: boolean;
  openLink: (url: string) => Promise<boolean>;
  events: DataRecord[];
  reportDraft: (id: string, dirty: boolean, busy: boolean) => void;
}): ReactElement {
  const [check, setCheck] = useState(""),
    [title, setTitle] = useState(""),
    [url, setUrl] = useState(""),
    [todoId, setTodoId] = useState("");
  const id = text(envelope.id);
  const connection = connections.find((item) => item.id === event?.connectionId);
  let connectionMessage: string | null = null;
  if (!text(envelope.eventId)) {
    connectionMessage = null;
  } else if (!hasCalendar) {
    connectionMessage =
      "연결 끊김 · 캘린더가 꺼져 있거나 제거되었습니다. 준비 내용은 계속 편집할 수 있어요.";
  } else if (
    !event ||
    event.cancelled === true ||
    (!connection && event.connectionId !== "local")
  ) {
    connectionMessage =
      "연결 끊김 · 원본 일정을 현재 찾을 수 없거나 취소되었습니다. 준비 내용은 보존됩니다.";
  } else if (event.connectionId === "local") {
    connectionMessage = null;
  } else if (connection?.status === "syncing") {
    connectionMessage = "일정 조회 중 · 마지막으로 확인한 준비 내용을 표시합니다.";
  } else if (connection?.status !== "ready") {
    connectionMessage =
      "이전 일정 정보 · 원본 연결이 최신 상태가 아닙니다. 캘린더 연결을 확인해 주세요.";
  }
  const linked = Array.isArray(envelope.todoIds)
    ? envelope.todoIds.filter((value): value is string => typeof value === "string")
    : [];
  return (
    <section className={s.item}>
      <h2 className={s.sectionTitle}>
        <WidgetDragHandle
          payload={{ v: 1, kind: "envelope", widgetId, itemId: id }}
          title={text(envelope.title) || text(envelope.eventLabel) || "준비 봉투"}
        />
        {text(envelope.title) || text(envelope.eventLabel) || "준비 봉투"}
        {envelope.archived === true ? " · 보관됨" : ""}
      </h2>
      {connectionMessage && (
        <p className={c.quiet} role="status">
          {connectionMessage}
        </p>
      )}
      <EnvelopeSchedule
        widget={widget}
        envelope={envelope}
        events={events}
        act={act}
        reportDraft={reportDraft}
      />
      {rows(envelope.checks).map((item) => (
        <div key={text(item.id)} className={s.row}>
          <Checkbox
            checked={item.done === true}
            onChange={() => void act("check-toggle", { id, checkId: text(item.id) })}
          >
            {text(item.text)}
          </Checkbox>
          <Button
            variant="quiet"
            onClick={() => void act("check-delete", { id, checkId: text(item.id) })}
          >
            체크 삭제
          </Button>
        </div>
      ))}
      <form
        className={s.composer}
        onSubmit={async (e) => {
          e.preventDefault();
          if (await act("check-add", { id, text: check })) {
            setCheck("");
          }
        }}
      >
        <FormField className={c.field} label="준비할 것" required>
          <TextField maxLength={1000} value={check} onChange={(e) => setCheck(e.target.value)} />
        </FormField>
        <Button type="submit" variant="secondary">
          체크 추가
        </Button>
      </form>
      {rows(envelope.links).map((link) => (
        <div key={text(link.id)} className={s.row}>
          <Button
            variant="secondary"
            disabled={openingLink}
            onClick={() => void openLink(text(link.url))}
          >
            {text(link.title)}
          </Button>
          <Button
            variant="quiet"
            onClick={() => void act("link-delete", { id, linkId: text(link.id) })}
          >
            링크 삭제
          </Button>
        </div>
      ))}
      <details className={s.disclosure}>
        <summary>자료 링크 추가</summary>
        <form
          className={s.composer}
          onSubmit={async (e) => {
            e.preventDefault();
            if (await act("link-add", { id, title, url })) {
              setTitle("");
              setUrl("");
            }
          }}
        >
          <FormField className={c.field} label="자료 이름" required>
            <TextField maxLength={500} value={title} onChange={(e) => setTitle(e.target.value)} />
          </FormField>
          <FormField className={c.field} label="자료 주소" required>
            <TextField type="url" value={url} onChange={(e) => setUrl(e.target.value)} />
          </FormField>
          <Button type="submit" variant="secondary">
            자료 링크 추가
          </Button>
        </form>
      </details>
      {linked.map((key) => (
        <div key={key} className={s.row}>
          <span>
            {text(todos.find((item) => item.id === key)?.title) || "연결된 할 일 (현재 조회 불가)"}
          </span>
          <Button variant="quiet" onClick={() => void act("todo-unlink", { id, todoId: key })}>
            할 일 연결 해제
          </Button>
        </div>
      ))}
      {todos.length > 0 && (
        <details className={s.disclosure}>
          <summary>할 일 연결</summary>
          <form
            className={s.composer}
            onSubmit={(e) => {
              e.preventDefault();
              void act("todo-link", { id, todoId });
            }}
          >
            <FormField className={c.field} label="할 일 연결" required>
              <Select value={todoId} onChange={(e) => setTodoId(e.target.value)}>
                <option value="">항목 선택</option>
                {todos
                  .filter((item) => !linked.includes(text(item.id)))
                  .map((item) => (
                    <option key={text(item.id)} value={text(item.id)}>
                      {text(item.title)}
                    </option>
                  ))}
              </Select>
            </FormField>
            <Button type="submit" variant="secondary">
              선택한 할 일 연결
            </Button>
          </form>
        </details>
      )}
      <Button variant="quiet" onClick={() => void act("delete", { id })}>
        이 준비 봉투 삭제
      </Button>
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
        <p className={c.error} role="alert">
          다른 곳에서 봉투가 바뀌었어요. 최신 연결을 확인한 뒤 다시 선택해 주세요.
        </p>
      )}
      {error && (
        <p className={c.error} role="alert">
          {error}
        </p>
      )}
      <div className={s.row}>
        <Button
          variant="secondary"
          disabled={busy || !dirty || conflict}
          onClick={() => void save()}
        >
          일정 연결 저장
        </Button>
        <Button variant="quiet" disabled={busy || (!dirty && !conflict)} onClick={reset}>
          {conflict ? "최신 연결 불러오기" : "연결 변경 취소"}
        </Button>
      </div>
    </details>
  );
}
