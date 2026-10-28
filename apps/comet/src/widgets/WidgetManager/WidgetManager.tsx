import { Heading, Inline, Text } from "../../primitives";
import {
  Button,
  type ContextMenuAction,
  Dialog,
  SettingControlRow,
  SettingsSummary,
  Surface,
  Switch,
} from "@comet/ui";
import { Icon, SparkleIcon } from "@comet/icon";
import { WidgetDetailPreview } from "./WidgetDetailPreview";
import { DESKTOP_TOYS } from "../ToyTools/desktopToys";
import { canPlaceOnDesktop, useWidgetDesktop, type WidgetDesktopState } from "./useWidgetDesktop";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { listen } from "@tauri-apps/api/event";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { useWidgets } from "../useWidgets";
import { useGeneratedWidgets } from "../GeneratedWidgets/useGeneratedWidgets";
import { useWidgetRuntime } from "../useWidgetRuntime";
import type { WidgetView } from "../types";
import { record, rows, type ToolAction } from "../toolData";
import * as common from "../../common.css";
import { CONFIGURABLE_WIDGETS, WidgetSettings } from "./WidgetSettings";
import { GeneratedWidgetSettings } from "./GeneratedWidgetSettings";
import { WIDGET_ICONS, WidgetCatalog, type WidgetListEntry } from "./WidgetCatalog";
import * as details from "./widgetDetails.css";
import * as styles from "./widgetManager.css";

function descriptionOf(widget: WidgetView | undefined, kind: string, fallback: string): string {
  const data = record(widget?.data);
  if (kind === "calendar") return "다이어리와 바탕화면 위젯에서 써요";
  if (kind === "music") return "생활 정보 · 곡 정보만 읽어요";
  if (kind === "preparation") return "하루 도구 · 다이어리에서 써요";
  if (kind === "clock")
    return `하루 도구 · 바탕화면 위젯 · 기념일 ${rows(data.anniversaries).length}개`;
  if (kind === "weather") {
    const status =
      data.status === "ready"
        ? "정상"
        : data.configured === true
          ? "연결 확인 필요"
          : "지역 설정 필요";
    const minutes =
      typeof data.lastSuccessAt === "number"
        ? Math.max(0, Math.floor((Date.now() - data.lastSuccessAt) / 60_000))
        : null;
    return [
      "생활 정보",
      status,
      minutes === null ? "" : minutes === 0 ? "방금 확인" : `${minutes}분 전에 확인`,
    ]
      .filter(Boolean)
      .join(" · ");
  }
  return fallback;
}

export function WidgetManager({
  active = true,
  onDirtyChange,
  onBusyChange,
}: {
  /** Settings hosts the manager inline; there is no separate window header. */
  embedded?: true;
  active?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}): ReactElement {
  const { snapshot, error, reload } = useWidgets();
  const { workshop, error: generatedError, reload: reloadGenerated } = useGeneratedWidgets();
  const runtime = useWidgetRuntime(active);
  const desktop = useWidgetDesktop(active);
  const [detailOpen, setDetailOpen] = useState(false);
  const [inspectorSlot, setInspectorSlot] = useState<HTMLDivElement | null>(null);
  const [connectingCalendarId, setConnectingCalendarId] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [visitedSettings, setVisitedSettings] = useState<string[]>([]);
  const targetRevision = useRef(0);
  const officialView = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    const revision = targetRevision.current;
    let unlisten: (() => void) | undefined;
    function choose(kind: string | null): void {
      if (!active || !kind) return;
      targetRevision.current += 1;
      setDetailOpen(true);
      setFocused(kind);
      setVisitedSettings((before) => [...new Set([...before, kind])]);
    }
    void listen<string>("planner-settings-target", (event) => choose(event.payload))
      .then(async (cleanup) => {
        if (!active) {
          cleanup();
          return;
        }
        unlisten = cleanup;
        const kind = await command<string | null>("get_planner_settings_target");
        if (targetRevision.current === revision) choose(kind);
      })
      .catch(() => {
        /* The settings list remains available if an optional deep link fails. */
      });
    return () => {
      active = false;
      unlisten?.();
    };
  }, []);
  const [settingsBusy, setSettingsBusy] = useState<Record<string, boolean>>({});
  const reportBusy = useCallback((id: string, busy: boolean): void => {
    setSettingsBusy((previous) => (previous[id] === busy ? previous : { ...previous, [id]: busy }));
  }, []);
  const [settingsDirty, setSettingsDirty] = useState<Record<string, boolean>>({});
  const reportDirty = useCallback((id: string, dirty: boolean): void => {
    setSettingsDirty((previous) =>
      previous[id] === dirty ? previous : { ...previous, [id]: dirty },
    );
  }, []);
  useEffect(() => {
    onDirtyChange?.(Object.values(settingsDirty).some(Boolean));
  }, [settingsDirty, onDirtyChange]);
  function focusWidget(kind: string): void {
    const target = findView(kind);
    if (target && !CONFIGURABLE_WIDGETS.includes(kind)) {
      openCanonical(target);
      return;
    }
    targetRevision.current += 1;
    setDetailOpen(true);
    setFocused(kind);
    setVisitedSettings((previous) => [
      ...new Set([...previous, ...(selectedId ? [selectedId] : []), kind]),
    ]);
  }
  const [confirmation, setConfirmation] = useState<{ generatedId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const pending = useRef(false);
  const nestedBusy = Object.values(settingsBusy).some(Boolean);
  useEffect(() => {
    onBusyChange?.(busy || nestedBusy);
  }, [busy, nestedBusy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
  const canAct = isDesktop() && !busy && !nestedBusy;

  async function run(name: string, args?: Record<string, unknown>): Promise<boolean> {
    if (!canAct || pending.current) {
      return false;
    }
    pending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      const result = await command<unknown>(name, args);
      if (name.endsWith("_widget_desktop_item") || name === "set_widget_desktop_editing")
        desktop.receive(result as WidgetDesktopState);
      setConfirmation(null);
      reload();
      reloadGenerated();
      runtime.reload();
      return true;
    } catch (cause: unknown) {
      setFailure(errorText(cause));
      if (
        name === "generate_widget" ||
        name === "remove_generated_widget"
      ) {
        reloadGenerated();
      }
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const catalog = snapshot?.catalog ?? [];
  const widgets = snapshot?.widgets ?? [];
  const generatedWidgets = workshop.widgets.filter((item) => item.installed);
  const generated =
    generatedWidgets.find((item) => item.id === focused) ??
    (!catalog.some((item) => item.id === focused) && widgets.length === 0
      ? generatedWidgets[0]
      : undefined);
  const findView = (kind: string): WidgetView | undefined =>
    widgets.find((item) => item.kind === kind);
  const removedGenerated = confirmation
    ? generatedWidgets.find((item) => item.id === confirmation.generatedId)
    : undefined;
  const entries: WidgetListEntry[] = [
    ...catalog.map((item) => {
      const view = findView(item.id);
      return {
        ...item,
        reaction: view?.reaction ?? true,
        status: view?.status ?? "install-error",
        attention: Boolean(view && ["setup", "error", "install-error"].includes(view.status)),
      };
    }),
    ...generatedWidgets.map(
      (item) =>
        ({
          id: item.id,
          name: item.definition.name,
          description: item.definition.description,
          category: "generated",
          reaction: item.reaction,
          status: item.status === "ready" ? "enabled" : item.status,
          attention: item.status !== "ready",
        }) as const,
    ),
  ];
  const entry =
    catalog.find((item) => item.id === focused) ??
    catalog[0];
  const widget = entry ? findView(entry.id) : undefined;
  const selectedId = generated?.id ?? entry?.id;
  useLayoutEffect(() => {
    if (detailOpen && officialView.current) {
      officialView.current.scrollTop = 0;
      officialView.current.scrollLeft = 0;
    }
  }, [selectedId, detailOpen]);
  const placed = (id: string): boolean => Boolean(desktop.state?.order.includes(id));
  useEffect(() => {
    if (!selectedId) return;
    setVisitedSettings((previous) =>
      previous.includes(selectedId) ? previous : [...previous, selectedId],
    );
  }, [selectedId]);
  const running = runtime.snapshot?.widgets.find((item) => item.id === widget?.id);
  const runtimeError = running?.queryError ?? runtime.error;
  const hasLastConfirmation = !!running && (!running.queryError || !!running.lastConfirmed);
  const failureStatus = hasLastConfirmation ? "마지막 확인 상태 · 갱신 실패" : "확인 실패";
  const act: ToolAction = async (action, input = {}, target = widget) => {
    if (!target) {
      return false;
    }
    return run("execute_widget", {
      request: {
        requestId: crypto.randomUUID(),
        instanceId: target.id,
        expectedRevision: target.revision,
        action,
        input,
      },
    });
  };
  function openCanonical(target: WidgetView): void {
    if (DESKTOP_TOYS.includes(target.kind)) void act("desktop-open", {}, target);
    else void run(target.kind === "memo" ? "create_memo_note" : target.kind === "image" ? "add_widget_image" : "open_widget", { id: target.id });
  }
  function contextActions(id: string): ContextMenuAction[] {
    const target = findView(id);
    if (!target) {
      const item = generatedWidgets.find((widget) => widget.id === id);
      return item
        ? [
            {
              id: "toggle",
              label: item.reaction ? "캐릭터 반응 끄기" : "캐릭터 반응 켜기",
              disabled: !canAct,
            },
          ]
        : [];
    }
    const current = runtime.snapshot?.widgets.find((item) => item.id === target.id);
    const confirmed = !!current && (!current.queryError || !!current.lastConfirmed);
    const actions: ContextMenuAction[] = [];
    if (CONFIGURABLE_WIDGETS.includes(target.kind))
      actions.push({ id: "settings", label: "설정…", icon: "edit", disabled: !canAct });
    if (!["clock", "weather"].includes(target.kind))
      actions.push({
        id: "open",
        label:
          target.kind === "image"
            ? "이미지 띄우기"
            : target.kind === "memo"
            ? "새 메모 꺼내기"
            : DESKTOP_TOYS.includes(target.kind)
              ? "바탕화면에 꺼내기"
              : "위젯 열기",
        icon: "arrowright",
        disabled: !canAct,
      });
    if (canPlaceOnDesktop(target.kind))
      actions.push(
        placed(target.id)
          ? { id: "desktop-remove", label: "바탕화면에서 빼기", icon: "minus", disabled: !canAct }
          : {
              id: "desktop-add",
              label: "바탕화면에 놓기",
              icon: "plus",
              disabled: !canAct || !desktop.state,
            },
      );
    if (DESKTOP_TOYS.includes(target.kind))
      actions.push({ id: "clear", label: "장난감 정리하기", disabled: !canAct });
    if (target.kind === "image") {
      const images = rows(record(target.data).images);
      const closed = images.filter((image) => image.isOpen === false && typeof image.id === "string");
      actions.push({ id: "close-images", label: "띄운 이미지 정리", disabled: !canAct || !images.some((image) => image.isOpen === true) });
      actions.push({ id: "closed-images", label: `닫아 둔 이미지 ${closed.length}장 ›`, disabled: !canAct || closed.length === 0 });
    }
    if (confirmed && current?.toys)
      actions.push({
        id: "toy-status",
        label: `준비 중 ${current.toys.starting}개 · 표시 ${current.toys.visible}개`,
        disabled: true,
      });
    if (confirmed && current?.noteWindows)
      actions.push({
        id: "memo-status",
        label: `메모 ${current.noteWindows.open}개 열림 · ${current.noteWindows.visible}개 표시`,
        disabled: true,
      });
    if (current?.queryError || runtime.error)
      actions.push({
        id: "refresh-runtime",
        label: "상태 다시 확인",
        icon: "habit",
        disabled: !canAct,
      });
    if (current?.actionError)
      actions.push({ id: "action-error", label: current.actionError.message, disabled: true });
    if (target.kind !== "image") {
    actions.push({
      id: "toggle",
      label: target.reaction ? "캐릭터 반응 끄기" : "캐릭터 반응 켜기",
      disabled: !canAct,
      separatorBefore: true,
    });
    actions.push({
      id: "state-rules",
      label: "상태별 캐릭터 대사 편집",
      icon: "balloon",
      disabled: !canAct,
    });
    }
    return actions;
  }
  function submenuActions(kind: string, action: string): ContextMenuAction[] | undefined {
    if (kind !== "image" || action !== "closed-images") return undefined;
    const target = findView(kind);
    return rows(record(target?.data).images)
      .filter((image) => image.isOpen === false && typeof image.id === "string")
      .map((image, index) => ({
        id: `open-image:${image.id}`,
        label: `이미지 ${index + 1}${typeof image.addedAt === "number" ? ` · ${new Date(image.addedAt).toLocaleString()}` : ""}`,
        disabled: !canAct,
      }));
  }
  function contextAction(kind: string, action: string): void {
    const target = findView(kind);
    if (action === "toggle") {
      const reaction =
        target?.reaction ?? generatedWidgets.find((item) => item.id === kind)?.reaction;
      if (reaction !== undefined) {
        void run("set_widget_reaction", { id: target?.id ?? kind, enabled: !reaction });
      }
      return;
    }
    if (!target) return;
    if (action === "settings") focusWidget(kind);
    else if (action === "open") openCanonical(target);
    else if (action === "state-rules") void run("open_widget_state_rules", { id: target.id });
    else if (action === "clear") void act("desktop-clear", {}, target);
    else if (action === "close-images") void run("close_all_widget_images", { id: target.id });
    else if (action.startsWith("open-image:")) void run("open_widget_image", { id: target.id, imageId: action.slice("open-image:".length) });
    else if (action === "desktop-add") void run("add_widget_desktop_item", { id: target.id });
    else if (action === "desktop-remove") void run("remove_widget_desktop_item", { id: target.id });
    else if (action === "refresh-runtime") runtime.reload();
  }

  const catalogFooter = (
    <section className={styles.experiments} aria-label="실험 기능">
      <h2 className={styles.directorySectionTitle}>실험 기능</h2>
      <div className={styles.experimentRows}>
        <SettingsSummary
          title="AI 위젯 만들기"
          description={
            workshop.generationEligibility.reason || "연결한 AI로 필요한 위젯을 만들어요"
          }
          leading={
            <span className={styles.experimentIcon}>
              <SparkleIcon size={18} />
            </span>
          }
          trailingAction={{ label: "열기", icon: "habit" }}
          disabled={!canAct}
          onClick={() => void run("open_widget_workshop")}
        />
        <SettingControlRow
          title="대화 중에 자동으로 만들기"
          description="AI로 새 잡담 만들기가 켜져 있을 때만 동작해요"
          control={
            <Switch
              aria-label="대화에서 필요한 도구가 보이면 자동으로 만들기"
              checked={workshop.automatic}
              disabled={!canAct}
              onChange={(event) =>
                void run("set_widget_creation_automatic", { enabled: event.target.checked })
              }
            />
          }
        />
      </div>
      {busy && (
        <Text variant="caption" role="status">
          처리하고 있어요.
        </Text>
      )}
    </section>
  );

  return (
    <section className={styles.embedded} aria-label="위젯 관리">
      {error && (
        <Text as="p" role="alert" className={common.error}>
          {error}
        </Text>
      )}
      {generatedError && (
        <Inline gap="sm">
          <Text as="p" role="alert" className={common.error}>
            {generatedError}
          </Text>
          <Button variant="ghost" onClick={reloadGenerated}>
            AI 위젯 다시 불러오기
          </Button>
        </Inline>
      )}
      {failure && !confirmation && (
        <Text as="p" role="alert" className={common.error}>
          {failure}
        </Text>
      )}
      {!snapshot ? (
        error ? (
          <Button variant="ghost" onClick={reload}>
            다시 불러오기
          </Button>
        ) : (
          <Text as="p" role="status">
            위젯을 불러오고 있어요.
          </Text>
        )
      ) : (
        <div className={styles.directoryWorkspace}>
          {detailOpen && (
            <nav className={styles.breadcrumb} aria-label="위젯 위치">
              <Button
                variant="ghost"
                size="small"
                className={styles.backButton}
                aria-label="‹ 위젯"
                onClick={() => {
                  targetRevision.current += 1;
                  setDetailOpen(false);
                }}
              >
                <Icon name="chevleft" size={15} />
              </Button>
              <span>위젯</span>
              <Icon name="chev" size={13} />
              <strong>{generated?.definition.name ?? entry?.name}</strong>
            </nav>
          )}
          <div hidden={detailOpen} className={styles.directory}>
            <WidgetCatalog
              entries={entries}
              selectedId={selectedId}
              onSelect={focusWidget}
              menuActions={contextActions}
              submenuActions={submenuActions}
              onMenuAction={contextAction}
              onEditDesktop={() => void run("set_widget_desktop_editing", { editing: true })}
              disabled={!canAct}
              onToggle={(id, enabled) =>
                void run("set_widget_reaction", { id: findView(id)?.id ?? id, enabled })
              }
            >
              {catalogFooter}
            </WidgetCatalog>
          </div>
          {(entry || generated) && (
            <section
              className={styles.detail}
              hidden={!detailOpen}
              aria-label={`${generated?.definition.name ?? entry?.name} 설정`}
            >
              {generatedWidgets
                .filter((item) => visitedSettings.includes(item.id) || item.id === generated?.id)
                .map((item) => (
                  <div
                    className={styles.generatedView}
                    key={item.id}
                    hidden={item.id !== generated?.id}
                  >
                    <GeneratedWidgetSettings
                      widget={item}
                      eligibility={workshop.generationEligibility}
                      canAct={canAct}
                      run={run}
                      onRemove={() => {
                        setFailure(null);
                        setConfirmation({ generatedId: item.id });
                      }}
                      onDirtyChange={reportDirty}
                    />
                  </div>
                ))}
              {entry && (
                <div ref={officialView} className={styles.officialView} hidden={Boolean(generated)}>
                  <aside className={details.header} aria-label={`${entry.name} 미리보기와 사용`}>
                    {widget?.kind !== "focus-timer" && (
                      <header className={details.titleRow}>
                        <span className={details.icon}>
                          <Icon name={WIDGET_ICONS[entry.id] || "hash"} size={18} />
                        </span>
                        <div className={details.identity}>
                          <h1 className={details.title}>{entry.name}</h1>
                          <p className={details.subtitle}>
                            {descriptionOf(widget, entry.id, entry.description)}
                          </p>
                        </div>
                      </header>
                    )}
                    {widget && connectingCalendarId !== widget.id && (
                      <WidgetDetailPreview
                        widget={widget}
                        widgets={widgets}
                        shape={desktop.state?.shapes?.[widget.id]}
                        act={act}
                        disabled={!canAct}
                        onBusyChange={(value) => reportBusy(`${widget.id}:preview`, value)}
                      />
                    )}
                    <div ref={setInspectorSlot} className={details.inspectorSlot} />
                    {widget && canPlaceOnDesktop(widget.kind) && (
                      <div className={details.launch}>
                        {placed(widget.id) ? (
                          <Button
                            variant="ghost"
                            className={details.launchButton}
                            disabled={!canAct}
                            onClick={() =>
                              void run("remove_widget_desktop_item", { id: widget.id })
                            }
                          >
                            <Icon name="minus" size={15} />
                            바탕화면에서 빼기
                          </Button>
                        ) : (
                          <Button
                            variant={widget.kind === "preparation" ? "ghost" : "primary"}
                            className={details.launchButton}
                            disabled={!canAct || !desktop.state}
                            onClick={() => void run("add_widget_desktop_item", { id: widget.id })}
                          >
                            <Icon name="plus" size={15} />
                            바탕화면에 놓기
                          </Button>
                        )}
                        {desktop.error && (
                          <p role="alert" className={details.hint}>
                            바탕화면 위젯 상태를 읽지 못했어요 · {desktop.error}
                          </p>
                        )}
                      </div>
                    )}
                    {widget && widget.kind === "preparation" && (
                      <div className={details.launch}>
                        <Button
                          variant="primary"
                          className={details.launchButton}
                          disabled={!canAct}
                          onClick={() => openCanonical(widget)}
                        >
                          <Icon name="arrowright" size={15} />
                          사용 시작
                        </Button>
                        <p className={details.hint}>다이어리 › 준비 봉투가 열려요</p>
                      </div>
                    )}
                    {widget && CONFIGURABLE_WIDGETS.includes(widget.kind) && (
                      <div className={details.manage}>
                        <Button
                          variant="ghost"
                          size="small"
                          className={details.editLink}
                          aria-label="상태별 캐릭터 대사 편집"
                          disabled={!canAct}
                          onClick={() => void run("open_widget_state_rules", { id: widget.id })}
                        >
                          <Icon name="balloon" size={13} />
                          상태별 대사
                        </Button>
                      </div>
                    )}
                  </aside>
                  <div className={styles.detailBody}>
                    {(widget?.error ||
                      (runtimeError && widget) ||
                      running?.actionError) && (
                      <Surface variant="panel" className={styles.runtimeMessages}>
                        {widget?.error && (
                          <Text as="p" role="alert" className={common.error}>
                            {widget.error}
                          </Text>
                        )}
                        {runtimeError && widget && (
                          <div className={styles.runtimeError}>
                            <Text variant="caption" role="status">
                              {failureStatus} · {runtimeError}
                            </Text>
                            <Button variant="ghost" size="small" onClick={runtime.reload}>
                              다시 확인
                            </Button>
                          </div>
                        )}
                        {running?.actionError && (
                          <Text as="p" role="alert" className={common.error}>
                            {running.actionError.message}
                          </Text>
                        )}
                      </Surface>
                    )}
                    {widget && !CONFIGURABLE_WIDGETS.includes(widget.kind) && (
                      <Surface variant="panel" className={styles.genericPanel} role="status">
                        <Heading level={4} variant="label">
                          따로 정할 설정이 없어요
                        </Heading>
                        <Text as="p" variant="caption" tone="muted">
                          {widget.kind === "memo"
                            ? "새 낱장을 꺼내요. 저장한 메모는 다이어리의 메모에서 찾아 다시 열어요."
                            : `${entry.name}은 목록에서 바로 열어 써요.`}
                        </Text>
                        <Button
                          variant="primary"
                          disabled={!canAct}
                          onClick={() => openCanonical(widget)}
                        >
                          {widget.kind === "memo" ? "새 메모 꺼내기" : "열기"}
                        </Button>
                      </Surface>
                    )}
                    {widgets
                      .filter(
                        (item) =>
                          CONFIGURABLE_WIDGETS.includes(item.kind) &&
                          (visitedSettings.includes(item.kind) || item.id === widget?.id),
                      )
                      .map((item) => (
                        <div
                          className={styles.settingsView}
                          key={item.id}
                          hidden={item.id !== widget?.id}
                        >
                          <div className={styles.settings}>
                            <WidgetSettings
                              widget={item}
                              widgets={widgets}
                              onOpenRelated={focusWidget}
                              sideContainer={
                                item.id === widget?.id && detailOpen ? inspectorSlot : null
                              }
                              onConnectionOpenChange={(open) =>
                                setConnectingCalendarId((current) =>
                                  open ? item.id : current === item.id ? null : current,
                                )
                              }
                              active={active && !generated && item.id === widget?.id}
                              act={act}
                              onDirtyChange={reportDirty}
                              onBusyChange={reportBusy}
                              related={undefined}
                              disabled={!canAct}
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}
      <Dialog
        isOpen={active && confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !busy) {
            setConfirmation(null);
          }
        }}
        onCancel={(event) => {
          if (busy) {
            event.preventDefault();
          }
        }}
        title={`${removedGenerated?.definition.name ?? "위젯"} 제거`}
        closeLabel="닫기"
        variant="confirm"
        footer={
          <>
            <Button
              variant="danger"
              disabled={!canAct || !removedGenerated}
              onClick={() => {
                if (removedGenerated)
                  void run("remove_generated_widget", {
                    id: removedGenerated.id,
                    expectedRevision: removedGenerated.revision,
                  });
              }}
            >
              제거 확인
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmation(null)}>
              취소
            </Button>
          </>
        }
      >
        <div className={styles.dialogBody}>
          <Text as="p">작동과 대기 중인 반응을 멈춥니다. 작성한 데이터는 기본으로 보존합니다.</Text>
          <Text as="p" variant="caption" tone="muted">
            위젯 정의·작성 데이터·설치 정보는 이 기기에 보존합니다.
          </Text>
          {failure && (
            <Text as="p" role="alert" className={common.error}>
              {failure}
            </Text>
          )}
        </div>
      </Dialog>
    </section>
  );
}
