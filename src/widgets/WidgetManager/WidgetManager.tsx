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
import type { WidgetView } from "../types";
import type { ToolAction } from "../toolData";
import * as common from "../../lagrange.css";
import { CONFIGURABLE_WIDGETS, DISPLAY_KINDS, WidgetSettings } from "./WidgetSettings";
import * as styles from "./widgetManager.css";

const STATUS: Record<WidgetView["status"], string> = {
  "not-installed": "미설치",
  "install-error": "설치 오류",
  disabled: "꺼짐",
  setup: "설정 필요",
  error: "오류",
  enabled: "켜짐",
};
const STATUS_TONE: Record<WidgetView["status"], StatusMarkerTone> = {
  "not-installed": "muted",
  "install-error": "critical",
  disabled: "muted",
  setup: "accent",
  error: "critical",
  enabled: "positive",
};
const CATEGORIES = [
  ["daily", "생활 도구"],
  ["play", "장난감"],
  ["connections", "외부 연결"],
] as const;
const OPTIONAL_CONNECTIONS: Record<string, string[]> = {
  todo: ["focus-timer"],
  "focus-timer": ["todo"],
};
const DESKTOP_TOYS = ["ball", "paper-plane", "bubbles", "pet"];

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
    void listen<string>("planner-settings-target", (event) => choose(event.payload)).then(async (cleanup) => {
      if (!active) { cleanup(); return; }
      unlisten = cleanup;
      choose(await command<string | null>("get_planner_settings_target"));
    }).catch(() => { /* The settings list remains available if an optional deep link fails. */ });
    return () => { active = false; unlisten?.(); };
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
      ...new Set([...previous, ...(widget ? [widget.kind] : []), kind]),
    ]);
  }
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [filter, setFilter] = useState("all");
  const [confirmation, setConfirmation] = useState<"install" | WidgetView | null>(null);
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
      return true;
    } catch (cause: unknown) {
      setFailure(errorText(cause));
      return false;
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const catalog = snapshot?.catalog ?? [];
  const widgets = snapshot?.widgets ?? [];
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
  const removed = typeof confirmation === "object" ? confirmation : null;
  const affected = removed
    ? catalog.filter((item) => item.required.includes(removed.kind) && findView(item.id)?.installed)
    : [];
  const installedCount = widgets.filter((item) => item.installed).length;
  const query = search.trim().toLocaleLowerCase();
  const matching = catalog.filter((entry) => {
    const view = findView(entry.id);
    const matchesStatus =
      filter === "all" ||
      (filter === "installed" && view?.installed) ||
      (filter === "available" && !view?.installed) ||
      (filter === "attention" && view && ["setup", "error", "install-error"].includes(view.status));
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
        >
          <Heading level={1} variant="subsection">
            위젯
          </Heading>
        </WindowHeader>
      )}
      <header className={embedded ? styles.catalogSummary : styles.sectionHeader}>
        {!embedded && (
          <Heading level={2} variant="subsection">
            위젯
          </Heading>
        )}
        <Text variant="caption" tone="muted">
          공식 {catalog.length}개 · 설치됨 {installedCount}개
        </Text>
      </header>
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
          <section className={styles.catalog} aria-label="공식 위젯 목록">
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
                <option value="all">전체 {catalog.length}</option>
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
                const view = findView(item.id);
                const status = view?.status ?? "not-installed";
                return (
                  <div className={styles.row} data-selected={entry?.id === item.id} key={item.id}>
                    {!view?.installed ? (
                      <Checkbox
                        aria-label={`${item.name} 설치 선택`}
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
                      aria-pressed={entry?.id === item.id}
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
              {matching.length} / {catalog.length} · 항목을 선택하면 오른쪽에 설정이 열립니다.
            </Text>
          </section>
          {entry && (
            <section className={styles.detail} aria-label={`${entry.name} 설정`}>
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
                        active={active && item.id === widget?.id}
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
                      작성한 데이터는 기본으로 보존합니다. 삭제 여부와 연결된 위젯의 영향은 제거
                      전에 확인합니다.
                    </Text>
                  </>
                )}
              </section>
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
            : `${removed ? nameOf(removed.kind) : "위젯"} 제거`
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
              <Checkbox
                checked={deleteData}
                disabled={busy}
                onChange={(event) => setDeleteData(event.target.checked)}
              >
                이 위젯의 작성 데이터도 삭제
              </Checkbox>
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
              disabled={!canAct || (confirmation === "install" && installation.size === 0)}
              onClick={() => {
                if (confirmation === "install")
                  void run("install_widgets", { kinds: [...installation] });
                else if (removed) void run("remove_widget", { id: removed.id, deleteData });
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
