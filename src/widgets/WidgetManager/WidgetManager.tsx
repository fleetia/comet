import {
  Button,
  Checkbox,
  Dialog,
  Heading,
  Inline,
  Select,
  StatusMarker,
  Text,
  TextField,
  VisuallyHidden,
  type StatusMarkerTone,
} from "@fleetia/lagrange";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { listen } from "@tauri-apps/api/event";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import { WindowHeader } from "../../components/WindowHeader/WindowHeader";
import { useWidgets } from "../useWidgets";
import { useGeneratedWidgets } from "../GeneratedWidgets/useGeneratedWidgets";
import type { WidgetView } from "../types";
import type { ToolAction } from "../toolData";
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
const STATUS_TONE: Record<WidgetView["status"] | "draft", StatusMarkerTone> = {
  "not-installed": "muted",
  "install-error": "critical",
  disabled: "muted",
  setup: "accent",
  error: "critical",
  enabled: "positive",
  draft: "accent",
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
  const [selected, setSelected] = useState<string[]>([]);
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
    onDirtyChange?.(selected.length > 0 || Object.values(settingsDirty).some(Boolean));
  }, [selected, settingsDirty, onDirtyChange]);
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
      if (name === "finish_widget_onboarding" && !embedded) {
        await command("close_widgets");
      }
      setConfirmation(null);
      if (name === "install_widgets") {
        setSelected([]);
      }
      reload();
      reloadGenerated();
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
  const installation = new Set(selected.filter((kind) => !findView(kind)?.installed));
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
  const added = [...installation].filter((kind) => !selected.includes(kind));
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
  function chooseInstallation(kind: string): void {
    setSelected((current) =>
      current.includes(kind) ? current.filter((id) => id !== kind) : [...current, kind],
    );
  }

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
      <Button variant="primary" disabled={!canAct} onClick={() => void run("open_widget_workshop")}>
        AI로 위젯 만들기
      </Button>
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
          <section className={styles.catalog} aria-label="위젯 목록">
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
                    {!item.installed ? (
                      <Checkbox
                        aria-label={`${item.name} 설치 선택`}
                        className={styles.installCheckbox}
                        checked={selected.includes(item.id)}
                        disabled={busy}
                        onChange={() => chooseInstallation(item.id)}
                      >
                        <VisuallyHidden>{item.name} 설치 선택</VisuallyHidden>
                      </Checkbox>
                    ) : (
                      <span />
                    )}
                    <button
                      type="button"
                      className={styles.selectEntry}
                      aria-label={`${item.name} ${STATUS[status]}`}
                      aria-pressed={selectedId === item.id}
                      onClick={() => focusWidget(item.id)}
                    >
                      <span>{item.name}</span>
                      <StatusMarker tone={STATUS_TONE[status]}>{STATUS[status]}</StatusMarker>
                    </button>
                  </div>
                );
              })}
              {matching.length === 0 && (
                <Text as="p" variant="caption" tone="muted" className={styles.empty}>
                  찾는 위젯이 없어요. 검색어나 필터를 바꿔 보세요.
                </Text>
              )}
            </div>
            <Text variant="caption" tone="muted">
              {matching.length} / {entries.length} · 항목을 선택하면 오른쪽에 설정이 열립니다.
            </Text>
          </section>
          {(entry || generated) && (
            <section
              className={styles.detail}
              aria-label={`${generated?.definition.name ?? entry?.name} 설정`}
            >
              {generatedWidgets
                .filter((item) => visitedSettings.includes(item.id) || item.id === generated?.id)
                .map((item) => (
                  <div key={item.id} hidden={item.id !== generated?.id}>
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
                <div hidden={Boolean(generated)}>
                  <div className={styles.detailContent}>
                    <div className={styles.detailHeader}>
                      <div>
                        <Heading level={3} variant="subsection">
                          {entry.name}
                        </Heading>
                        <Text variant="caption" tone="muted">
                          {widget?.installed ? "설치됨" : "미설치"} ·{" "}
                          {CATEGORIES.find(([id]) => id === entry.category)?.[1]}
                        </Text>
                      </div>
                      {widget?.installed && (
                        <Button
                          variant="primary"
                          disabled={!canAct || !widget.enabled}
                          onClick={() => void run("open_widget", { id: widget.id })}
                        >
                          위젯 실행 ↗
                        </Button>
                      )}
                    </div>
                    <Text as="p" variant="caption" tone="muted">
                      {entry.description}. 실제 작업은 실행한 위젯에서 합니다.
                    </Text>
                    {widget?.installed && (
                      <Button
                        variant="secondary"
                        disabled={!canAct}
                        onClick={() => void run("open_widget_state_rules", { id: widget.id })}
                      >
                        상태별 캐릭터 대사 편집
                      </Button>
                    )}
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
                    {!widget?.installed ? (
                      <section className={styles.group}>
                        <Heading level={4} variant="label">
                          설치
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
                          onClick={() => {
                            setSelected((current) =>
                              current.includes(entry.id) ? current : [...current, entry.id],
                            );
                            setFailure(null);
                            setConfirmation("install");
                          }}
                        >
                          위젯 설치
                        </Button>
                      </section>
                    ) : (
                      <>
                        <section className={styles.group}>
                          <Heading level={4} variant="label">
                            사용과 표시
                          </Heading>
                          <Checkbox
                            checked={widget.enabled}
                            disabled={!canAct || (!widget.enabled && widget.missing.length > 0)}
                            onChange={(event) =>
                              void run("set_widget_enabled", {
                                id: widget.id,
                                enabled: event.target.checked,
                              })
                            }
                          >
                            위젯 사용
                          </Checkbox>
                          <Text as="p" variant="caption" tone="muted">
                            실행 창을 닫아도 위젯 사용 상태는 유지됩니다.
                          </Text>
                          {DISPLAY_KINDS.includes(widget.kind) && (
                            <Inline gap="sm">
                              <Button
                                variant="secondary"
                                size="compact"
                                disabled={!canAct || !widget.enabled}
                                onClick={() => void run("open_widget_display", { id: widget.id })}
                              >
                                바탕화면 표시
                              </Button>
                              <Button
                                variant="quiet"
                                size="compact"
                                disabled={!canAct}
                                onClick={() => void run("close_widget_display", { id: widget.id })}
                              >
                                표시 닫기
                              </Button>
                            </Inline>
                          )}
                          {DESKTOP_TOYS.includes(widget.kind) && (
                            <Inline gap="sm">
                              <Button
                                variant="secondary"
                                size="compact"
                                disabled={!canAct || !widget.enabled}
                                onClick={() => void act("desktop-open")}
                              >
                                바탕화면에 꺼내기
                              </Button>
                              <Button
                                variant="quiet"
                                size="compact"
                                disabled={!canAct || !widget.enabled}
                                onClick={() => void act("desktop-clear")}
                              >
                                정리하기
                              </Button>
                            </Inline>
                          )}
                        </section>
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
                        <div key={item.id} hidden={item.id !== widget?.id}>
                          <fieldset className={styles.settings} disabled={!canAct || !item.enabled}>
                            <WidgetSettings
                              widget={item}
                              active={active && !generated && item.id === widget?.id}
                              act={act}
                              onDirtyChange={reportDirty}
                            />
                          </fieldset>
                        </div>
                      ))}
                    {related.length > 0 && (
                      <section className={styles.group}>
                        <Heading level={4} variant="label">
                          연결된 위젯
                        </Heading>
                        {related.map((item) => (
                          <div className={styles.related} key={item.id}>
                            <Text variant="label">{item.name}</Text>
                            <Text variant="caption" tone="muted">
                              {entry.required.includes(item.id) ? "필수 연결" : "선택 연동"}
                            </Text>
                            <Button
                              variant="secondary"
                              size="compact"
                              onClick={() => focusWidget(item.id)}
                            >
                              {findView(item.id)?.installed ? "설정" : "추가"}
                            </Button>
                          </div>
                        ))}
                      </section>
                    )}
                    <section className={styles.group}>
                      <Heading level={4} variant="label">
                        설치 정보
                      </Heading>
                      <dl className={styles.metadata}>
                        <dt>제공</dt>
                        <dd>공식 · 앱에 포함</dd>
                        <dt>저장 위치</dt>
                        <dd>이 기기</dd>
                      </dl>
                      {widget?.installed && (
                        <>
                          <div className={styles.remove}>
                            <Heading level={4} variant="label">
                              제거
                            </Heading>
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
                          </div>
                          <Text as="p" variant="caption" tone="muted">
                            작성한 데이터는 기본으로 보존합니다. 삭제 여부와 연결된 위젯의 영향은
                            제거 전에 확인합니다.
                          </Text>
                        </>
                      )}
                    </section>
                  </div>
                </div>
              )}
            </section>
          )}
        </div>
      )}
      {snapshot && (
        <footer className={styles.footer}>
          <Inline gap="sm">
            {selected.length > 0 && (
              <>
                <Button
                  variant="primary"
                  disabled={!canAct || installation.size === 0}
                  onClick={() => {
                    setFailure(null);
                    setConfirmation("install");
                  }}
                >
                  선택한 위젯 설치 ({selected.length})
                </Button>
                <Button variant="quiet" disabled={busy} onClick={() => setSelected([])}>
                  선택 해제
                </Button>
              </>
            )}
            {!snapshot.onboardingDone && (
              <Button
                variant="secondary"
                disabled={!canAct || selected.length > 0}
                onClick={() => void run("finish_widget_onboarding")}
              >
                {installedCount === 0 ? "위젯 없이 시작하기" : "위젯 선택 마치기"}
              </Button>
            )}
            {busy && (
              <Text variant="caption" role="status">
                처리하고 있어요.
              </Text>
            )}
          </Inline>
          <Text variant="caption" tone="muted">
            설정창에서는 설치·사용 여부·표시·연결을 관리합니다.
          </Text>
        </footer>
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
            ? "선택한 위젯을 설치할까요?"
            : `${removedGenerated?.definition.name ?? (removed ? nameOf(removed.kind) : "위젯")} 제거`
        }
        closeLabel="닫기"
        size="small"
      >
        <div className={styles.dialogBody}>
          {confirmation === "install" ? (
            <>
              <Text as="p">{selected.map(nameOf).join(", ")}</Text>
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
