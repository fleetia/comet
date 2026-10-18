import { useEffect, useRef, useState, type CSSProperties, type JSX } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button, SettingControlRow, Stepper, Switch, Textarea, TextInput } from "@comet/ui";
import { FolderIcon, OrganizeIcon, PlusIcon } from "@comet/icon";
import * as figma from "../SettingsPanel/figmaSettings.css";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import {
  DEFAULT_ORGANIZER_SETTINGS,
  PREVIEW_ORGANIZER_STATUS,
  type OrganizerSettingsValue,
  type OrganizerStatus,
  type OrganizerSearchHit,
} from "../../organizer/types";
import type { Snapshot } from "../../types";
import * as s from "./organizerSettings.css";
import * as common from "../../common.css";

const DEFAULT_EXCLUDE = [
  "03.diary",
  "05.investing",
  "30.1on1",
  "31.self",
  "99.deprecated",
  "ai-shared",
  ".git",
  ".obsidian",
].join("\n");
const paths = (value: string): string[] =>
  value
    .split("\n")
    .map((path) => path.trim())
    .filter(Boolean);

export function OrganizerSettings({
  onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void;
}): JSX.Element {
  const [status, setStatus] = useState<OrganizerStatus | null>(
    isDesktop() ? null : PREVIEW_ORGANIZER_STATUS,
  );
  const [settings, setSettings] = useState(DEFAULT_ORGANIZER_SETTINGS);
  const [view, setView] = useState<"overview" | "connect">("overview");
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [root, setRoot] = useState("");
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState(DEFAULT_EXCLUDE);
  const [outputDir, setOutputDir] = useState("comet-ex-brain");
  const [automatic, setAutomatic] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const mounted = useRef(true);
  const dirty = useRef(false);
  const fetching = useRef(false);
  const lock = useRef(false);
  const epoch = useRef(0);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<OrganizerSearchHit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchSequence = useRef(0);
  const searchPending = useRef(false);
  const context = useRef(status?.context ?? null);
  function cancelSearchResult(): void {
    searchSequence.current += 1;
    searchPending.current = false;
    setSearching(false);
    setHits(null);
    setSearchError(null);
  }
  useEffect(() => {
    if (view !== "overview") cancelSearchResult();
  }, [view]);
  function acceptStatus(next: OrganizerStatus): void {
    if (JSON.stringify(context.current) !== JSON.stringify(next.context)) cancelSearchResult();
    context.current = next.context;
    setStatus(next);
  }
  dirty.current = settingsDirty;
  const vaultDirty = Boolean(
    root || include || exclude !== DEFAULT_EXCLUDE || outputDir !== "comet-ex-brain" || automatic,
  );
  useEffect(() => {
    onDirtyChange?.(settingsDirty || vaultDirty);
  }, [onDirtyChange, settingsDirty, vaultDirty]);
  async function refresh(): Promise<void> {
    if (fetching.current) return;
    fetching.current = true;
    const version = epoch.current;
    try {
      const next = await command<OrganizerStatus>("organizer_status");
      if (mounted.current && version === epoch.current && next) {
        acceptStatus(next);
        if (!dirty.current) setSettings(next.settings);
      }
    } catch (cause) {
      if (mounted.current && version === epoch.current) setError(errorText(cause));
    } finally {
      fetching.current = false;
    }
  }
  useEffect(() => {
    mounted.current = true;
    if (!isDesktop()) return;
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 3000);
    const cleanups: (() => void)[] = [];
    const retain = (cleanup: () => void): void => {
      if (mounted.current) cleanups.push(cleanup);
      else cleanup();
    };
    void listen("organizer-updated", () => void refresh())
      .then(retain)
      .catch(() => {});
    void listen<Snapshot>("app-state", (event) => {
      if ((event.payload.user?.id ?? "legacy-user") !== context.current?.userId) {
        cancelSearchResult();
        epoch.current += 1;
        lock.current = false;
        setPending(null);
        void refresh();
      }
    })
      .then(retain)
      .catch(() => {});
    return () => {
      mounted.current = false;
      epoch.current += 1;
      searchSequence.current += 1;
      cleanups.forEach((cleanup) => cleanup());
      clearInterval(timer);
    };
  }, []);
  async function run(name: string, args?: Record<string, unknown>): Promise<void> {
    if (lock.current && name !== "organizer_pause") return;
    lock.current = true;
    if (
      ["organizer_save_settings", "organizer_connect_vault", "organizer_disconnect_vault"].includes(
        name,
      )
    )
      cancelSearchResult();
    const version = ++epoch.current;
    setPending(name);
    setError(null);
    setNotice(null);
    try {
      const result = await command<unknown>(name, args);
      if (!mounted.current || version !== epoch.current) return;
      if (name === "organizer_pick_folder") {
        if (typeof result === "string") setRoot(result);
      } else if (name === "organizer_save_settings") {
        dirty.current = false;
        setSettingsDirty(false);
        setNotice("Ex-brain 설정을 저장했어요.");
      } else if (name === "organizer_connect_vault") {
        setRoot("");
        setInclude("");
        setExclude(DEFAULT_EXCLUDE);
        setOutputDir("comet-ex-brain");
        setAutomatic(false);
        setView("overview");
        setNotice("Vault를 연결했어요. 검색 색인과 정리는 진행 상황에서 확인할 수 있어요.");
      } else if (name === "organizer_disconnect_vault") {
        setNotice("Vault 연결을 해제했어요. 원문과 정리 파일은 남아 있어요.");
      }
      await refresh();
    } catch (cause) {
      if (mounted.current && version === epoch.current) setError(errorText(cause));
    } finally {
      if (version === epoch.current) {
        lock.current = false;
        if (mounted.current) setPending(null);
      }
    }
  }
  function change<K extends keyof OrganizerSettingsValue>(
    key: K,
    value: OrganizerSettingsValue[K],
  ): void {
    dirty.current = true;
    setSettingsDirty(true);
    setSettings((previous) => ({ ...previous, [key]: value }));
    setNotice(null);
  }
  async function search(): Promise<void> {
    const value = query.trim();
    const expectedContext = context.current;
    if (
      !value ||
      [...value].length > 240 ||
      !expectedContext ||
      searchPending.current ||
      !isDesktop()
    )
      return;
    searchPending.current = true;
    const sequence = ++searchSequence.current;
    setSearching(true);
    setHits(null);
    setSearchError(null);
    const current = (): boolean =>
      mounted.current &&
      sequence === searchSequence.current &&
      JSON.stringify(context.current) === JSON.stringify(expectedContext);
    try {
      const result = await command<{
        context: OrganizerStatus["context"];
        hits: OrganizerSearchHit[];
      }>("organizer_search_trial", { query: value, expectedContext });
      if (!current()) return;
      const latest = await command<OrganizerStatus>("organizer_status");
      if (!current()) return;
      acceptStatus(latest);
      if (current() && JSON.stringify(result.context) === JSON.stringify(expectedContext))
        setHits(result.hits);
    } catch (cause) {
      if (!current()) return;
      try {
        const latest = await command<OrganizerStatus>("organizer_status");
        if (!current()) return;
        acceptStatus(latest);
        if (current()) setSearchError(errorText(cause));
      } catch {
        if (current()) setSearchError("검색 연결을 다시 확인한 뒤 시도해 주세요.");
      }
    } finally {
      if (mounted.current && sequence === searchSequence.current) {
        searchPending.current = false;
        setSearching(false);
      }
    }
  }
  const disabled = Boolean(pending || !isDesktop() || !status);
  const valid =
    Number.isInteger(settings.idleSeconds) &&
    settings.idleSeconds >= 60 &&
    Number.isInteger(settings.dailyRequestLimit) &&
    settings.dailyRequestLimit >= 1;
  const progress = status?.progress;
  const connectedVaults = status?.vaults.filter((vault) => vault.enabled) ?? [];
  const total = progress
    ? progress.completed + progress.pending + progress.running + progress.deferred
    : 0;
  return (
    <section className={s.root} aria-label="Ex-brain 설정">
      {view === "connect" && (
        <div className={s.subnavigation}>
          <Button variant="ghost" size="small" onClick={() => setView("overview")}>
            ‹ Ex-brain
          </Button>
          <span>Vault 연결</span>
        </div>
      )}
      <div className={figma.split} hidden={view !== "overview"}>
        <aside className={figma.inspector}>
          <h1 className={figma.inspectorTitle}>
            <span className={figma.icon}>
              <OrganizeIcon size={18} />
            </span>
            Ex-brain
          </h1>
          <p className={figma.caption}>대화와 기억, 정리한 자료를 모아 두고 쉬는 동안 정리해요.</p>
          <div className={s.progressCard}>
            <div
              className={s.progressRing}
              role="progressbar"
              aria-label="자료 정리 진행"
              aria-valuemin={0}
              aria-valuemax={total || 1}
              aria-valuenow={progress?.completed || 0}
            >
              <span
                className={s.progressArc}
                style={
                  {
                    "--organizer-progress": `${total ? Math.round(((progress?.completed || 0) / total) * 100) : 0}%`,
                  } as CSSProperties
                }
              />
              <div className={s.ringCopy}>
                <strong>{progress?.completed || 0}</strong>
                <span>/ {total}</span>
              </div>
            </div>
            <div className={s.progressCopy}>
              <strong>
                {status?.paused ? "일시정지" : progress?.running ? "정리 중" : "대기 중"}
              </strong>
              <span className={figma.caption}>
                오늘 호출 {progress?.requestsToday || 0} / {settings.dailyRequestLimit}
              </span>
              <p className={figma.caption}>
                새로 들어온 대화와 바뀐 문서부터 정리해요. 앱을 다시 열면 남은 것부터 이어가요.
              </p>
            </div>
          </div>
          <div className={figma.controls}>
            <Button
              variant="primary"
              size="small"
              disabled={disabled}
              onClick={() => void run("organizer_run")}
            >
              지금 정리
            </Button>
            <Button
              variant="ghost"
              size="small"
              disabled={
                !isDesktop() ||
                !status ||
                Boolean(
                  pending && pending !== "organizer_run" && pending !== "organizer_scan_vault",
                )
              }
              onClick={() => void run("organizer_pause", { paused: !status?.paused })}
            >
              {status?.paused ? "정리 이어하기" : "정리 일시정지"}
            </Button>
            <Button
              variant="ghost"
              size="small"
              disabled={!isDesktop()}
              onClick={() => void run("organizer_open_records")}
            >
              정리 기록
            </Button>
          </div>
          {!!progress?.deferred && (
            <div className={figma.note}>
              <strong>보류 {progress.deferred}개</strong>
              <Button
                variant="ghost"
                size="small"
                disabled={disabled}
                onClick={() => void run("organizer_run", { retry: true })}
              >
                보류된 정리 다시 시도
              </Button>
            </div>
          )}
          <SettingControlRow
            title="쉬는 동안 자동으로 정리"
            description="숨김·조용한 시간·집중 중에는 기다려요"
            control={
              <Switch
                aria-label="유휴 시간에 자동 정리"
                checked={settings.enabled}
                disabled={disabled}
                onChange={(event) => change("enabled", event.target.checked)}
              />
            }
          />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
            className={s.search}
          >
            <label className={figma.caption} htmlFor="organizer-search">
              검색 시험
            </label>
            <div className={s.path}>
              <TextInput
                id="organizer-search"
                aria-label="검색어"
                className={s.fullInput}
                value={query}
                maxLength={240}
                onChange={(event) => {
                  cancelSearchResult();
                  setQuery(event.target.value);
                }}
              />
              <Button
                type="submit"
                variant="ghost"
                size="small"
                disabled={!isDesktop() || !status || !query.trim() || searching}
              >
                {searching ? "검색 중…" : "검색"}
              </Button>
            </div>
          </form>
          {hits?.length === 0 && <p role="status">검색 결과가 없어요.</p>}
          {hits && hits.length > 0 && (
            <ul className={s.hits}>
              {hits.map((hit) => (
                <li key={`${hit.source.id}:${hit.recordId || "source"}`}>
                  <strong>{hit.title}</strong>
                  <p>{hit.excerpt}</p>
                </li>
              ))}
            </ul>
          )}
          {searchError && (
            <p role="alert" className={common.error}>
              {searchError}
            </p>
          )}
        </aside>
        <div className={figma.right}>
          <section className={figma.section}>
            <div className={figma.controls}>
              <h2 className={figma.sectionTitle}>정리할 자료</h2>
              <Button
                variant="ghost"
                size="small"
                disabled={disabled}
                onClick={() => setView("connect")}
              >
                <PlusIcon size={14} />
                Vault 연결…
              </Button>
            </div>
            <div className={figma.group}>
              <SettingControlRow
                className={figma.row}
                title="comet의 대화·메모·할 일·일정"
                description="기본은 꺼져 있어요 · 할 일과 일정은 직접 부탁할 때만 바꿔요"
                control={
                  <Switch
                    aria-label="Comet 대화·메모·업무 기록을 정리 자료로 사용"
                    checked={settings.cometEnabled}
                    disabled={disabled}
                    onChange={(event) => change("cometEnabled", event.target.checked)}
                  />
                }
              />
              {connectedVaults.map((vault) => (
                <div key={vault.id} className={s.vaultRow}>
                  <span className={figma.icon}>
                    <FolderIcon size={18} />
                  </span>
                  <div className={s.vaultCopy}>
                    <strong>{vault.root}</strong>
                    <p className={figma.caption}>
                      Vault · 포함 {vault.include.length}곳 · 제외 {vault.exclude.length}곳
                    </p>
                    <p className={figma.caption}>
                      정리 폴더 · {vault.outputDir} ·{" "}
                      {vault.automatic ? "자동 정리 자료" : "검색 자료"}
                    </p>
                    <details>
                      <summary>연결 관리</summary>
                      <p className={figma.caption}>
                        포함: {vault.include.join(", ") || "전체"} · 제외:{" "}
                        {vault.exclude.join(", ") || "없음"}
                      </p>
                      <div className={figma.controls}>
                        <Button
                          variant="ghost"
                          size="small"
                          disabled={disabled}
                          onClick={() => void run("organizer_scan_vault", { id: vault.id })}
                        >
                          변경 자료 다시 읽기
                        </Button>
                        <Button
                          variant="ghost"
                          size="small"
                          disabled={disabled}
                          onClick={() => void run("organizer_disconnect_vault", { id: vault.id })}
                        >
                          연결 해제
                        </Button>
                      </div>
                    </details>
                  </div>
                </div>
              ))}
            </div>
            {!connectedVaults.length && <p className={figma.caption}>아직 연결한 폴더가 없어요.</p>}
          </section>
          <section className={figma.section}>
            <h2 className={figma.sectionTitle}>자동 정리</h2>
            <div className={figma.group}>
              <SettingControlRow
                className={figma.row}
                title="정리 전에 기다리는 시간"
                description="대화가 멈추고 이만큼 지나면 시작해요"
                control={
                  <Stepper
                    aria-label="정리 전 유휴 시간 (분)"
                    min={1}
                    value={settings.idleSeconds / 60}
                    unit="분"
                    disabled={disabled}
                    onValueChange={(value) => change("idleSeconds", value * 60)}
                  />
                }
              />
              <SettingControlRow
                className={figma.row}
                title="하루 정리 호출 한도"
                description="자동 잡담과 따로 세요"
                control={
                  <Stepper
                    aria-label="자동 정리 하루 호출 한도"
                    min={1}
                    value={settings.dailyRequestLimit}
                    unit="번"
                    disabled={disabled}
                    onValueChange={(value) => change("dailyRequestLimit", value)}
                  />
                }
              />
            </div>
            <p className={figma.caption}>
              외부 API나 ChatGPT를 쓰면 정리에 필요한 본문을 그 서비스로 보내요. 이 기기의 모델이면
              여기서 처리해요.
            </p>
          </section>
          {(settingsDirty || pending === "organizer_save_settings") && (
            <div className={s.save}>
              <Button
                variant="primary"
                disabled={disabled || !settingsDirty || !valid}
                onClick={() => void run("organizer_save_settings", { settings })}
              >
                Ex-brain 설정 저장
              </Button>
              <Button
                variant="ghost"
                disabled={disabled || !settingsDirty}
                onClick={() => {
                  if (status) setSettings(status.settings);
                  dirty.current = false;
                  setSettingsDirty(false);
                }}
              >
                설정 되돌리기
              </Button>
              <span className={figma.caption}>AI 연결과 별도로 저장해요.</span>
            </div>
          )}
        </div>
      </div>
      <div className={figma.split} hidden={view !== "connect"}>
        <aside className={figma.inspector}>
          <h1 className={figma.inspectorTitle}>
            <span className={figma.icon}>
              <FolderIcon size={18} />
            </span>
            Vault 연결
          </h1>
          <p className={figma.caption}>
            Markdown 노트 폴더를 연결하면 친구가 검색하고 정리할 때 읽어요. 원문과 기존 목차는
            고치지 않아요.
          </p>
          <div className={s.folderPreview}>
            <strong>{root || "연결할 폴더를 골라 주세요"}</strong>
            <div className={s.pathPreview}>
              {paths(include).map((path) => (
                <span key={`include:${path}`}>
                  <FolderIcon size={14} />
                  {path}
                  <small>포함</small>
                </span>
              ))}
              {paths(exclude).map((path) => (
                <span key={`exclude:${path}`}>
                  <FolderIcon size={14} />
                  {path}
                  <small>제외</small>
                </span>
              ))}
            </div>
          </div>
          <p className={figma.caption}>
            포함 {paths(include).length}곳 · 제외 {paths(exclude).length}곳
          </p>
          <div className={figma.note}>
            <OrganizeIcon size={16} />
            <p className={figma.caption}>
              원문과 기존 INDEX는 수정하지 않아요. 정리 결과는 Vault의 전용 정리 폴더에 남겨요.
            </p>
          </div>
        </aside>
        <div className={figma.right}>
          <fieldset disabled={disabled} className={s.fieldset}>
            <section className={figma.section}>
              <h2 className={figma.sectionTitle}>Vault 폴더</h2>
              <div className={s.folderPath}>
                <TextInput
                  aria-label="Vault 폴더"
                  className={s.fullInput}
                  value={root}
                  onChange={(event) => setRoot(event.target.value)}
                  placeholder="/Users/me/Documents/Vault"
                />
                <Button
                  variant="ghost"
                  size="small"
                  onClick={() => void run("organizer_pick_folder")}
                >
                  폴더 선택
                </Button>
              </div>
            </section>
            <section className={figma.section}>
              <h2 className={figma.sectionTitle}>포함과 제외</h2>
              <div className={s.folderFields}>
                <Textarea
                  label="포함 폴더"
                  description="Vault 안의 상대 경로예요. 비우면 전체를 검색해요."
                  value={include}
                  onChange={(event) => setInclude(event.target.value)}
                  rows={4}
                />
                <Textarea
                  label="제외 폴더"
                  description="기본 제외 경로를 확인하고 필요한 경로를 더해 주세요."
                  value={exclude}
                  onChange={(event) => setExclude(event.target.value)}
                  rows={5}
                />
              </div>
            </section>
            <section className={figma.section}>
              <h2 className={figma.sectionTitle}>전용 정리 폴더</h2>
              <div className={figma.group}>
                <SettingControlRow
                  className={figma.row}
                  title="정리 결과를 둘 폴더"
                  description="Vault 안의 상대 경로예요. 원문과 기존 INDEX는 수정하지 않아요."
                  control={
                    <TextInput
                      aria-label="전용 정리 폴더"
                      value={outputDir}
                      onChange={(event) => setOutputDir(event.target.value)}
                    />
                  }
                />
              </div>
            </section>
            <div className={figma.group}>
              <SettingControlRow
                className={figma.row}
                title="이 Vault를 자동 정리 자료로 사용"
                description="외부 AI를 쓰면 필요한 본문을 그 서비스로 보내요. 문서 안의 링크나 명령은 실행하지 않아요."
                control={
                  <Switch
                    aria-label="이 Vault를 자동 정리 자료로 사용"
                    checked={automatic}
                    onChange={(event) => setAutomatic(event.target.checked)}
                  />
                }
              />
            </div>
            <div className={s.connectActions}>
              <Button variant="ghost" onClick={() => setView("overview")}>
                취소
              </Button>
              <Button
                variant="primary"
                disabled={!root.trim() || !outputDir.trim()}
                onClick={() =>
                  void run("organizer_connect_vault", {
                    connection: {
                      root: root.trim(),
                      include: paths(include),
                      exclude: paths(exclude),
                      outputDir: outputDir.trim(),
                      automatic,
                    },
                  })
                }
              >
                Vault 연결
              </Button>
            </div>
          </fieldset>
        </div>
      </div>
      {!status && !error && <p role="status">정리 설정을 불러오고 있어요.</p>}
      {(error || status?.error) && (
        <p role="alert" className={common.error}>
          {error || status?.error}
        </p>
      )}
      {notice && (
        <p role="status" className={common.success}>
          {notice}
        </p>
      )}
    </section>
  );
}
