import { Button, Checkbox, Dialog, Rule, Tabs, TabList, Tab, TabPanel } from "@fleetia/lagrange";
import { useRef, useState, type ReactElement } from "react";
import { command, errorText, isDesktop } from "../hooks/useSnapshot";
import { useWidgets } from "./useWidgets";
import { WindowHeader } from "../components/WindowHeader";
import type { WidgetView } from "./types";
import * as common from "../lagrange.css";
import * as styles from "./widgets.css";

const STATUS: Record<WidgetView["status"], string> = {
  "not-installed": "미설치",
  "install-error": "설치 오류",
  disabled: "꺼짐",
  setup: "연결·설정 필요",
  error: "오류",
  enabled: "사용 중",
};

export function WidgetManager(): ReactElement {
  const { snapshot, error, reload } = useWidgets();
  const [selected, setSelected] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const pending = useRef(false);
  const [filter, setFilter] = useState("all");
  const [confirmation, setConfirmation] = useState<"install" | WidgetView | null>(null);
  const [deleteData, setDeleteData] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const canAct = isDesktop() && !busy;

  async function run(name: string, args?: Record<string, unknown>): Promise<void> {
    if (!canAct || pending.current) {
      return;
    }
    pending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await command(name, args);
      if (name === "finish_widget_onboarding") {
        await command("close_widgets");
      }
      setConfirmation(null);
      if (name === "install_widgets") {
        setSelected([]);
      }
      reload();
    } catch (cause: unknown) {
      setFailure(errorText(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  if (!snapshot) {
    return (
      <main className={styles.page}>
        <WindowHeader
          className={styles.header}
          label="위젯 관리 닫기"
          onClose={() => command("close_widgets")}
        >
          <h1 className={common.settingsTitle}>위젯 관리</h1>
        </WindowHeader>
        {error ? (
          <>
            <p role="alert" className={common.error}>
              {error}
            </p>
            <Button variant="secondary" onClick={reload}>
              다시 불러오기
            </Button>
          </>
        ) : (
          <p role="status">위젯을 불러오고 있어요.</p>
        )}
      </main>
    );
  }
  const { catalog, widgets, onboardingDone } = snapshot;
  const findView = (kind: string): WidgetView | undefined =>
    widgets.find((item) => item.kind === kind);
  const nameOf = (kind: string): string => catalog.find((item) => item.id === kind)?.name ?? kind;
  const installation = new Set(selected);
  function addRequired(kind: string): void {
    for (const required of catalog.find((item) => item.id === kind)?.required ?? []) {
      const existing = findView(required);
      if ((!existing?.installed || !existing.enabled) && !installation.has(required)) {
        installation.add(required);
        addRequired(required);
      }
    }
  }
  selected.forEach(addRequired);
  const added = [...installation].filter((kind) => !selected.includes(kind));
  const removed = typeof confirmation === "object" ? confirmation : null;
  const affected = removed
    ? catalog.filter((item) => item.required.includes(removed.kind) && findView(item.id)?.installed)
    : [];
  const installed = catalog.filter((entry) => findView(entry.id)?.installed);
  const available = catalog.filter((entry) => !findView(entry.id)?.installed);
  const needsAttention = installed.filter((entry) => {
    const status = findView(entry.id)?.status;
    return status === "setup" || status === "error" || status === "install-error";
  });
  const tab = activeTab ?? (installed.length > 0 || onboardingDone ? "installed" : "add");
  function renderEntry(entry: (typeof catalog)[number]): ReactElement {
    const view = findView(entry.id);
    return (
      <section key={entry.id} className={styles.row} aria-label={entry.name}>
        <div className={styles.details}>
          <div className={styles.nameRow}>
            {view?.installed ? (
              <h2 className={styles.selection}>{entry.name}</h2>
            ) : (
              <Checkbox
                className={styles.selection}
                aria-label={`${entry.name} 설치 선택`}
                disabled={busy}
                checked={selected.includes(entry.id)}
                onChange={(event) =>
                  setSelected((current) =>
                    event.target.checked
                      ? [...current, entry.id]
                      : current.filter((id) => id !== entry.id),
                  )
                }
              >
                {entry.name}
              </Checkbox>
            )}
            <span className={styles.status}>{view ? STATUS[view.status] : "미설치"}</span>
          </div>
          <p className={common.quiet}>{entry.description}</p>
          {entry.connection && !view?.installed && (
            <p className={common.quiet}>외부 연결·권한은 설치 후 설정해요.</p>
          )}
          {entry.required.length > 0 && (
            <p className={common.quiet}>필수 위젯: {entry.required.map(nameOf).join(", ")}</p>
          )}
          {!!view?.missing.length && (
            <p className={common.error}>먼저 설치·켜기: {view.missing.map(nameOf).join(", ")}</p>
          )}
          {view?.error && <p className={common.error}>{view.error}</p>}
        </div>
        <div className={styles.actions}>
          {view?.installed && (
            <>
              <Button
                variant="secondary"
                disabled={!canAct || !view.enabled}
                onClick={() => void run("open_widget", { id: view.id })}
              >
                {view.status === "setup" || view.status === "error" ? "설정 열기" : "꺼내기"}
              </Button>
              <Button
                variant="quiet"
                disabled={!canAct || (!view.enabled && view.missing.length > 0)}
                onClick={() =>
                  void run("set_widget_enabled", { id: view.id, enabled: !view.enabled })
                }
              >
                {view.enabled ? "끄기" : "켜기"}
              </Button>
              <Button
                variant="quiet"
                disabled={!canAct}
                onClick={() => {
                  setDeleteData(false);
                  setFailure(null);
                  setConfirmation(view);
                }}
              >
                제거
              </Button>
            </>
          )}
          {!isDesktop() && (
            <Button
              variant="quiet"
              onClick={() =>
                window.location.assign(`?view=widget&id=${encodeURIComponent(entry.id)}`)
              }
            >
              화면 미리보기
            </Button>
          )}
        </div>
      </section>
    );
  }
  return (
    <main className={styles.page}>
      <WindowHeader
        className={styles.header}
        label="위젯 관리 닫기"
        onClose={() => command("close_widgets")}
      >
        <div>
          <h1 className={common.settingsTitle}>위젯 관리</h1>
          <p className={common.quiet}>
            원하는 도구만 골라 주세요. 하나도 설치하지 않아도 A와 B는 함께합니다.
          </p>
        </div>
      </WindowHeader>
      {!isDesktop() && (
        <p className={styles.previewNote}>
          예시 데이터로 보는 브라우저 미리보기예요. 설치와 실제 도구 사용은 데스크톱 앱에서 할 수
          있어요.
        </p>
      )}
      {error && (
        <p role="alert" className={common.error}>
          {error}
        </p>
      )}
      {failure && !confirmation && (
        <p role="alert" className={common.error}>
          {failure}
        </p>
      )}
      <Tabs value={tab} onValueChange={setActiveTab}>
        <TabList aria-label="위젯 관리 항목">
          <Tab value="installed">설치됨 ({installed.length})</Tab>
          <Tab value="add">추가할 위젯 ({available.length})</Tab>
        </TabList>
        <TabPanel value="installed">
          <p className={styles.help}>
            화면을 닫아도 켜 둔 위젯은 계속 동작해요. 멈추려면 끄기를 사용하세요.
          </p>
          <div className={styles.filters} role="group" aria-label="설치된 위젯 필터">
            <Button
              variant="quiet"
              className={styles.filterButton}
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              전체 ({installed.length})
            </Button>
            <Button
              variant="quiet"
              className={styles.filterButton}
              aria-pressed={filter === "setup"}
              onClick={() => setFilter("setup")}
            >
              확인 필요 ({needsAttention.length})
            </Button>
          </div>
          {(filter === "setup" ? needsAttention : installed).map(renderEntry)}
          {installed.length === 0 ? (
            <div className={styles.empty}>
              <p>설치한 위젯이 없어요. 원하는 도구만 골라 추가해 보세요.</p>
              <Button variant="secondary" onClick={() => setActiveTab("add")}>
                추가할 위젯 보기
              </Button>
            </div>
          ) : (
            filter === "setup" &&
            needsAttention.length === 0 && (
              <p className={styles.empty}>확인이 필요한 위젯이 없어요.</p>
            )
          )}
        </TabPanel>
        <TabPanel value="add">
          <p className={styles.help}>
            필요한 도구를 선택한 뒤 설치해 주세요. 필수 위젯은 설치 전에 함께 확인해요.
          </p>
          {[
            ["daily", "생활 도구"],
            ["play", "장난감"],
            ["connections", "외부 연결"],
          ].map(([category, label]) => {
            const entries = available.filter((entry) => entry.category === category);
            return (
              entries.length > 0 && (
                <section key={category} className={styles.category} aria-label={label}>
                  <h2 className={styles.categoryTitle}>
                    {label} <span className={styles.count}>{entries.length}</span>
                  </h2>
                  {entries.map(renderEntry)}
                </section>
              )
            );
          })}
          {available.length === 0 && <p className={styles.empty}>추가할 위젯을 모두 설치했어요.</p>}
        </TabPanel>
      </Tabs>
      {(tab === "add" || selected.length > 0 || !onboardingDone || busy) && (
        <footer className={styles.footer}>
          <Rule variant="structural" />
          <div className={styles.actions}>
            {(tab === "add" || selected.length > 0) && (
              <Button
                variant="primary"
                disabled={!canAct || selected.length === 0}
                onClick={() => {
                  setFailure(null);
                  setConfirmation("install");
                }}
              >
                선택한 위젯 설치 ({selected.length})
              </Button>
            )}
            {selected.length > 0 && (
              <Button variant="quiet" disabled={busy} onClick={() => setSelected([])}>
                선택 해제
              </Button>
            )}
            {!onboardingDone && (
              <Button
                variant="secondary"
                disabled={!canAct || selected.length > 0}
                onClick={() => void run("finish_widget_onboarding")}
              >
                {installed.length === 0 ? "모두 건너뛰고 시작하기" : "위젯 선택을 마치고 시작하기"}
              </Button>
            )}
            {busy && <span role="status">처리하고 있어요.</span>}
          </div>
          {selected.length > 0 && (
            <p className={common.quiet}>
              선택한 {selected.length}개는 아직 설치하지 않았어요. 설치하거나 선택을 해제한 뒤 마칠
              수 있어요.
            </p>
          )}
        </footer>
      )}
      <Dialog
        isOpen={confirmation !== null}
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
              <p>{selected.map(nameOf).join(", ")}</p>
              {added.length > 0 && (
                <p>필수 위젯도 함께 설치하거나 켭니다: {added.map(nameOf).join(", ")}</p>
              )}
              <p className={common.quiet}>
                선택 연동은 자동 설치하지 않아요. 계정 연결과 지역 설정은 설치 후 별도로 진행합니다.
              </p>
            </>
          ) : (
            <>
              <p>작동과 대기 중인 반응을 멈춥니다. 작성한 데이터는 기본으로 보존합니다.</p>
              {affected.length > 0 && (
                <p>
                  필수 연결을 사용할 수 없게 되는 도구:{" "}
                  {affected.map((item) => item.name).join(", ")}. 해당 도구의 데이터는 보존합니다.
                </p>
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
            <p role="alert" className={common.error}>
              {failure}
            </p>
          )}
          <div className={styles.actions}>
            <Button
              variant="primary"
              disabled={!canAct}
              onClick={() => {
                if (confirmation === "install") {
                  void run("install_widgets", { kinds: [...installation] });
                } else if (removed) {
                  void run("remove_widget", { id: removed.id, deleteData });
                }
              }}
            >
              {confirmation === "install" ? "설치 확인" : "제거 확인"}
            </Button>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirmation(null)}>
              취소
            </Button>
          </div>
        </div>
      </Dialog>
    </main>
  );
}
