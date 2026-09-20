import { Button } from "@fleetia/lagrange";
import { useRef, useState, type ReactElement } from "react";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { useWidgets } from "../useWidgets";
import { WidgetFrame } from "../WidgetFrame/WidgetFrame";
import { record, rows, text, type DataRecord } from "../toolData";
import type { WidgetView } from "../types";
import { ToyTool } from "../ToyTools/ToyTools";
import { TodoTool } from "../TodoTool/TodoTool";
import { ClockTool, TimerTool } from "../PlanningTools/PlanningTools";
import { MemoTool } from "../MemoTool/MemoTool";
import { PreparationTool } from "../PreparationTool/PreparationTool";
import { JournalTool } from "../JournalTool/JournalTool";
import { CalendarTool } from "../CalendarTool/CalendarTool";
import { ConnectionTool } from "../ConnectionTools/ConnectionTools";
import * as c from "../../lagrange.css";
import * as s from "../tools.css";

export function WidgetTool({ id }: { id: string }): ReactElement {
  const { snapshot, error, reload } = useWidgets();
  const [failure, setFailure] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const widget = snapshot?.widgets.find((item) => item.id === id);
  async function run(operation: () => Promise<void>): Promise<boolean> {
    if (!isDesktop()) {
      setFailure(
        "미리보기에서는 저장하거나 실행하지 않아요. 실제 조작은 데스크톱 앱에서 할 수 있어요.",
      );
      return false;
    }
    if (pending.current) {
      return false;
    }
    pending.current = true;
    setBusy(true);
    setFailure(null);
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
  async function act(
    action: string,
    input: DataRecord = {},
    target: WidgetView | undefined = widget,
  ): Promise<boolean> {
    if (!target) {
      return false;
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
  }
  const entry = snapshot?.catalog.find((entry) => entry.id === widget?.kind);
  const name = entry?.name ?? "위젯";
  let status: string | undefined;
  if (widget?.installed) {
    if (!widget.enabled) {
      status = "꺼짐";
    } else if (widget.status === "setup") {
      status = "연결·설정 필요";
    } else if (widget.status === "error") {
      status = "확인 필요";
    }
  }
  let content: ReactElement;
  let footer: ReactElement | undefined;
  if (!snapshot) {
    content = error ? (
      <div className={s.empty}>
        <p>도구를 불러오지 못했어요.</p>
        <Button variant="secondary" onClick={reload}>
          다시 불러오기
        </Button>
      </div>
    ) : (
      <p role="status">도구를 불러오고 있어요.</p>
    );
  } else if (!widget?.installed) {
    content = <p>설치되지 않았거나 제거한 도구입니다. 본체 메뉴의 위젯 관리에서 설치해 주세요.</p>;
  } else if (!widget.enabled) {
    content = <p>꺼진 도구입니다. 본체 메뉴의 위젯 관리에서 켜 주세요.</p>;
  } else {
    const props = { widget, widgets: snapshot.widgets, act };
    switch (widget.kind) {
      case "todo":
        content = <TodoTool {...props} />;
        break;
      case "focus-timer":
        content = <TimerTool {...props} />;
        break;
      case "memo":
        footer = (
          <Button
            variant="primary"
            size="compact"
            disabled={busy}
            onClick={() => void run(() => command("create_memo_note", { id }))}
          >
            + 새 메모
          </Button>
        );
        content = (
          <MemoTool
            {...props}
            busy={busy}
            openNote={(noteId, putAway) =>
              run(() =>
                command(putAway ? "request_close_memo_note" : "open_memo_note", { id, noteId }),
              )
            }
          />
        );
        break;
      case "clock":
        content = <ClockTool {...props} />;
        break;
      case "preparation":
        content = <PreparationTool {...props} />;
        break;
      case "journal":
        content = <JournalTool widget={widget} />;
        break;
      case "completion-jar": {
        const completed = rows(record(widget.data).completed);
        content = (
          <>
            <p className={s.number} aria-label="완료 구슬 수">
              {completed.length}
            </p>
            <div className={s.row} aria-hidden="true">
              {completed.slice(0, 100).map((item) => (
                <span key={text(item.id)}>●</span>
              ))}
            </div>
            {completed.length === 0 && <p>할 일을 직접 완료하면 구슬이 모여요.</p>}
            {completed.map((item) => (
              <p key={text(item.id)}>{text(item.title)}</p>
            ))}
          </>
        );
        break;
      }
      case "calendar":
        content = <CalendarTool widget={widget} act={act} />;
        break;
      case "weather":
      case "music":
      case "device":
        content = <ConnectionTool widget={widget} />;
        break;
      default:
        content = <ToyTool {...props} />;
        if (["ball", "paper-plane", "bubbles", "pet"].includes(widget.kind)) {
          footer = (
            <>
              <Button
                variant="secondary"
                size="compact"
                disabled={busy}
                onClick={() => void act("desktop-clear")}
              >
                정리하기
              </Button>
              <Button
                variant="primary"
                size="compact"
                disabled={busy}
                onClick={() => void act("desktop-open")}
              >
                바탕화면에 꺼내기
              </Button>
            </>
          );
        } else if (widget.kind === "collection") {
          footer = (
            <Button
              variant="secondary"
              size="compact"
              disabled={busy}
              onClick={() => void act("clear")}
            >
              소품 모두 넣기
            </Button>
          );
        }
    }
    if (["clock", "weather", "device"].includes(widget.kind)) {
      footer = (
        <>
          <Button
            variant="secondary"
            size="compact"
            disabled={busy}
            onClick={() => void run(() => command("close_widget_display", { id }))}
          >
            표시 닫기
          </Button>
          <Button
            variant="primary"
            size="compact"
            disabled={busy}
            onClick={() => void run(() => command("open_widget_display", { id }))}
          >
            바탕화면에 꺼내기
          </Button>
        </>
      );
    }
  }
  return (
    <WidgetFrame
      className={s.host}
      title={name}
      closeLabel="위젯 닫기"
      onClose={() => command("close_widget", { id })}
      footer={footer}
      status={status}
    >
      {error && (
        <p role="alert" className={c.error}>
          {error}
        </p>
      )}
      {failure && (
        <p role="alert" className={c.error}>
          {failure}
        </p>
      )}
      {widget?.error && <p className={c.error}>{widget.error}</p>}
      {!isDesktop() && (
        <p className={s.previewNote}>예시 데이터 미리보기 · 입력한 내용은 저장하지 않아요.</p>
      )}
      <fieldset className={s.body} disabled={busy}>
        {content}
      </fieldset>
      {busy && <p role="status">처리 중…</p>}
    </WidgetFrame>
  );
}
