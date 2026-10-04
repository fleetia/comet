import {
  Button,
  Checkbox,
  Dialog,
  Heading,
  Inline,
  Select,
  Surface,
  SelectableListRow,
  Text,
  TextField,
} from "@fleetia/lagrange";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { listen } from "@tauri-apps/api/event";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { WindowHeader } from "../../components/WindowHeader/WindowHeader";
import { useWidgets } from "../useWidgets";
import { useGeneratedWidgets } from "../GeneratedWidgets/useGeneratedWidgets";
import { useWidgetRuntime } from "../useWidgetRuntime";
import type { WidgetRuntime, WidgetView, WindowState } from "../types";
import { type ToolAction } from "../toolData";
import * as common from "../../lagrange.css";
import { CONFIGURABLE_WIDGETS, DISPLAY_KINDS, WidgetSettings } from "./WidgetSettings";
import { GeneratedWidgetSettings } from "./GeneratedWidgetSettings";
import * as styles from "./widgetManager.css";

const STATUS: Record<WidgetView["status"] | "draft", string> = {
  "not-installed": "미설치",
  "install-error": "설치 오류",
  disabled: "꺼짐",
  setup: "설정 필요",
  error: "오류",
  enabled: "켜짐",
  draft: "실행 검사 대기",
};
const CATEGORIES = [
  ["daily", "생활 도구"],
  ["play", "장난감"],
  ["connections", "외부 연결"],
  ["generated", "AI·가져온 위젯"],
] as const;
const OPTIONAL_CONNECTIONS: Record<string, string[]> = {
  todo: ["focus-timer"],
  "focus-timer": ["todo"],
};
const DESKTOP_TOYS = ["ball", "paper-plane", "bubbles"];

export function WidgetManager({
  embedded = false,
  active = true,
  onDirtyChange,
}: {
  embedded?: boolean;
  active?: boolean;
  onDirtyChange?: (dirty: boolean) => void;
}): ReactElement {
  const { snapshot, error, reload } = useWidgets();
  const { workshop, error: generatedError, reload: reloadGenerated } = useGeneratedWidgets();
  const runtime = useWidgetRuntime(active);
  const [installTarget, setInstallTarget] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [visitedSettings, setVisitedSettings] = useState<string[]>([]);
  useEffect(() => {
    if (!isDesktop()) return;
    let active = true;
    let unlisten: (() => void) | undefined;
    function choose(kind: string | null): void {
      if (!active || !kind) return;
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
        choose(await command<string | null>("get_planner_settings_target"));
      })
      .catch(() => {
        /* The settings list remains available if an optional deep link fails. */
      });
    return () => {
      active = false;
      unlisten?.();
    };
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
    setFocused(kind);
    setVisitedSettings((previous) => [
      ...new Set([...previous, ...(selectedId ? [selectedId] : []), kind]),
    ]);
  }
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [filter, setFilter] = useState("all");
  const [confirmation, setConfirmation] = useState<
    "install" | WidgetView | { generatedId: string } | null
  >(null);
  const [deleteData, setDeleteData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const pending = useRef(false);
  const canAct = isDesktop() && !busy;

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
  const installation = new Set(
    installTarget && !findView(installTarget)?.installed ? [installTarget] : [],
  );
  function addRequired(kind: string): void {
    for (const required of catalog.find((item) => item.id === kind)?.required ?? []) {
      const existing = findView(required);
      if ((!existing?.installed || !existing.enabled) && !installation.has(required)) {
        installation.add(required);
        addRequired(required);
      }
    }
  }
  [...installation].forEach(addRequired);
  const added = [...installation].filter((kind) => kind !== installTarget);
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
  const installedCount = widgets.filter((item) => item.installed).length + generatedWidgets.length;
  const entries = [
    ...catalog.map((item) => {
      const view = findView(item.id);
      return {
        ...item,
        installed: Boolean(view?.installed),
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
          status: !item.enabled ? "disabled" : item.status === "ready" ? "enabled" : item.status,
          attention: item.status !== "ready",
        }) as const,
    ),
  ];
  const query = search.trim().toLocaleLowerCase();
  const matching = entries.filter((entry) => {
    const matchesStatus =
      filter === "all" ||
      (filter === "installed" && entry.installed) ||
      (filter === "available" && !entry.installed) ||
      (filter === "attention" && entry.attention);
    return (
      matchesStatus &&
      (category === "all" || entry.category === category) &&
      `${entry.name} ${entry.description}`.toLocaleLowerCase().includes(query)
    );
  });
  const entry =
    catalog.find((item) => item.id === focused) ??
    catalog.find((item) => findView(item.id)?.installed) ??
    catalog[0];
  const widget = entry ? findView(entry.id) : undefined;
  const selectedId = generated?.id ?? entry?.id;
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
          OPTIONAL_CONNECTIONS[entry.id]?.includes(item.id),
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

  const metadata = (
    <Text variant="caption" tone="muted" className={styles.metadata}>
      공식 · 앱에 포함 · 이 기기에 저장
    </Text>
  );
  const relatedContent =
    related.length > 0 ? (
      <section className={styles.group}>
        <Heading level={4} variant="label">
          연결된 위젯
        </Heading>
        {related.map((item) => (
          <div className={styles.related} key={item.id}>
            <Text variant="label">{item.name}</Text>
            <Text variant="caption" tone="muted">
              {entry?.required.includes(item.id) ? "필수 연결" : "선택 연동"}
            </Text>
            <Button variant="secondary" size="compact" onClick={() => focusWidget(item.id)}>
              {findView(item.id)?.installed ? "설정" : "추가"}
            </Button>
          </div>
        ))}
      </section>
    ) : undefined;
  const installationActions =
    snapshot && busy ? (
      <footer className={styles.footer}>
        <Inline gap="sm">
          <Text variant="caption" role="status">
            처리하고 있어요.
          </Text>
        </Inline>
        <Text variant="caption" tone="muted">
          설치와 사용 변경은 즉시 반영됩니다.
        </Text>
      </footer>
    ) : null;

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
      <header className={embedded ? styles.catalogSummary : styles.sectionHeader}>
        {!embedded && (
          <Heading level={2} variant="subsection">
            위젯
          </Heading>
        )}
        <Text variant="caption" tone="muted">
          공식 {catalog.length}개 · AI·가져온 위젯 {generatedWidgets.length}개 · 설치됨{" "}
          {installedCount}개
        </Text>
      </header>
      <details className={styles.experiments}>
        <summary>실험 기능</summary>
        <Button
          variant="secondary"
          disabled={!canAct}
          onClick={() => void run("open_widget_workshop")}
        >
          AI로 위젯 만들기
        </Button>
        <Checkbox
          checked={workshop.automatic}
          disabled={!canAct}
          onChange={() =>
            void run("set_widget_creation_automatic", { enabled: !workshop.automatic })
          }
        >
          대화에서 필요한 도구가 보이면 자동으로 만들기
        </Checkbox>
        <Text as="p" variant="caption" tone="muted">
          로컬 모델 또는 연결한 OpenAI 호환 API를 사용해요. 현재 AI의 자동 대화 생성 설정이 켜져
          있을 때 자동 제작하며 최대 5분에 한 번이에요. API 이용량이 발생할 수 있어요. 기본
          JavaScript 실행환경은 앱에 포함되어 있어요.
        </Text>
      </details>
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
        <div className={styles.workspace}>
          <Surface className={styles.catalog} role="region" aria-label="위젯 목록">
            <div className={styles.catalogTitle}>
              <strong>위젯 · {entries.length}개</strong>
              <Text variant="caption" tone="muted">
                설치 {installedCount}개
              </Text>
            </div>
            <TextField
              type="search"
              aria-label="위젯 검색"
              placeholder="위젯 검색"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <div className={styles.filters}>
              <Select
                aria-label="설치 상태"
                value={filter}
                onChange={(event) => setFilter(event.target.value)}
              >
                <option value="all">전체 {entries.length}</option>
                <option value="installed">설치됨 {installedCount}</option>
                <option value="available">미설치</option>
                <option value="attention">확인 필요</option>
              </Select>
              <Select
                aria-label="위젯 분류"
                value={category}
                onChange={(event) => setCategory(event.target.value)}
              >
                <option value="all">모든 종류</option>
                {CATEGORIES.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </div>
            <div className={styles.listHeading}>
              <span>위젯</span>
              <span>상태</span>
            </div>
            <div className={styles.list}>
              {matching.map((item) => {
                const status = item.status;
                return (
                  <div className={styles.row} data-selected={selectedId === item.id} key={item.id}>
                    <SelectableListRow
                      selected={selectedId === item.id}
                      className={styles.selectEntry}
                      aria-label={`${item.name} ${STATUS[status]}`}
                      aria-pressed={selectedId === item.id}
                      onClick={() => focusWidget(item.id)}
                    >
                      <span className={styles.entryName}>{item.name}</span>
                      <span className={styles.entryInstallation}>
                        {item.installed ? "설치" : "미설치"}
                      </span>
                      <span className={styles.entryStatus}>
                        {item.installed ? `● ${STATUS[status]}` : "—"}
                      </span>
                    </SelectableListRow>
                  </div>
                );
              })}
              {matching.length === 0 && (
                <Text as="p" variant="caption" tone="muted" className={styles.empty}>
                  찾는 위젯이 없어요. 검색어나 필터를 바꿔 보세요.
                </Text>
              )}
            </div>
            <div className={styles.catalogActions}>
              <Text variant="caption" tone="muted">
                설치 · 사용 상태
              </Text>
            </div>
            {installationActions}
          </Surface>
          {(entry || generated) && (
            <section
              className={styles.detail}
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
                  <Surface className={`${styles.detailHeader} ${isToy ? styles.toyHeader : ""}`}>
                    <Surface
                      tone={isToy ? "accent" : "parent"}
                      padding={isToy ? "inline" : "flush"}
                      className={`${styles.identity} ${isToy ? styles.toyIdentity : ""}`}
                    >
                      <Heading level={3} variant="subsection">
                        {entry.name}
                      </Heading>
                      <Text variant="caption" tone="muted">
                        {CATEGORIES.find(([id]) => id === entry.category)?.[1]} ·{" "}
                        {entry.connection ?? "이 기기에 저장"}
                      </Text>
                    </Surface>
                    <div className={styles.headerState}>
                      <Text variant="caption">{widget?.installed ? "설치됨" : "미설치"}</Text>
                      {widget?.installed && (
                        <Checkbox
                          aria-label="위젯 사용"
                          checked={widget.enabled}
                          disabled={!canAct || (!widget.enabled && widget.missing.length > 0)}
                          onChange={(event) =>
                            void run("set_widget_enabled", {
                              id: widget.id,
                              enabled: event.target.checked,
                            })
                          }
                        >
                          사용
                        </Checkbox>
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
                    <div className={styles.headerActions}>
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
                        <details className={styles.more}>
                          <summary aria-label="위젯 더보기">···</summary>
                          <div className={styles.moreMenu}>
                            <Button
                              variant="secondary"
                              disabled={!canAct}
                              onClick={() => void run("open_widget_state_rules", { id: widget.id })}
                            >
                              상태별 캐릭터 대사 편집
                            </Button>
                            <Button
                              variant="critical"
                              disabled={!canAct}
                              onClick={() => {
                                setDeleteData(false);
                                setFailure(null);
                                setConfirmation(widget);
                              }}
                            >
                              위젯 제거
                            </Button>
                            <Text variant="caption" tone="muted">
                              작성한 데이터는 기본으로 보존합니다.
                            </Text>
                          </div>
                        </details>
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
                          설치
                        </Heading>
                        <Text as="p">{entry.description}</Text>
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
                          onClick={() => {
                            setInstallTarget(entry.id);
                            setFailure(null);
                            setConfirmation("install");
                          }}
                        >
                          {widget?.status === "install-error" ? "다시 설치" : "위젯 설치"}
                        </Button>
                        {relatedContent}
                        {metadata}
                      </Surface>
                    ) : (
                      <>
                        {isToy && (
                          <Surface className={styles.toyPanel}>
                            <Heading level={4} variant="subsection">
                              바탕화면 장난감
                            </Heading>
                            <div className={styles.toyCounts}>
                              <strong>
                                꺼내는 중{" "}
                                {hasLastConfirmation && running?.toys
                                  ? `${running.toys.starting}개`
                                  : "확인 중"}
                              </strong>
                              <strong>
                                화면에 보임{" "}
                                {hasLastConfirmation && running?.toys
                                  ? `${running.toys.visible}개`
                                  : "확인 중"}
                              </strong>
                            </div>
                            <div className={styles.toyDescription}>
                              <Text variant="caption" role="status">
                                {toyLabel(running?.toys, hasLastConfirmation, runtimeError)}
                              </Text>
                              <Text variant="caption" tone="muted">
                                {entry.description}
                              </Text>
                            </div>
                            {metadata}
                          </Surface>
                        )}
                        {!isToy && !CONFIGURABLE_WIDGETS.includes(widget.kind) && (
                          <Surface className={styles.genericPanel}>
                            <Heading level={4} variant="subsection">
                              {entry.name}
                            </Heading>
                            <Text as="p">{entry.description}</Text>
                            {running?.noteWindows && (!runtimeError || hasLastConfirmation) && (
                              <Text variant="caption" role="status">
                                메모 {running.noteWindows.open}개 열림 ·{" "}
                                {running.noteWindows.visible}개 표시
                                {runtimeError ? " · 마지막 확인 상태" : ""}
                              </Text>
                            )}
                            <Text variant="caption">
                              {isMemo
                                ? "목록과 검색은 다이어리의 계속 쓸 메모에서 볼 수 있어요. 낱장을 넣어도 내용은 남아 있어요."
                                : "실행 창을 닫아도 사용 상태와 저장한 데이터는 유지됩니다."}
                            </Text>
                            {relatedContent}
                            {metadata}
                          </Surface>
                        )}
                      </>
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
                              active={active && !generated && item.id === widget?.id}
                              act={act}
                              onDirtyChange={reportDirty}
                              metadata={metadata}
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
                  ? installation.size === 0
                  : !removed && !removedGenerated)
              }
              onClick={() => {
                if (confirmation === "install")
                  void run("install_widgets", { kinds: [...installation] });
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

function toyLabel(
  counts: WidgetRuntime["toys"] | undefined,
  hasConfirmation: boolean,
  error: string | null,
): string {
  if (!counts || (!hasConfirmation && error)) {
    if (error) {
      return "장난감 상태 확인 실패";
    }
    return isDesktop() ? "장난감 상태 확인 중" : "데스크톱에서 확인";
  }
  return `준비 중 ${counts.starting}개 · 표시 ${counts.visible}개${error ? " · 마지막 확인 상태" : ""}`;
}
