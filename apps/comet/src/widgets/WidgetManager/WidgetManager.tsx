import { Button, Checkbox, Dialog, Heading, Inline, Surface, Text } from "../../ui";
import { SettingControlRow, SettingsSummary, Switch } from "@comet/ui";
import { Icon, SparkleIcon } from "@comet/icon";
import { WidgetDetailPreview } from "./WidgetDetailPreview";
import { ClockSettings } from "../PlanningTools/PlanningTools";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { listen } from "@tauri-apps/api/event";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { WindowHeader } from "../../components/WindowHeader/WindowHeader";
import { useWidgets } from "../useWidgets";
import { useGeneratedWidgets } from "../GeneratedWidgets/useGeneratedWidgets";
import { useWidgetRuntime } from "../useWidgetRuntime";
import type { WidgetView, WindowState } from "../types";
import { record, type ToolAction } from "../toolData";
import * as common from "../../lagrange.css";
import { CONFIGURABLE_WIDGETS, DISPLAY_KINDS, WidgetSettings } from "./WidgetSettings";
import { GeneratedWidgetSettings } from "./GeneratedWidgetSettings";
import { WIDGET_ICONS, WidgetCatalog, type WidgetListEntry } from "./WidgetCatalog";
import { WidgetGuide } from "./WidgetGuide";
import * as details from "./widgetDetails.css";
import * as styles from "./widgetManager.css";

const OPTIONAL_CONNECTIONS: Record<string, Record<string, string>> = {
  todo: { "focus-timer": "할 일을 정하고 집중하기", preparation: "준비할 일을 봉투에 모으기" },
  "focus-timer": { todo: "집중할 일을 선택하고 완료하기" },
  preparation: {
    todo: "할 일을 연결하거나 체크 항목을 할 일로 옮기기",
    calendar: "준비 봉투에 일정 연결하기",
  },
  calendar: { preparation: "일정에 필요한 준비 모으기" },
};
const DESKTOP_TOYS = ["ball", "paper-plane", "bubbles"];

export function WidgetManager({
  embedded = false,
  active = true,
  onDirtyChange,
  onBusyChange,
}: {
  embedded?: boolean;
  active?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}): ReactElement {
  const { snapshot, error, reload } = useWidgets();
  const { workshop, error: generatedError, reload: reloadGenerated } = useGeneratedWidgets();
  const runtime = useWidgetRuntime(active);
  const [installTarget, setInstallTarget] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [inspectorSlot, setInspectorSlot] = useState<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [visitedSettings, setVisitedSettings] = useState<string[]>([]);
  const targetRevision = useRef(0);
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
    targetRevision.current += 1;
    setDetailOpen(true);
    setFocused(kind);
    setVisitedSettings((previous) => [
      ...new Set([...previous, ...(selectedId ? [selectedId] : []), kind]),
    ]);
  }
  const [confirmation, setConfirmation] = useState<
    "install" | WidgetView | { generatedId: string } | null
  >(null);
  const [deleteData, setDeleteData] = useState(false);
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
      await command(name, args);
      setConfirmation(null);
      if (name === "install_widgets") {
        setInstallTarget(null);
      }
      reload();
      reloadGenerated();
      runtime.reload();
      return true;
    } catch (cause: unknown) {
      setFailure(errorText(cause));
      if (
        name === "generate_widget" ||
        name === "set_generated_widget_enabled" ||
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
    (!catalog.some((item) => item.id === focused) && !widgets.some((item) => item.installed)
      ? generatedWidgets[0]
      : undefined);
  const findView = (kind: string): WidgetView | undefined =>
    widgets.find((item) => item.kind === kind);
  const nameOf = (kind: string): string => catalog.find((item) => item.id === kind)?.name ?? kind;
  function installationPlan(target: string | null): string[] {
    const kinds = new Set(target && !findView(target)?.installed ? [target] : []);
    function addRequired(kind: string): void {
      for (const required of catalog.find((item) => item.id === kind)?.required ?? []) {
        const existing = findView(required);
        if ((!existing?.installed || !existing.enabled) && !kinds.has(required)) {
          kinds.add(required);
          addRequired(required);
        }
      }
    }
    [...kinds].forEach(addRequired);
    return [...kinds];
  }
  const installation = installationPlan(installTarget);
  const added = installation.filter((kind) => kind !== installTarget);
  function install(kind: string): void {
    setFailure(null);
    const kinds = installationPlan(kind);
    if (kinds.length > 1) {
      setInstallTarget(kind);
      setConfirmation("install");
      return;
    }
    void run("install_widgets", { kinds });
  }
  const removed =
    confirmation && typeof confirmation === "object" && "kind" in confirmation
      ? confirmation
      : null;
  const removedGenerated =
    confirmation && typeof confirmation === "object" && "generatedId" in confirmation
      ? generatedWidgets.find((item) => item.id === confirmation.generatedId)
      : undefined;
  const affected = removed
    ? catalog.filter((item) => item.required.includes(removed.kind) && findView(item.id)?.installed)
    : [];
  const entries: WidgetListEntry[] = [
    ...catalog.map((item) => {
      const view = findView(item.id);
      return {
        ...item,
        installed: Boolean(view?.installed),
        enabled: Boolean(view?.enabled),
        status: view?.status ?? "not-installed",
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
          installed: true,
          enabled: item.enabled,
          status: !item.enabled ? "disabled" : item.status === "ready" ? "enabled" : item.status,
          attention: item.status !== "ready",
        }) as const,
    ),
  ];
  const entry =
    catalog.find((item) => item.id === focused) ??
    catalog.find((item) => findView(item.id)?.installed) ??
    catalog[0];
  const widget = entry ? findView(entry.id) : undefined;
  const selectedId = generated?.id ?? entry?.id;
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
  const canCloseDisplay = hasLastConfirmation && running?.displayWindow === "visible";
  const windowState = running?.toolWindow?.state;
  const isMemo = widget?.kind === "memo";
  const isToy = widget ? DESKTOP_TOYS.includes(widget.kind) : false;
  const related = entry
    ? catalog.filter(
        (item) =>
          entry.required.includes(item.id) ||
          item.required.includes(entry.id) ||
          Boolean(OPTIONAL_CONNECTIONS[entry.id]?.[item.id]),
      )
    : [];
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

  const relatedContent =
    related.length > 0 ? (
      <section className={styles.group}>
        <Heading level={4} variant="label">
          함께 쓰기
        </Heading>
        {related.map((item) => (
          <div className={styles.related} key={item.id}>
            <Text variant="label">{item.name}</Text>
            <Text variant="caption" tone="muted">
              {entry?.required.includes(item.id)
                ? "필수 연결"
                : (OPTIONAL_CONNECTIONS[entry?.id ?? ""]?.[item.id] ?? "선택 연동")}
            </Text>
            <Button variant="secondary" size="compact" onClick={() => focusWidget(item.id)}>
              {findView(item.id)?.installed ? "설정" : "추가"}
            </Button>
          </div>
        ))}
      </section>
    ) : undefined;
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
          trailing={<span>열기…</span>}
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
    <section className={embedded ? styles.embedded : styles.page} aria-label="위젯 관리">
      {!embedded && (
        <WindowHeader
          className={styles.header}
          label="위젯 관리 닫기"
          onClose={() => command("close_widgets")}
          title="위젯"
        />
      )}
      {!isDesktop() && (
        <Text as="p" variant="caption" tone="muted">
          예시 데이터 미리보기 · 설치와 저장은 데스크톱 앱에서 사용할 수 있어요.
        </Text>
      )}
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
          <Button variant="secondary" onClick={reloadGenerated}>
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
          <Button variant="secondary" onClick={reload}>
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
            <Button
              variant="quiet"
              size="compact"
              className={styles.backButton}
              onClick={() => {
                targetRevision.current += 1;
                setDetailOpen(false);
              }}
            >
              ‹ 위젯
            </Button>
          )}
          <div hidden={detailOpen} className={styles.directory}>
            <WidgetCatalog
              entries={entries}
              selectedId={selectedId}
              onSelect={focusWidget}
              disabled={!canAct}
              onToggle={(id, enabled) => {
                const view = findView(id);
                if (view?.installed) void run("set_widget_enabled", { id: view.id, enabled });
                else if (catalog.some((item) => item.id === id)) install(id);
                else void run("set_generated_widget_enabled", { id, enabled });
              }}
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
                <div className={styles.officialView} hidden={Boolean(generated)}>
                  <Surface className={details.header}>
                    <div className={styles.identity}>
                      <div className={details.titleRow}>
                        <span className={details.icon}>
                          <Icon name={WIDGET_ICONS[entry.id] || "hash"} size={18} />
                        </span>
                        <h1 className={details.title}>{entry.name}</h1>
                      </div>
                      <Text variant="caption" tone="muted">
                        {entry.description}
                      </Text>
                    </div>
                    <div className={details.state}>
                      {widget?.installed && (
                        <Switch
                          aria-label="위젯 사용"
                          checked={widget.enabled}
                          disabled={!canAct || (!widget.enabled && widget.missing.length > 0)}
                          onChange={(event) =>
                            void run("set_widget_enabled", {
                              id: widget.id,
                              enabled: event.target.checked,
                            })
                          }
                        />
                      )}
                      {widget?.installed && (
                        <Text variant="caption" tone="muted">
                          {isMemo
                            ? "바탕화면 낱장 메모"
                            : isToy
                              ? runtimeError
                                ? failureStatus
                                : hasLastConfirmation && running?.toys
                                  ? `화면에 보임 ${running.toys.visible}개`
                                  : "장난감 상태 확인 중"
                              : runtimeError
                                ? failureStatus
                                : runtimeLabel(
                                    windowState,
                                    running?.toolWindow?.shared === "planner",
                                  )}
                        </Text>
                      )}
                    </div>
                    {widget?.installed && <WidgetDetailPreview widget={widget} />}
                    {widget?.installed &&
                      widget.kind === "weather" &&
                      record(widget.data).configured === true && (
                        <Button
                          variant="secondary"
                          disabled={!canAct || !widget.enabled}
                          onClick={() => void run("refresh_connection_widget", { id: widget.id })}
                        >
                          정보 다시 조회
                        </Button>
                      )}
                    {widget?.installed && widget.kind === "clock" && (
                      <fieldset className={styles.settings} disabled={!canAct || !widget.enabled}>
                        <ClockSettings widget={widget} act={act} />
                      </fieldset>
                    )}
                    <div ref={setInspectorSlot} />
                    <div className={details.actions}>
                      {widget?.installed && !isToy && (
                        <Button
                          variant="primary"
                          disabled={
                            !canAct ||
                            !widget.enabled ||
                            (!isMemo &&
                              (!windowState || windowState === "unknown" || !!runtimeError))
                          }
                          onClick={() =>
                            void run(isMemo ? "create_memo_note" : "open_widget", { id: widget.id })
                          }
                        >
                          {isMemo ? "새 메모 꺼내기" : toolActionLabel(windowState)}
                        </Button>
                      )}
                      {widget?.installed && isToy && (
                        <>
                          <Button
                            variant="primary"
                            aria-label="바탕화면에 꺼내기"
                            disabled={!canAct || !widget.enabled}
                            onClick={() => void act("desktop-open")}
                          >
                            꺼내기
                          </Button>
                          <Button
                            variant="secondary"
                            disabled={!canAct || !widget.enabled}
                            onClick={() => void act("desktop-clear")}
                          >
                            정리하기
                          </Button>
                        </>
                      )}
                      {widget?.installed && (
                        <Button
                          variant="secondary"
                          disabled={!canAct}
                          onClick={() => void run("open_widget_state_rules", { id: widget.id })}
                        >
                          상태별 캐릭터 대사 편집
                        </Button>
                      )}
                    </div>
                  </Surface>
                  <div className={styles.detailBody}>
                    {(widget?.error ||
                      widget?.missing.length ||
                      (runtimeError && widget?.installed) ||
                      running?.actionError) && (
                      <Surface className={styles.runtimeMessages}>
                        {widget?.error && (
                          <Text as="p" role="alert" className={common.error}>
                            {widget.error}
                          </Text>
                        )}
                        {!!widget?.missing.length && (
                          <Text as="p" className={common.error}>
                            먼저 설치·켜기: {widget.missing.map(nameOf).join(", ")}
                          </Text>
                        )}
                        {runtimeError && widget?.installed && (
                          <div className={styles.runtimeError}>
                            <Text variant="caption" role="status">
                              {failureStatus} · {runtimeError}
                            </Text>
                            <Button variant="secondary" size="compact" onClick={runtime.reload}>
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
                    {!widget?.installed ? (
                      <Surface className={styles.genericPanel}>
                        <Heading level={4} variant="label">
                          사용 시작
                        </Heading>
                        {entry.required.length > 0 && (
                          <Text as="p" variant="label">
                            필수 위젯: {entry.required.map(nameOf).join(", ")}
                          </Text>
                        )}
                        {entry.connection && (
                          <Text as="p" variant="caption" tone="muted">
                            외부 연결·권한은 설치 후 직접 설정합니다.
                          </Text>
                        )}
                        <Button
                          variant="primary"
                          disabled={!canAct}
                          onClick={() => install(entry.id)}
                        >
                          {widget?.status === "install-error" ? "다시 설치" : "위젯 설치"}
                        </Button>
                        {relatedContent}
                      </Surface>
                    ) : (
                      !CONFIGURABLE_WIDGETS.includes(widget.kind) && (
                        <WidgetGuide
                          widget={widget}
                          runtime={running}
                          hasLastConfirmation={hasLastConfirmation}
                          runtimeError={runtimeError}
                          related={relatedContent}
                        />
                      )
                    )}
                    {widgets
                      .filter(
                        (item) =>
                          item.installed &&
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
                              active={active && !generated && item.id === widget?.id}
                              act={act}
                              onDirtyChange={reportDirty}
                              onBusyChange={reportBusy}
                              related={item.id === widget?.id ? relatedContent : undefined}
                              disabled={!canAct || !item.enabled}
                              displayControls={
                                DISPLAY_KINDS.includes(item.kind) ? (
                                  <div className={styles.displayControls}>
                                    <Text variant="caption">
                                      {runtimeError
                                        ? failureStatus
                                        : displayLabel(running?.displayWindow)}
                                    </Text>
                                    <Button
                                      variant="quiet"
                                      size="compact"
                                      disabled={
                                        !canAct ||
                                        !item.enabled ||
                                        !running?.displayWindow ||
                                        running.displayWindow === "unknown" ||
                                        (!!runtimeError && !canCloseDisplay)
                                      }
                                      onClick={() =>
                                        void run(
                                          running?.displayWindow === "visible"
                                            ? "close_widget_display"
                                            : "open_widget_display",
                                          { id: item.id },
                                        )
                                      }
                                    >
                                      {displayAction(running?.displayWindow)}
                                    </Button>
                                  </div>
                                ) : undefined
                              }
                            />
                          </div>
                        </div>
                      ))}
                    {widget?.installed && (
                      <div className={styles.remove}>
                        <Text variant="caption" tone="muted">
                          제거해도 작성한 데이터는 기본으로 보존합니다.
                        </Text>
                        <Button
                          variant="critical"
                          size="compact"
                          disabled={!canAct}
                          onClick={() => {
                            setDeleteData(false);
                            setFailure(null);
                            setConfirmation(widget);
                          }}
                        >
                          위젯 제거
                        </Button>
                      </div>
                    )}
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
        title={
          confirmation === "install"
            ? "위젯을 설치할까요?"
            : `${removedGenerated?.definition.name ?? (removed ? nameOf(removed.kind) : "위젯")} 제거`
        }
        closeLabel="닫기"
        size="small"
      >
        <div className={styles.dialogBody}>
          {confirmation === "install" ? (
            <>
              <Text as="p">{installTarget ? nameOf(installTarget) : ""}</Text>
              {added.length > 0 && (
                <Text as="p">
                  필수 위젯도 함께 설치하거나 켭니다: {added.map(nameOf).join(", ")}
                </Text>
              )}
              <Text as="p" variant="caption" tone="muted">
                선택 연동은 자동 설치하지 않아요. 계정 연결과 지역 설정은 설치 후 별도로 진행합니다.
              </Text>
            </>
          ) : (
            <>
              <Text as="p">
                작동과 대기 중인 반응을 멈춥니다. 작성한 데이터는 기본으로 보존합니다.
              </Text>
              {affected.length > 0 && (
                <Text as="p">
                  필수 연결을 사용할 수 없게 되는 도구:{" "}
                  {affected.map((item) => item.name).join(", ")}. 해당 도구의 데이터는 보존합니다.
                </Text>
              )}
              {removed && (
                <Checkbox
                  checked={deleteData}
                  disabled={busy}
                  onChange={(event) => setDeleteData(event.target.checked)}
                >
                  이 위젯의 작성 데이터도 삭제
                </Checkbox>
              )}
              {removedGenerated && (
                <Text as="p" variant="caption" tone="muted">
                  위젯 정의·작성 데이터·설치 정보는 이 기기에 보존합니다.
                </Text>
              )}
            </>
          )}
          {failure && (
            <Text as="p" role="alert" className={common.error}>
              {failure}
            </Text>
          )}
          <Inline gap="sm">
            <Button
              variant={confirmation === "install" ? "primary" : "critical"}
              disabled={
                !canAct ||
                (confirmation === "install"
                  ? installation.length === 0
                  : !removed && !removedGenerated)
              }
              onClick={() => {
                if (confirmation === "install")
                  void run("install_widgets", { kinds: installation });
                else if (removed) void run("remove_widget", { id: removed.id, deleteData });
                else if (removedGenerated)
                  void run("remove_generated_widget", {
                    id: removedGenerated.id,
                    expectedRevision: removedGenerated.revision,
                  });
              }}
            >
              {confirmation === "install" ? "설치 확인" : "제거 확인"}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>
              취소
            </Button>
          </Inline>
        </div>
      </Dialog>
    </section>
  );
}

function runtimeLabel(state: WindowState | undefined, shared: boolean): string {
  if (!state) {
    return isDesktop() ? "창 상태 확인 중" : "데스크톱에서 확인";
  }
  const name = shared ? "다이어리" : "위젯 창";
  switch (state) {
    case "visible":
      return `${name} 열림`;
    case "hidden":
      return `${name} 숨김`;
    case "minimized":
      return `${name} 최소화됨`;
    case "closed":
      return `${name} 닫힘`;
    case "unknown":
      return "확인 실패";
  }
}
function displayLabel(state: WindowState | null | undefined): string {
  switch (state) {
    case "visible":
      return "바탕화면 표시 중";
    case "minimized":
      return "표시 최소화됨";
    case "hidden":
      return "표시 숨김";
    case "closed":
      return "바탕화면 표시 닫힘";
    case "unknown":
      return "확인 실패";
    default:
      return isDesktop() ? "표시 상태 확인 중" : "데스크톱에서 확인";
  }
}
function displayAction(state: WindowState | null | undefined): string {
  if (state === "visible") {
    return "표시 닫기";
  }
  if (state === "hidden" || state === "minimized") {
    return "표시 다시 열기";
  }
  return "바탕화면 표시";
}

function toolActionLabel(state: WindowState | undefined): string {
  if (state === "unknown") {
    return "확인 실패";
  }
  return state && state !== "closed" ? "창으로 이동 ↗" : "위젯 열기 ↗";
}
