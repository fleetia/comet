import { Button, Dialog } from "@comet/ui";
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement, type SyntheticEvent } from "react";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { useWidgets } from "../useWidgets";
import { WidgetFrame } from "../WidgetFrame/WidgetFrame";
import { useWindowCloseGuard } from "../useWindowCloseGuard";
import { useWindowDrag } from "../../hooks/useWindowDrag";
import { record, type DataRecord } from "../toolData";
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
import * as frameStyles from "../WidgetFrame/widgetFrame.css";

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
  const triggeringControl = useRef<HTMLElement | null>(null);
  const lockedControl = useRef<HTMLElement | null>(null);
  const previousDisabled = useRef<string | null>(null);
  const [draftDirty, setDraftDirty] = useState(false);
  const [draftBusy, setDraftBusy] = useState(false);
  const [focusCloseReady, setFocusCloseReady] = useState(false);
  const focusCloseLayout = useRef<{ collapsed: boolean; resizing: { current: boolean }; expand: () => Promise<boolean> } | null>(null);
  const [showBusy, setShowBusy] = useState(false);
  useEffect(() => {
    if (!busy) {
      setShowBusy(false);
      return;
    }
    const timer = window.setTimeout(() => setShowBusy(true), 300);
    return () => window.clearTimeout(timer);
  }, [busy]);
  const widget = snapshot?.widgets.find((item) => item.id === id);
  const entry = snapshot?.catalog.find((entry) => entry.id === widget?.kind);
  const initialKind = new URLSearchParams(window.location.search).get("kind");
  const loadedKind = widget && entry ? widget.kind : undefined;
  const kind = snapshot ? loadedKind : error ? null : initialKind;
  const companion = [...COMPANION_KINDS, ...DESKTOP_TOYS].includes(kind ?? "");
  const transparent = kind === "focus-timer" || kind === "music" || companion;
  useLayoutEffect(() => {
    if (!transparent) return;
    document.documentElement.classList.add(transparentDocument);
    return () => document.documentElement.classList.remove(transparentDocument);
  }, [transparent]);
  const timerRunning = widget?.kind === "focus-timer" && record(widget.data).status === "running";
  const closeGuard = useWindowCloseGuard(
    draftDirty || timerRunning,
    draftBusy || (widget?.kind === "preparation" && busy),
    () => command("close_widget", { id }),
  );
  useEffect(() => {
    if (!closeGuard.confirmClose || widget?.kind !== "focus-timer") {
      setFocusCloseReady(false);
      return;
    }
    let active = true;
    const layout = focusCloseLayout.current;
    if (!layout || layout.resizing.current) {
      closeGuard.keepEditing();
      return;
    }
    if (!layout.collapsed) {
      setFocusCloseReady(true);
      return;
    }
    void layout.expand().then((success) => {
      if (!active) return;
      if (success) setFocusCloseReady(true);
      else closeGuard.keepEditing();
    });
    return () => { active = false; };
  }, [closeGuard.confirmClose, widget?.kind]);
  const musicDrag = useWindowDrag(widget?.kind === "music", setFailure);
  const requestClose = useRef(closeGuard.requestClose);
  requestClose.current = closeGuard.requestClose;
  useEffect(() => {
    if (
      !widget ||
      ![
        "music",
        "clock",
        "weather",
        "interaction",
        "small-match",
        "fortune",
        "guessing",
        "fishing",
        "plant",
        ...DESKTOP_TOYS,
      ].includes(widget.kind)
    )
      return;
    function onKeyDown(event: KeyboardEvent): void {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        (event.target instanceof Element &&
          event.target.closest(
            "input, textarea, select, [contenteditable]:not([contenteditable='false'])",
          )) ||
        document.querySelector("dialog[open], [role='dialog'], [role='menu']")
      )
        return;
      event.preventDefault();
      void requestClose.current().catch((cause: unknown) => setFailure(errorText(cause)));
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [widget?.kind]);
  async function run(operation: () => Promise<void>): Promise<boolean> {
    if (!isDesktop()) {
      setFailure(
        "미리보기에서는 저장하거나 실행하지 않아요. 실제 조작은 데스크톱 앱에서 할 수 있어요.",
      );
      return false;
    }
    if (pending.current) {
      setFailure("이전 작업을 마친 뒤 다시 시도해 주세요.");
      return false;
    }
    pending.current = true;
    const control = triggeringControl.current;
    if (control && control.getAttribute("aria-disabled") !== "true") {
      previousDisabled.current = control.getAttribute("aria-disabled");
      control.setAttribute("aria-disabled", "true");
      lockedControl.current = control;
    }
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
      if (previousDisabled.current === null) lockedControl.current?.removeAttribute("aria-disabled");
      else lockedControl.current?.setAttribute("aria-disabled", previousDisabled.current);
      lockedControl.current = null;
      previousDisabled.current = null;
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
  const name = entry?.name ?? "위젯";
  let status: string | undefined;
  if (widget) {
    if (widget.status === "setup") {
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
  } else if (!widget || !entry) {
    content = <p>도구를 찾을 수 없어요.</p>;
  } else {
    const props = { widget, widgets: snapshot.widgets, act };
    switch (widget.kind) {
      case "todo":
        content = <TodoTool {...props} />;
        footer = <p className={s.previewNote}>이 창을 닫아도 작성한 할 일은 유지됩니다.</p>;
        break;
      case "focus-timer":
        content = <TimerTool {...props} onClose={closeGuard.requestClose} busy={busy} onDirtyChange={setDraftDirty} closeLayoutRef={focusCloseLayout} />;
        break;
      case "clock":
        content = <ClockTool {...props} onDirtyChange={setDraftDirty} />;
        break;
      case "preparation":
        content = (
          <PreparationTool {...props} onDirtyChange={setDraftDirty} onBusyChange={setDraftBusy} />
        );
        footer = (
          <Button
            variant="ghost"
            onClickCapture={captureControl}
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
            onClickCapture={captureControl}
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
            error={failure || widget.error || undefined}
          />
        );
        break;
      default:
        content = <ToyTool {...props} characters={characters} userName={userName} />;
    }
  }
  const frameless = Boolean(
    kind &&
    ["music", "focus-timer", ...COMPANION_KINDS, ...DESKTOP_TOYS].includes(kind),
  );
  function captureControl(event: SyntheticEvent): void {
    const control = event.target instanceof Element
      ? event.target.closest<HTMLElement>("button, input, select, textarea, [role='button'], [role='switch']")
      : null;
    if (control && control === lockedControl.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    triggeringControl.current = control;
    window.setTimeout(() => {
      if (triggeringControl.current === control) triggeringControl.current = null;
    }, 0);
  }
  return (
    <WidgetFrame
      variant={frameless ? "frameless" : "tool"}
      className={companion ? frameStyles.companionFrame : frameless ? undefined : s.host}
      contentClassName={
        loadedKind === "music"
          ? s.musicContent
          : loadedKind === "focus-timer"
            ? s.focusContent
            : companion
              ? frameStyles.companionContent
            : undefined
      }
      title={name}
      closeLabel="위젯 닫기"
      onClose={closeGuard.requestClose}
      footer={footer}
      status={status}
      operationStatus={widget && kind !== "focus-timer" && kind !== "music" && (
        <p role="status" aria-hidden={!showBusy || Boolean(failure)} className={frameStyles.operationStatus}>
          {showBusy && !failure ? "처리 중…" : ""}
        </p>
      )}
    >
      {error && (
        <p role="alert" className={c.error}>
          {error}
        </p>
      )}
      {failure && !companion && (
        <p role="alert" className={c.error}>
          {failure}
        </p>
      )}
      {widget?.error && !["weather", "music"].includes(widget.kind) && <p className={c.error}>{widget.error}</p>}
      <div
        className={
          loadedKind === "music"
            ? s.musicBody
            : loadedKind === "focus-timer"
              ? s.focusBody
              : companion
                ? `${s.body} ${frameStyles.companionBody}`
              : s.body
        }
        onClickCapture={captureControl}
        onChangeCapture={captureControl}
        onKeyDownCapture={(event) => {
          if (event.key !== "Tab" && event.target === lockedControl.current) {
            event.preventDefault();
            event.stopPropagation();
          }
        }}
        onPointerDown={(event) => {
          if (widget?.kind !== "music") return;
          musicDrag.reset();
          if (
            !(event.target instanceof Element) ||
            !event.target.closest(
              "button, input, select, textarea, a, [contenteditable], [role='slider'], [role='region'][aria-label='음악 상세 내용']",
            )
          ) {
            musicDrag.onPointerDown(event);
          }
        }}
        onPointerMove={musicDrag.onPointerMove}
        onPointerUp={musicDrag.reset}
        onPointerCancel={musicDrag.reset}
      >
        {content}
      </div>
      <Dialog
        isOpen={closeGuard.confirmClose && (widget?.kind !== "focus-timer" || focusCloseReady)}
        title={draftDirty ? "작성 중인 내용이 있어요" : "집중 타이머가 실행 중이에요"}
        onOpenChange={(open) => {
          if (!open) closeGuard.keepEditing();
        }}
        variant="confirm"
        footer={
          <>
            <Button variant="ghost" onClick={closeGuard.keepEditing}>
              {draftDirty ? "계속 편집" : "계속 보기"}
            </Button>
            <Button
              variant="danger"
              disabled={busy || draftBusy}
              onClick={() => void closeGuard.discardAndClose()}
            >
              {draftDirty ? "저장하지 않고 닫기" : "창 닫기"}
            </Button>
          </>
        }
      >
        {draftDirty && <p>저장하지 않은 내용을 버리고 닫을까요?</p>}
        {timerRunning && <p>창을 닫아도 타이머는 계속 실행돼요.</p>}
        {closeGuard.closeError && <p role="alert">{closeGuard.closeError}</p>}
      </Dialog>
    </WidgetFrame>
  );
}
