import { Button } from "@fleetia/lagrange";
import { useRef, useState, type ReactElement } from "react";
import { command, errorText, isDesktop } from "../hooks/useSnapshot";
import { useWidgets } from "./useWidgets";
import { WindowHeader } from "../components/WindowHeader";
import { record, rows, text, type DataRecord } from "./toolData";
import type { WidgetView } from "./types";
import { ToyTool } from "./ToyTools";
import { TodoTool } from "./TodoTool";
import { ClockTool, MemoTool, TimerTool } from "./PlanningTools";
import { PreparationTool } from "./PreparationTool";
import { JournalTool } from "./JournalTool";
import { CalendarTool } from "./CalendarTool";
import { ConnectionTool } from "./ConnectionTools";
import * as c from "../lagrange.css";
import * as s from "./tools.css";

export function WidgetTool({ id }: { id: string }): ReactElement {
  const { snapshot, error, reload } = useWidgets();
  const [failure, setFailure] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const widget = snapshot?.widgets.find((item) => item.id === id);
  async function act(
    action: string,
    input: DataRecord = {},
    target: WidgetView | undefined = widget,
  ): Promise<boolean> {
    if (!isDesktop()) {
      setFailure(
        "미리보기에서는 저장하거나 실행하지 않아요. 실제 조작은 데스크톱 앱에서 할 수 있어요.",
      );
      return false;
    }
    if (!target || pending.current) {
      return false;
    }
    pending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await command("execute_widget", {
        request: {
          requestId: crypto.randomUUID(),
          instanceId: target.id,
          expectedRevision: target.revision,
          action,
          input,
        },
      });
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
  async function openManager(): Promise<void> {
    if (!isDesktop()) {
      window.location.assign("?view=widgets&preview=installed");
      return;
    }
    try {
      await command("open_widgets");
    } catch (cause: unknown) {
      setFailure(errorText(cause));
    }
  }
  const entry = snapshot?.catalog.find((entry) => entry.id === widget?.kind);
  const name = entry?.name ?? "위젯";
  const category =
    entry?.category === "play"
      ? "장난감"
      : entry?.category === "connections"
        ? "외부 연결"
        : "생활 도구";
  let content: ReactElement;
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
    content = <p>설치되지 않았거나 제거한 도구입니다. 위젯 관리에서 설치해 주세요.</p>;
  } else if (!widget.enabled) {
    content = <p>꺼진 도구입니다. 위젯 관리에서 켜 주세요.</p>;
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
        content = <MemoTool {...props} />;
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
    }
  }
  return (
    <main className={s.host}>
      <WindowHeader
        className={s.header}
        label="위젯 닫기"
        onClose={() => command("close_widget", { id })}
        actions={
          <Button variant="quiet" size="compact" onClick={() => void openManager()}>
            위젯 관리
          </Button>
        }
      >
        <p className={s.eyebrow}>{category}</p>
        <h1 className={s.title}>{name}</h1>
        {widget?.installed &&
          (!widget.enabled || widget.status === "setup" || widget.status === "error") && (
            <span className={s.status}>
              {!widget.enabled
                ? "꺼짐"
                : widget.status === "setup"
                  ? "연결·설정 필요"
                  : "확인 필요"}
            </span>
          )}
      </WindowHeader>
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
    </main>
  );
}
