import { Button, FormField, Select } from "../../ui";
import { Switch, WidgetExpanded } from "@comet/ui";
import { Icon } from "@comet/icon";
import { createPortal } from "react-dom";
import { artworkUrl, finiteNumber, musicTime } from "./musicData";
import * as layout from "./musicSettings.css";
import { useEffect, useState, type ReactElement } from "react";
import { command, isDesktop } from "../../hooks/useSnapshot";
import { record, text } from "../toolData";
import type { WidgetView } from "../types";
import { useMusicRequest } from "./useMusicRequest";
import * as c from "../../lagrange.css";

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
  remembered: boolean;
  pairing: boolean;
  enabled: boolean;
  port: number;
  code?: string;
  expiresAt?: number;
};

function bridgeStatusText(bridge: BridgeStatus | null, failed: boolean): string {
  if (bridge?.connected) return "Spotify 확장과 연결되었어요.";
  if (failed) return "로컬 연결 상태를 확인하지 못했어요.";
  if (bridge?.remembered) return "Spotify 확장의 자동 재연결을 기다리고 있어요.";
  return "Spotify 확장 연결을 기다리고 있어요.";
}

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
  onBusyChange,
  sideContainer,
  disabled = false,
}: {
  widget: WidgetView;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  sideContainer?: HTMLElement | null;
  disabled?: boolean;
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
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => () => onBusyChange?.(false), [onBusyChange]);
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
  const observation = record(data.observation);
  const artwork = config.showArtwork ? artworkUrl(observation.artworkUrl) : null;
  const duration = finiteNumber(observation.durationMs);
  const position = finiteNumber(observation.positionMs);
  const left = (
    <fieldset className={layout.side} disabled={busy || disabled} aria-label="음악 미리보기와 표시">
      <div className={layout.previewStage}>
        <WidgetExpanded title="음악 정보" icon="music" className={layout.preview}>
          <div className={layout.song}>
            <span className={layout.artwork}>
              {artwork ? (
                <img src={artwork} alt="현재 곡 앨범 아트" referrerPolicy="no-referrer" />
              ) : (
                <Icon name="music" size={24} />
              )}
            </span>
            <span className={layout.songText}>
              <strong>{text(observation.title) || "재생 중인 곡이 없어요"}</strong>
              <span>{text(observation.artist)}</span>
              {(!config.hideMissing || text(observation.album)) && (
                <span>{text(observation.album) || "앨범 정보 없음"}</span>
              )}
            </span>
          </div>
          <progress
            className={layout.progress}
            aria-label="미리보기 재생 위치"
            value={Math.max(0, Math.min(1, duration && position ? position / duration : 0))}
            max={1}
          />
          <div className={layout.trackTime}>
            <span>{musicTime(position)}</span>
            <span>{text(observation.source) || "연결 대기"}</span>
            <span>{musicTime(duration)}</span>
          </div>
        </WidgetExpanded>
      </div>
      <p className={layout.caption}>
        허용한 음악 앱에서 곡 정보를 읽어요. 연결 설정을 저장하면 앱이 지원하는 재생 제어도 사용할
        수 있어요.
      </p>
      <div className={layout.options} role="group" aria-label="음악 표시와 대화">
        {(
          [
            ["showArtwork", "앨범 아트 표시", "앨범 아트"],
            ["hideMissing", "제공하지 않는 곡 정보 숨기기", "앱이 알려 주지 않은 정보 숨기기"],
            ["allowTalk", "현재 재생 중인 곡을 대화에 사용", "친구들이 지금 듣는 곡 이야기하기"],
          ] as const
        ).map(([key, label, title]) => (
          <div className={layout.optionRow} key={key}>
            <span>
              {title}
              {key === "allowTalk" && (
                <span className={layout.caption}>곡 제목과 아티스트만 대화에 써요</span>
              )}
            </span>
            <Switch
              aria-label={label}
              checked={config[key]}
              onChange={(event) => change({ [key]: event.target.checked })}
            />
          </div>
        ))}
      </div>
      <details className={layout.more}>
        <summary>추가 표시</summary>
        <div className={layout.optionRow}>
          <span>앱이 제공하는 가사 표시</span>
          <Switch
            aria-label="앱이 제공하는 가사 표시"
            checked={config.showLyrics}
            onChange={(event) => change({ showLyrics: event.target.checked })}
          />
        </div>
      </details>
    </fieldset>
  );
  return (
    <div className={sideContainer ? layout.withSideContainer : layout.workspace}>
      {sideContainer ? createPortal(left, sideContainer) : left}
      <fieldset className={layout.settings} disabled={busy || disabled}>
        <form
          className={layout.form}
          onSubmit={async (event) => {
            event.preventDefault();
            const result = await invoke<void>("configure_connection_widget", {
              id: widget.id,
              input: config,
            });
            if (result) setDraft(null);
          }}
        >
          <section className={layout.section} aria-label="읽어 올 앱">
            <h2 className={layout.sectionTitle}>읽어 올 앱</h2>
            <div className={layout.rows}>
              <FormField label="음악 앱" className={layout.providerField}>
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
                <div role="group" aria-label="자동 선택을 허용할 앱">
                  {[
                    ["music", "Apple Music", "이 Mac에서 바로 읽어요"],
                    ["spotify", "Spotify", "이 Mac에서 바로 읽어요"],
                    ["system", "시스템 미디어", "Windows에서 재생 중인 앱을 읽어요"],
                  ].map(([provider, title, description]) => (
                    <div className={layout.settingRow} key={provider}>
                      <span>
                        <strong>{title}</strong>
                        <span className={layout.caption}>{description}</span>
                      </span>
                      <Switch
                        aria-label={`${title} · ${provider === "system" ? "Windows" : "macOS"}`}
                        checked={config.allowedProviders.includes(provider)}
                        onChange={(event) =>
                          change({
                            allowedProviders: event.target.checked
                              ? [...config.allowedProviders, provider]
                              : config.allowedProviders.filter((value) => value !== provider),
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className={layout.caption}>
              {config.provider === "spicetify"
                ? "Spicetify 확장을 거쳐 읽어요. 플레이리스트·대기열·좋아요도 사용할 수 있어요."
                : "처음 연결할 때 시스템 자동화 권한을 요청할 수 있어요. 앱이 제공하는 기능만 사용해요."}
            </p>
          </section>
          <div className={layout.settingActions}>
            {dirty && (
              <Button type="button" variant="secondary" onClick={() => setDraft(null)}>
                연결 변경 취소
              </Button>
            )}
            <Button
              type="submit"
              variant="primary"
              disabled={config.provider === "auto" && config.allowedProviders.length === 0}
            >
              {data.configured === true ? "연결 설정 저장" : "곡 정보 조회·재생 제어 허용하고 연결"}
            </Button>
          </div>
        </form>
        {config.provider === "spicetify" && (
          <section className={layout.section} aria-label="Spicetify 로컬 연결">
            <div className={layout.sectionHeading}>
              <h3 className={layout.sectionTitle}>Spotify 연결</h3>
              {(bridge?.connected || bridge?.pairing || bridge?.remembered) && (
                <Button
                  type="button"
                  size="compact"
                  variant="quiet"
                  onClick={() => void disconnect()}
                >
                  로컬 연결 해제
                </Button>
              )}
            </div>
            <div className={layout.rows}>
              <div className={layout.settingRow}>
                <span>상태</span>
                <p className={layout.status} role="status">
                  {bridgeStatusText(bridge, bridgeError)}
                </p>
              </div>
              <div className={layout.settingRow}>
                <span>
                  <strong>Comet 확장 파일</strong>
                  <span className={layout.caption}>Spicetify 확장 폴더에 놓는 파일이에요</span>
                </span>
                <Button
                  type="button"
                  size="compact"
                  variant="secondary"
                  onClick={async () => {
                    const result = await invoke<string | null>("export_music_extension", {});
                    if (result?.value) setExtensionSaved(true);
                  }}
                >
                  Comet 확장 파일 저장
                </Button>
              </div>
              {bridgeEnabled ? (
                <div className={layout.settingRow}>
                  <span>
                    <strong>연결 코드</strong>
                    <span className={layout.caption}>
                      확장이 이 코드를 넣으면 연결돼요. 3분 동안 쓸 수 있어요.
                    </span>
                  </span>
                  <Button
                    type="button"
                    size="compact"
                    variant="secondary"
                    onClick={() => void pair()}
                  >
                    {bridge?.connected ? "새 연결 코드 발급" : "연결 코드 만들기"}
                  </Button>
                </div>
              ) : (
                <p className={layout.caption}>먼저 위의 연결 설정을 저장해 주세요.</p>
              )}
            </div>
            {extensionSaved && (
              <p role="status" className={c.success}>
                Comet 확장 파일을 저장했어요.
              </p>
            )}
            {bridge?.code && bridge.pairing && (
              <div className={layout.pairingCode}>
                <span className={layout.caption}>Spotify의 Comet 메뉴에 입력할 연결 코드</span>
                <code>{bridge.code}</code>
                <span className={layout.caption}>
                  로컬 포트 {bridge.port} ·{" "}
                  {bridge.expiresAt ? new Date(bridge.expiresAt).toLocaleTimeString() : "3분 후"}
                  까지 유효
                </span>
              </div>
            )}
            <details className={layout.more}>
              <summary>Spotify 연결 방법</summary>
              <p>
                Spicetify의 Extensions 폴더에 저장한 <code>comet.js</code>를 추가하고 적용한 뒤
                Spotify의 Comet 메뉴를 열어 주세요.
              </p>
              <p>
                처음 한 번 연결하면 다시 실행해도 자동으로 연결돼요. 음악 위젯을 열면 종료된
                Spotify도 실행돼요. 재생은 재생 버튼을 눌러 시작해 주세요. Spotify 로그인 정보는
                Comet에 전달하지 않아요.
              </p>
            </details>
          </section>
        )}
        {(error || text(data.error)) && (
          <p role="alert" className={c.error}>
            {error || text(data.error)}
          </p>
        )}
        {busy && (
          <p role="status" className={layout.caption}>
            연결 정보를 처리하고 있어요.
          </p>
        )}
      </fieldset>
    </div>
  );
}
