import { useEffect, useRef, useState, type JSX } from "react";
import { Button, Checkbox, FormField, Surface, TextField } from "@fleetia/lagrange";
import { command, errorText, isDesktop } from "../../hooks/useSnapshot";
import {
  DEFAULT_ORGANIZER_SETTINGS,
  PREVIEW_ORGANIZER_STATUS,
  type OrganizerSettingsValue,
  type OrganizerStatus,
} from "../../organizer/types";
import * as s from "./organizerSettings.css";
import * as common from "../../lagrange.css";

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
        setStatus(next);
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
    return () => {
      mounted.current = false;
      epoch.current += 1;
      clearInterval(timer);
    };
  }, []);
  async function run(name: string, args?: Record<string, unknown>): Promise<void> {
    if (lock.current && name !== "organizer_pause") return;
    lock.current = true;
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
  const disabled = Boolean(pending || !isDesktop() || !status);
  const valid =
    Number.isInteger(settings.idleSeconds) &&
    settings.idleSeconds >= 60 &&
    Number.isInteger(settings.dailyRequestLimit) &&
    settings.dailyRequestLimit >= 1;
  const progress = status?.progress;
  const connectedVaults = status?.vaults.filter((vault) => vault.enabled) ?? [];
  return (
    <Surface className={s.panel} aria-label="Ex-brain 설정">
      <section className={s.section}>
        <h2 className={s.heading}>Ex-brain · 기억과 업무 정리</h2>
        <p className={s.caption}>
          캐릭터에게 기록과 검색을 부탁하고, 허용한 자료를 쉬는 동안 정리해요. 할 일과 일정은 직접
          요청한 경우에만 바꿔요.
        </p>
        <fieldset disabled={disabled} className={s.fieldset}>
          <div className={s.section}>
            <Checkbox
              checked={settings.enabled}
              onChange={(event) => change("enabled", event.target.checked)}
            >
              유휴 시간에 자동 정리
            </Checkbox>
            <Checkbox
              checked={settings.cometEnabled}
              onChange={(event) => change("cometEnabled", event.target.checked)}
            >
              Comet 대화·메모·업무 기록을 정리 자료로 사용
            </Checkbox>
            <p className={s.caption}>
              ChatGPT나 외부 API를 선택하면 정리에 필요한 대화·메모·업무 본문을 해당 서비스로
              보내요. 로컬 모델을 선택하면 이 기기에서 처리해요.
            </p>
            <div className={s.grid}>
              <FormField label="정리 전 유휴 시간 (분)">
                <TextField
                  type="number"
                  min={1}
                  value={settings.idleSeconds / 60}
                  onChange={(event) => change("idleSeconds", Number(event.target.value) * 60)}
                />
              </FormField>
              <FormField label="자동 정리 하루 호출 한도">
                <TextField
                  type="number"
                  min={1}
                  value={settings.dailyRequestLimit}
                  onChange={(event) => change("dailyRequestLimit", Number(event.target.value))}
                />
              </FormField>
            </div>
            <p className={s.caption}>
              현재 저장된 AI 연결을 사용해요. 이 호출 한도는 자동 잡담과 별도예요.
              숨김·일시정지·조용한 시간·집중 중에는 자동 정리를 기다려요.
            </p>
          </div>
        </fieldset>
        <div className={s.save}>
          <Button
            variant="primary"
            disabled={disabled || !settingsDirty || !valid}
            onClick={() => void run("organizer_save_settings", { settings })}
          >
            Ex-brain 설정 저장
          </Button>
          <Button
            variant="quiet"
            disabled={disabled || !settingsDirty}
            onClick={() => {
              if (status) setSettings(status.settings);
              dirty.current = false;
              setSettingsDirty(false);
            }}
          >
            설정 되돌리기
          </Button>
          <span className={s.caption}>
            {settingsDirty ? "AI 연결과 별도로 저장해요." : "저장된 Ex-brain 설정이에요."}
          </span>
        </div>
      </section>
      <section className={s.section} aria-label="연결한 Vault">
        <h3 className={s.heading}>연결한 Vault</h3>
        {status && connectedVaults.length === 0 && (
          <p className={s.caption}>아직 연결한 폴더가 없어요.</p>
        )}
        {connectedVaults.map((vault) => (
          <div className={s.item} key={vault.id}>
            <strong>{vault.root}</strong>
            <p className={s.caption}>
              정리 폴더 · {vault.outputDir} · {vault.automatic ? "자동 정리 자료" : "검색 자료"}
            </p>
            <p className={s.caption}>
              포함: {vault.include.join(", ") || "전체"} · 제외:{" "}
              {vault.exclude.join(", ") || "없음"}
            </p>
            <div className={s.actions}>
              <Button
                variant="secondary"
                disabled={disabled}
                onClick={() => void run("organizer_scan_vault", { id: vault.id })}
              >
                변경 자료 다시 읽기
              </Button>
              <Button
                variant="quiet"
                disabled={disabled}
                onClick={() => void run("organizer_disconnect_vault", { id: vault.id })}
              >
                연결 해제
              </Button>
            </div>
          </div>
        ))}
        <details>
          <summary>Vault 연결{vaultDirty ? " · 입력 중" : ""}</summary>
          <fieldset disabled={disabled} className={s.fieldset}>
            <div className={s.section}>
              <FormField
                label="Vault 폴더"
                description="Markdown 원문이 있는 폴더의 절대 경로예요."
              >
                <div className={s.path}>
                  <TextField
                    value={root}
                    onChange={(event) => setRoot(event.target.value)}
                    placeholder="/Users/me/Documents/Vault"
                  />
                  <Button variant="secondary" onClick={() => void run("organizer_pick_folder")}>
                    폴더 선택
                  </Button>
                </div>
              </FormField>
              <div className={s.grid}>
                <FormField
                  label="포함 폴더"
                  description="Vault 안의 상대 경로를 한 줄에 하나씩 써요. 비우면 전체를 검색해요."
                >
                  <textarea
                    className={s.textarea}
                    rows={3}
                    value={include}
                    onChange={(event) => setInclude(event.target.value)}
                  />
                </FormField>
                <FormField
                  label="제외 폴더"
                  description="기본 제외 경로를 확인하고 필요한 경로를 더해 주세요."
                >
                  <textarea
                    className={s.textarea}
                    rows={5}
                    value={exclude}
                    onChange={(event) => setExclude(event.target.value)}
                  />
                </FormField>
              </div>
              <FormField
                label="전용 정리 폴더"
                description="Vault 안의 상대 경로예요. 기존 문서와 INDEX는 수정하지 않아요."
              >
                <TextField
                  value={outputDir}
                  onChange={(event) => setOutputDir(event.target.value)}
                />
              </FormField>
              <Checkbox
                checked={automatic}
                onChange={(event) => setAutomatic(event.target.checked)}
              >
                이 Vault를 자동 정리 자료로 사용
              </Checkbox>
              <p className={s.caption}>
                ChatGPT나 외부 API를 사용하면 선택한 자료 중 요청에 필요한 본문을 해당 서비스로
                보내요. 폴더 밖 링크와 문서 안의 명령은 실행하지 않아요.
              </p>
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
        </details>
      </section>
      <section className={s.section} aria-label="정리 진행 상황">
        <h3 className={s.heading}>정리 진행 상황</h3>
        {progress && (
          <p className={s.caption}>
            완료 {progress.completed} · 대기 {progress.pending} · 처리 중 {progress.running} · 보류{" "}
            {progress.deferred}
            <br />
            오늘 자동 정리 호출 {progress.requestsToday} / {status?.settings.dailyRequestLimit} ·
            정리 기록 {progress.records}개
          </p>
        )}
        {status?.paused && <p role="status">정리를 일시정지했어요.</p>}
        <div className={s.actions}>
          <Button variant="secondary" disabled={disabled} onClick={() => void run("organizer_run")}>
            지금 정리
          </Button>
          <Button
            variant="secondary"
            disabled={
              !isDesktop() ||
              !status ||
              Boolean(pending && pending !== "organizer_run" && pending !== "organizer_scan_vault")
            }
            onClick={() => void run("organizer_pause", { paused: !status?.paused })}
          >
            {status?.paused ? "정리 이어하기" : "정리 일시정지"}
          </Button>
          <Button
            variant="quiet"
            disabled={disabled || !progress?.deferred}
            onClick={() => void run("organizer_run", { retry: true })}
          >
            보류된 정리 다시 시도
          </Button>
        </div>
        <p className={s.caption}>
          처음 연결한 자료도 호출 한도 안에서 순서대로 정리해요. 앱을 다시 열면 남은 자료부터
          이어가요. 자세한 결과와 되돌리기는 다이어리의 정리 기록에서 확인해요.
        </p>
      </section>
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
    </Surface>
  );
}
