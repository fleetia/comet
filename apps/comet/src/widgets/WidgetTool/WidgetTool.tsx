import { Button, Dialog } from "@comet/ui";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { useWidgets } from "../useWidgets";
import { WidgetFrame } from "../WidgetFrame/WidgetFrame";
import { useWindowCloseGuard } from "../useWindowCloseGuard";
import type { DataRecord } from "../toolData";
import type { WidgetView } from "../types";
import type { CharacterCollection } from "../../types";
import { CompanionTool, ToyTool } from "../ToyTools/ToyTools";
import { TodoTool } from "../TodoTool/TodoTool";
import { ClockTool, TimerTool } from "../PlanningTools/PlanningTools";
import { PreparationTool } from "../PreparationTool/PreparationTool";
import { CalendarTool } from "../CalendarTool/CalendarTool";
import { ConnectionTool } from "../ConnectionTools/ConnectionTools";
import { BatteryTool } from "../ConnectionTools/BatteryTool";
import { CompletionJarTool } from "../CompletionJar/CompletionJarTool";
import { CollapsedDesktopWidget } from "../WidgetDisplay/DesktopWidget";
import { DESKTOP_TOYS } from "../ToyTools/desktopToys";

/** Kinds drawn as a floating card or companion scene instead of a tool window. */
const COMPANION_KINDS = [
  "interaction",
  "small-match",
  "fortune",
  "guessing",
  "fishing",
  "plant",
  "completion-jar",
  "device",
];
import { transparentDocument } from "../../components/companion.css";
import * as c from "../../common.css";
import * as s from "../tools.css";

export function WidgetTool({
  id,
  characters,
  userName,
}: {
  id: string;
  characters?: CharacterCollection;
  userName?: string;
}): ReactElement {
  const { snapshot, error, reload } = useWidgets();
  const [failure, setFailure] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const widget = snapshot?.widgets.find((item) => item.id === id);
  const transparent = widget?.kind === "focus-timer";
  useEffect(() => {
    if (!transparent) return;
    document.documentElement.classList.add(transparentDocument);
    return () => document.documentElement.classList.remove(transparentDocument);
  }, [transparent]);
  const closeGuard = useWindowCloseGuard(
    draftDirty,
    draftBusy || (widget?.kind === "preparation" && busy),
    () => command("close_widget", { id }),
  );
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
        <Button variant="ghost" onClick={reload}>
          다시 불러오기
        </Button>
      </div>
    ) : (
      <p role="status">도구를 불러오고 있어요.</p>
    );
  } else if (!widget?.installed || !entry) {
    content = <p>설치되지 않았거나 제거한 도구입니다. 본체 메뉴의 위젯 관리에서 설치해 주세요.</p>;
  } else if (!widget.enabled) {
    content = <p>꺼진 도구입니다. 본체 메뉴의 위젯 관리에서 켜 주세요.</p>;
  } else {
    const props = { widget, widgets: snapshot.widgets, act };
    switch (widget.kind) {
      case "todo":
        content = <TodoTool {...props} />;
        footer = (
          <p className={s.previewNote}>
            이 창을 닫아도 작성한 할 일과 위젯 사용 상태는 유지됩니다.
          </p>
        );
        break;
      case "focus-timer":
        content = (
          <TimerTool
            {...props}
            onClose={closeGuard.requestClose}
            busy={busy}
            companionRows={(now) =>
              ["clock", "weather", "music", "preparation"].flatMap((kind) =>
                snapshot.widgets
                  .filter((item) => item.kind === kind && item.installed && item.enabled)
                  .map((item) => (
                    <CollapsedDesktopWidget
                      key={item.id}
                      widget={item}
                      widgets={snapshot.widgets}
                      now={now}
                      onExpand={() => void run(() => command("open_widget", { id: item.id }))}
                    />
                  )),
              )
            }
          />
        );
        break;
      case "clock":
        content = <ClockTool {...props} />;
        break;
      case "preparation":
        content = (
          <PreparationTool {...props} onDirtyChange={setDraftDirty} onBusyChange={setDraftBusy} />
        );
        footer = (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void run(() => command("open_planner_settings", { kind: "calendar" }))}
          >
            캘린더 연결 설정
          </Button>
        );
        break;
      case "calendar":
        content = <CalendarTool widget={widget} act={act} />;
        break;
      case "music":
        content = (
          <ConnectionTool widget={widget} onCollapse={() => void closeGuard.requestClose()} />
        );
        break;
      case "weather":
        content = <ConnectionTool widget={widget} />;
        footer = (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void run(() => command("open_planner_settings", { kind: "weather" }))}
          >
            날씨 설정 열기
          </Button>
        );
        break;
      case "completion-jar":
      case "device":
        content = (
          <CompanionTool
            widget={widget}
            act={act}
            onClose={closeGuard.requestClose}
            busy={busy}
            error={failure || undefined}
          >
            {widget.kind === "device" ? (
              <BatteryTool widget={widget} />
            ) : (
              <CompletionJarTool widget={widget} />
            )}
          </CompanionTool>
        );
        break;
      case "interaction":
      case "small-match":
      case "fortune":
      case "guessing":
      case "fishing":
      case "plant":
      case "ball":
      case "paper-plane":
      case "bubbles":
      case "pet":
        content = (
          <CompanionTool
            widget={widget}
            widgets={snapshot?.widgets ?? []}
            act={act}
            characters={characters}
            userName={userName}
            onClose={closeGuard.requestClose}
            busy={busy}
            error={failure || widget.error || undefined}
          />
        );
        break;
      default:
        content = <ToyTool {...props} characters={characters} userName={userName} />;
    }
  }
  const frameless = Boolean(
    widget?.installed &&
    widget.enabled &&
    ["music", "focus-timer", ...COMPANION_KINDS, ...DESKTOP_TOYS].includes(widget.kind),
  );
  return (
    <WidgetFrame
      variant={frameless ? "frameless" : "tool"}
      className={frameless ? undefined : s.host}
      contentClassName={
        widget?.kind === "music"
          ? s.musicContent
          : widget?.kind === "focus-timer"
            ? s.focusContent
            : undefined
      }
      title={name}
      closeLabel="위젯 닫기"
      onClose={closeGuard.requestClose}
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
      <fieldset
        className={
          widget?.kind === "music"
            ? s.musicBody
            : widget?.kind === "focus-timer"
              ? s.focusBody
              : s.body
        }
        disabled={busy && widget?.kind !== "focus-timer"}
      >
        {content}
      </fieldset>
      {busy && <p role="status">처리 중…</p>}
      <Dialog
        isOpen={closeGuard.confirmClose}
        title="작성 중인 내용이 있어요"
        onOpenChange={(open) => {
          if (!open) closeGuard.keepEditing();
        }}
        variant="confirm"
        footer={
          <>
            <Button variant="ghost" onClick={closeGuard.keepEditing}>
              계속 편집
            </Button>
            <Button
              variant="danger"
              disabled={busy || draftBusy}
              onClick={() => void closeGuard.discardAndClose()}
            >
              저장하지 않고 닫기
            </Button>
          </>
        }
      >
        <p>저장하지 않은 내용을 버리고 닫을까요?</p>
        {closeGuard.closeError && <p role="alert">{closeGuard.closeError}</p>}
      </Dialog>
    </WidgetFrame>
  );
}
