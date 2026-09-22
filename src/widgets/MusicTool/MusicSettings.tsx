import { Button, Checkbox, FormField, Select } from "@fleetia/lagrange";
import { useEffect, useState, type ReactElement } from "react";
import { command, isDesktop } from "../../hooks/useSnapshot";
import { record, text } from "../toolData";
import type { WidgetView } from "../types";
import { useMusicRequest } from "./useMusicRequest";
import * as c from "../../lagrange.css";
import * as s from "./musicTool.css";

type Config = {
  provider: string;
  allowedProviders: string[];
  showArtwork: boolean;
  showLyrics: boolean;
  hideMissing: boolean;
  allowTalk: boolean;
};
type BridgeStatus = {
  connected: boolean;
  pairing: boolean;
  enabled: boolean;
  port: number;
  code?: string;
  expiresAt?: number;
};

function configFrom(widget: WidgetView): Config {
  const data = record(record(widget.data).config);
  const defaults = /Win/i.test(navigator.platform) ? ["system"] : ["music", "spotify"];
  return {
    provider: text(data.provider) || "music",
    allowedProviders: Array.isArray(data.allowedProviders)
      ? data.allowedProviders.filter((value): value is string => typeof value === "string")
      : defaults,
    showArtwork: data.showArtwork !== false,
    showLyrics: data.showLyrics !== false,
    hideMissing: data.hideMissing !== false,
    allowTalk: data.allowTalk !== false,
  };
}

export function MusicSettings({
  widget,
  onDirtyChange,
}: {
  widget: WidgetView;
  onDirtyChange?: (dirty: boolean) => void;
}): ReactElement {
  const stored = configFrom(widget);
  const [draft, setDraft] = useState<Config | null>(null);
  const config = draft ?? stored;
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(stored);
  const { busy, error, invoke } = useMusicRequest(widget);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [bridgeError, setBridgeError] = useState(false);
  const [extensionSaved, setExtensionSaved] = useState(false);
  const data = record(widget.data);
  const bridgeEnabled = data.configured === true && stored.provider === "spicetify";
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => {
    setBridge(null);
    setBridgeError(false);
    if (!bridgeEnabled || !isDesktop()) return;
    let active = true;
    let pending = false;
    async function poll(): Promise<void> {
      if (pending) return;
      pending = true;
      try {
        const status = await command<BridgeStatus>("music_bridge_status", { id: widget.id });
        if (active) {
          setBridge(status);
          setBridgeError(false);
        }
      } catch {
        if (active) setBridgeError(true);
      } finally {
        pending = false;
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [bridgeEnabled, widget.id]);
  function change(patch: Partial<Config>): void {
    setDraft({ ...config, ...patch });
  }
  async function pair(): Promise<void> {
    const result = await invoke<BridgeStatus>("music_bridge_pair", {
      id: widget.id,
      expectedRevision: widget.revision,
    });
    if (result) setBridge(result.value);
  }
  async function disconnect(): Promise<void> {
    const result = await invoke<void>("music_bridge_disconnect", {
      id: widget.id,
      expectedRevision: widget.revision,
    });
    if (result) setBridge(null);
  }
  return (
    <fieldset className={s.settings} disabled={busy}>
      <h2>음악 앱 연결</h2>
      <p>허용한 음악 앱의 현재 곡 정보를 읽고 재생을 제어합니다.</p>
      <form
        className={s.settingsForm}
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await invoke<void>("configure_connection_widget", {
            id: widget.id,
            input: config,
          });
          if (result) setDraft(null);
        }}
      >
        <FormField label="음악 앱" className={s.settingField}>
          <Select
            value={config.provider}
            onChange={(event) => change({ provider: event.target.value })}
          >
            <option value="auto">허용한 앱에서 자동 선택</option>
            <option value="music">Apple Music · macOS</option>
            <option value="spotify">Spotify · macOS</option>
            <option value="system">시스템 미디어 · Windows</option>
            <option value="spicetify">Spotify + Spicetify</option>
          </Select>
        </FormField>
        {config.provider === "auto" && (
          <div className={s.options} role="group" aria-label="자동 선택을 허용할 앱">
            <p className={c.quiet}>선택한 앱 중 재생 중인 앱을 우선합니다.</p>
            {[
              ["music", "Apple Music · macOS"],
              ["spotify", "Spotify · macOS"],
              ["system", "시스템 미디어 · Windows"],
            ].map(([provider, label]) => (
              <Checkbox
                key={provider}
                checked={config.allowedProviders.includes(provider)}
                onChange={(event) =>
                  change({
                    allowedProviders: event.target.checked
                      ? [...config.allowedProviders, provider]
                      : config.allowedProviders.filter((value) => value !== provider),
                  })
                }
              >
                {label}
              </Checkbox>
            ))}
          </div>
        )}
        <p className={c.quiet}>
          {config.provider === "spicetify"
            ? "Spotify에 Spicetify와 Comet 확장을 설치하면 플레이리스트·랜덤 재생·대기열·좋아요도 사용할 수 있어요."
            : "macOS는 처음 연결할 때 시스템 자동화 권한을 요청할 수 있어요. 앱이 제공하는 제어만 표시합니다."}
        </p>
        <div className={s.options} role="group" aria-label="음악 표시와 대화">
          <Checkbox
            checked={config.showArtwork}
            onChange={(event) => change({ showArtwork: event.target.checked })}
          >
            앨범 아트 표시
          </Checkbox>
          <Checkbox
            checked={config.showLyrics}
            onChange={(event) => change({ showLyrics: event.target.checked })}
          >
            앱이 제공하는 가사 표시
          </Checkbox>
          <Checkbox
            checked={config.hideMissing}
            onChange={(event) => change({ hideMissing: event.target.checked })}
          >
            제공하지 않는 곡 정보 숨기기
          </Checkbox>
          <Checkbox
            checked={config.allowTalk}
            onChange={(event) => change({ allowTalk: event.target.checked })}
          >
            현재 재생 중인 곡을 대화에 사용
          </Checkbox>
        </div>
        <div className={s.settingActions}>
          <Button
            type="submit"
            variant="primary"
            disabled={config.provider === "auto" && config.allowedProviders.length === 0}
          >
            {data.configured === true ? "연결 설정 저장" : "곡 정보 조회·재생 제어 허용하고 연결"}
          </Button>
          {dirty && (
            <Button type="button" variant="quiet" onClick={() => setDraft(null)}>
              연결 변경 취소
            </Button>
          )}
        </div>
      </form>
      {config.provider === "spicetify" && (
        <section className={s.pairing} aria-label="Spicetify 로컬 연결">
          <h3>Spotify와 로컬 연결</h3>
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              const result = await invoke<string | null>("export_music_extension", {});
              if (result?.value) setExtensionSaved(true);
            }}
          >
            Comet 확장 파일 저장
          </Button>
          {extensionSaved && (
            <p role="status" className={c.success}>
              Comet 확장 파일을 저장했어요.
            </p>
          )}
          <p>
            Spicetify의 Extensions 폴더에 저장한 <code>comet.js</code>를 추가하고 적용한 뒤
            Spotify의 Comet 메뉴를 열어 주세요.
          </p>
          <p className={c.quiet}>
            Spotify 로그인 정보는 Comet에 전달하지 않습니다. Spotify가 연결을 종료하면 다시 연결해야
            해요.
          </p>
          {!bridgeEnabled && <p>먼저 위의 연결 설정을 저장해 주세요.</p>}
          {bridgeEnabled && (
            <>
              <p role="status">
                {bridge?.connected
                  ? "Spotify 확장과 연결되었어요."
                  : bridgeError
                    ? "로컬 연결 상태를 확인하지 못했어요."
                    : "Spotify 확장 연결을 기다리고 있어요."}
              </p>
              {bridge?.code && bridge.pairing && (
                <div className={s.pairingCode}>
                  <span className={c.quiet}>Spotify의 Comet 메뉴에 입력할 연결 코드</span>
                  <code>{bridge.code}</code>
                  <span className={c.quiet}>
                    로컬 포트 {bridge.port} ·{" "}
                    {bridge.expiresAt ? new Date(bridge.expiresAt).toLocaleTimeString() : "3분 후"}
                    까지 유효
                  </span>
                </div>
              )}
              <Button type="button" variant="secondary" onClick={() => void pair()}>
                {bridge?.connected ? "새 연결 코드 발급" : "연결 코드 만들기"}
              </Button>
              {(bridge?.connected || bridge?.pairing) && (
                <Button type="button" variant="quiet" onClick={() => void disconnect()}>
                  로컬 연결 해제
                </Button>
              )}
            </>
          )}
        </section>
      )}
      {(error || text(data.error)) && (
        <p role="alert" className={c.error}>
          {error || text(data.error)}
        </p>
      )}
      {busy && (
        <p role="status" className={c.quiet}>
          연결 정보를 처리하고 있어요.
        </p>
      )}
    </fieldset>
  );
}
