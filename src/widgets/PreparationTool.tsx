import { FormField, Button, Checkbox, Select, TextField } from "@fleetia/lagrange";
import { useState, type ReactElement } from "react";
import { record, rows, text, type DataRecord, type ToolAction } from "./toolData";
import type { WidgetView } from "./types";
import { useConnectionCommand } from "./useConnectionCommand";
import * as c from "../lagrange.css";
import * as s from "./tools.css";
export function PreparationTool({
  widget,
  widgets,
  act,
}: {
  widget: WidgetView;
  widgets: WidgetView[];
  act: ToolAction;
}): ReactElement {
  const envelopes = rows(record(widget.data).envelopes);
  const calendar = widgets.find(
    (item) => item.kind === "calendar" && item.installed && item.enabled,
  );
  const allEvents = rows(record(calendar?.data).events);
  const connections = rows(record(calendar?.data).connections);
  const events = allEvents.filter((event) => event.cancelled !== true);
  const { busy, error, run } = useConnectionCommand();
  const todos = rows(
    record(widgets.find((item) => item.kind === "todo" && item.installed && item.enabled)?.data)
      .items,
  );
  const [eventId, setEventId] = useState("");
  const chosen = events.find((event) => event.id === eventId);
  return (
    <>
      {error && (
        <p className={c.error} role="alert">
          {error}
        </p>
      )}
      {events.length === 0 ? (
        <p className={c.quiet}>
          조회 가능한 일정이 없어요. 캘린더를 연결하면 새 준비 봉투를 만들 수 있어요. 기존 준비
          내용은 계속 편집할 수 있어요.
        </p>
      ) : (
        <form
          className={s.body}
          onSubmit={(e) => {
            e.preventDefault();
            if (chosen) {
              void act("create", { eventId, eventLabel: text(chosen.title) });
            }
          }}
        >
          <FormField className={c.field} label="준비할 일정" required>
            <Select value={eventId} onChange={(e) => setEventId(e.target.value)}>
              <option value="">일정 선택</option>
              {events.map((event) => (
                <option key={text(event.id)} value={text(event.id)}>
                  {text(event.title)} {text(event.startDate)}
                </option>
              ))}
            </Select>
          </FormField>
          <Button type="submit" variant="primary" disabled={!chosen}>
            준비 봉투 만들기
          </Button>
        </form>
      )}
      {envelopes.map((envelope) => (
        <Envelope
          key={text(envelope.id)}
          envelope={envelope}
          todos={todos}
          act={act}
          event={allEvents.find((item) => item.id === envelope.eventId)}
          connections={connections}
          hasCalendar={Boolean(calendar)}
          openingLink={busy}
          openLink={(url) => run("open_widget_link", { id: widget.id, url })}
        />
      ))}
    </>
  );
}
function Envelope({
  envelope,
  todos,
  act,
  event,
  connections,
  hasCalendar,
  openingLink,
  openLink,
}: {
  envelope: DataRecord;
  todos: DataRecord[];
  act: ToolAction;
  event: DataRecord | undefined;
  connections: DataRecord[];
  hasCalendar: boolean;
  openingLink: boolean;
  openLink: (url: string) => Promise<boolean>;
}): ReactElement {
  const [check, setCheck] = useState(""),
    [title, setTitle] = useState(""),
    [url, setUrl] = useState(""),
    [todoId, setTodoId] = useState("");
  const id = text(envelope.id);
  const connection = connections.find((item) => item.id === event?.connectionId);
  let connectionMessage: string | null = null;
  if (!hasCalendar) {
    connectionMessage =
      "연결 끊김 · 캘린더가 꺼져 있거나 제거되었습니다. 준비 내용은 계속 편집할 수 있어요.";
  } else if (!event || event.cancelled === true || !connection) {
    connectionMessage =
      "연결 끊김 · 원본 일정을 현재 찾을 수 없거나 취소되었습니다. 준비 내용은 보존됩니다.";
  } else if (connection.status === "syncing") {
    connectionMessage = "일정 조회 중 · 마지막으로 확인한 준비 내용을 표시합니다.";
  } else if (connection.status !== "ready") {
    connectionMessage =
      "이전 일정 정보 · 원본 연결이 최신 상태가 아닙니다. 캘린더 연결을 확인해 주세요.";
  }
  const linked = Array.isArray(envelope.todoIds)
    ? envelope.todoIds.filter((value): value is string => typeof value === "string")
    : [];
  return (
    <section className={s.item}>
      <h2>{text(envelope.eventLabel)}</h2>
      {connectionMessage && (
        <p className={c.quiet} role="status">
          {connectionMessage}
        </p>
      )}
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
