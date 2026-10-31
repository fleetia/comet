import { Button, ContextChip, Select, Switch } from "@comet/ui";
import { Icon } from "@comet/icon";
import { createPortal } from "react-dom";
import * as layout from "./musicSettings.css";
import { useEffect, useState, type ReactElement, type ReactNode } from "react";
import { command, isDesktop } from "../../hooks/useSnapshot";
import { record, text } from "../toolData";
import type { WidgetView } from "../types";
import { useMusicRequest } from "./useMusicRequest";
import * as c from "../../common.css";

type Config = {
  provider: string;
  allowedProviders: string[];
  showArtwork: boolean;
  showLyrics: boolean;
  hideMissing: boolean;
  allowTalk: boolean;
  priority: string;
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

function platformSupport() {
  const mac = /Mac/i.test(navigator.platform);
  const windows = /Win/i.test(navigator.platform);
  return {
    mac,
    windows,
    allowed: mac ? ["music", "spotify"] : windows ? ["system", "spotify"] : ["spotify"],
  };
}

function configFrom(widget: WidgetView): Config {
  const data = record(record(widget.data).config);
  const { mac, windows, allowed } = platformSupport();
  const defaults = windows ? ["system"] : allowed;
  const provider = text(data.provider) || (mac ? "music" : "auto");
  const supportedProvider =
    provider === "auto" ||
    provider === "spicetify" ||
    (provider === "music" && mac) ||
    (provider === "system" && windows) ||
    (provider === "spotify" && (mac || windows));
  const priority = text(data.priority) || "last-played";
  return {
    provider: supportedProvider ? provider : "auto",
    allowedProviders: Array.isArray(data.allowedProviders)
      ? data.allowedProviders.filter(
          (value): value is string => typeof value === "string" && allowed.includes(value),
        )
      : defaults,
    showArtwork: data.showArtwork !== false,
    showLyrics: data.showLyrics !== false,
    hideMissing: data.hideMissing !== false,
    allowTalk: data.allowTalk !== false,
    priority: allowed.includes(priority) ? priority : "last-played",
  };
}

function SettingsMenu({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <details
      className={[layout.moreMenu, className].filter(Boolean).join(" ")}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label={label} title={label}>
        <Icon name="more" size={18} />
      </summary>
      <div className={layout.morePanel}>{children}</div>
    </details>
  );
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
  const { mac, windows } = platformSupport();
  const [draft, setDraft] = useState<Config | null>(null);
  const config = draft ?? stored;
  const dirty =
    draft !== null &&
    JSON.stringify({ ...draft, allowedProviders: [...draft.allowedProviders].sort() }) !==
      JSON.stringify({ ...stored, allowedProviders: [...stored.allowedProviders].sort() });
  const { busy, error, invoke } = useMusicRequest(widget);
  const [bridge, setBridge] = useState<BridgeStatus | null>(null);
  const [bridgeError, setBridgeError] = useState(false);
  const [extensionSaved, setExtensionSaved] = useState(false);
  const data = record(widget.data);
  const bridgeEnabled =
    data.configured === true &&
    (stored.provider === "spicetify" ||
      (stored.provider === "auto" && stored.allowedProviders.includes("spotify")));
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
    const next = { ...config, ...patch };
    setDraft(next);
    if (
      data.configured === true &&
      (next.provider !== "auto" || next.allowedProviders.length > 0)
    ) {
      void invoke<void>("configure_connection_widget", { id: widget.id, input: next }).then(
        (result) => {
          if (result) setDraft((current) => (current === next ? null : current));
        },
      );
    }
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
  const left = (
    <fieldset className={layout.side} disabled={busy || disabled} aria-label="음악 미리보기와 표시">
      <p className={layout.caption}>곡 정보만 읽어요. 재생과 음량은 바꾸지 않아요.</p>
      <div className={layout.options} role="group" aria-label="음악 표시와 대화">
        {(
          [
            ["showArtwork", "앨범 아트 표시", "앨범 아트"],
            ["showLyrics", "앱이 제공하는 가사 표시", "앱이 제공하는 가사"],
            ["hideMissing", "제공하지 않는 곡 정보 숨기기", "앱이 알려 주지 않은 정보는 숨기기"],
            ["allowTalk", "현재 재생 중인 곡을 대화에 사용", "친구들이 지금 듣는 곡 이야기하기"],
          ] as const
        ).map(([key, label, title]) => (
          <div className={layout.optionRow} key={key}>
            <span>
              {title}
              {key === "hideMissing" && (
                <span className={layout.caption}>빈 칸 대신 그 줄을 빼요</span>
              )}
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
            <div className={layout.sectionHeading}>
              <h2 className={layout.sectionTitle}>읽어 올 앱</h2>
              <SettingsMenu label="음악 앱 직접 연결 설정">
                <h3 className={layout.sectionTitle}>직접 연결 방식</h3>
                <Select
                  fill
                  aria-label="음악 앱"
                  value={config.provider}
                  onChange={(event) => change({ provider: event.target.value })}
                >
                  <option value="auto">허용한 앱에서 자동 선택</option>
                  <option value="music" disabled={!mac}>
                    Apple Music · macOS
                  </option>
                  <option value="spotify" disabled={!mac && !windows}>
                    Spotify · 직접 읽기 (macOS · Windows)
                  </option>
                  <option value="system" disabled={!windows}>
                    시스템 미디어 · Windows
                  </option>
                  <option value="spicetify">Spotify + Spicetify</option>
                </Select>
              </SettingsMenu>
            </div>
            <div className={layout.rows}>
              <div className={layout.providerGroup} role="group" aria-label="자동 선택을 허용할 앱">
                {[
                  [
                    "music",
                    "Apple Music",
                    mac ? "이 Mac에서 바로 읽어요" : "macOS에서만 바로 읽을 수 있어요",
                  ],
                  ["spotify", "Spotify", "Spicetify 확장을 거쳐 읽어요"],
                  ["system", "시스템 미디어", "Windows에서 재생 중인 앱을 읽어요"],
                ].map(([provider, title, description]) => (
                  <div
                    className={layout.settingRow}
                    key={provider}
                    style={
                      (provider === "music" && !mac) || (provider === "system" && !windows)
                        ? { opacity: 0.55 }
                        : undefined
                    }
                  >
                    <span>
                      <span>{title}</span>
                      <span className={layout.caption}>{description}</span>
                    </span>
                    {(provider === "music" && !mac) || (provider === "system" && !windows) ? (
                      <ContextChip className={layout.platformChip}>
                        {provider === "music" ? "macOS 전용" : "Windows 전용"}
                      </ContextChip>
                    ) : (
                      <Switch
                        aria-label={`${title} · ${provider === "system" ? "Windows" : provider === "music" ? "macOS" : "Spicetify"}`}
                        checked={config.allowedProviders.includes(provider)}
                        onChange={(event) =>
                          change({
                            provider: "auto",
                            allowedProviders: event.target.checked
                              ? [...config.allowedProviders, provider]
                              : config.allowedProviders.filter((value) => value !== provider),
                          })
                        }
                      />
                    )}
                  </div>
                ))}
              </div>
              <div className={layout.settingRow}>
                <span>두 앱이 함께 재생할 때</span>
                <Select
                  fill
                  aria-label="음악 앱 우선순위"
                  className={layout.providerSelect}
                  value={config.priority}
                  onChange={(event) => change({ priority: event.target.value, provider: "auto" })}
                >
                  <option value="last-played">마지막에 재생한 앱</option>
                  <option value="music" disabled={!mac}>
                    Apple Music 우선
                  </option>
                  <option value="spotify">Spotify 우선</option>
                  <option value="system" disabled={!windows}>
                    시스템 미디어 우선
                  </option>
                </Select>
              </div>
            </div>
            <p className={layout.caption}>
              앱이 알려 주는 정보만 보여요. 현재 음악 정보는 기기 안에서 읽어요.
            </p>
          </section>
          {(data.configured !== true || (dirty && error)) && (
            <div className={layout.settingActions}>
              {dirty && (
                <Button type="button" variant="ghost" onClick={() => setDraft(null)}>
                  {data.configured === true ? "저장한 값으로 되돌리기" : "선택 초기화"}
                </Button>
              )}
              <Button
                type="submit"
                variant="primary"
                disabled={config.provider === "auto" && config.allowedProviders.length === 0}
              >
                {data.configured === true ? "다시 저장" : "곡 정보 읽기 허용하고 연결"}
              </Button>
            </div>
          )}
        </form>
        <section className={layout.section} aria-label="Spicetify 로컬 연결">
          <div className={layout.sectionHeading}>
            <h3 className={layout.sectionTitle}>Spotify 연결</h3>
            <div className={layout.headingActions}>
              {(bridge?.connected || bridge?.pairing || bridge?.remembered) && (
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  onClick={() => void disconnect()}
                >
                  로컬 연결 해제
                </Button>
              )}
              <SettingsMenu label="Spotify 연결 방법">
                <h3 className={layout.sectionTitle}>Spotify 연결 방법</h3>
                <p>
                  Spicetify의 Extensions 폴더에 저장한 <code>comet.js</code>를 추가하고 적용한 뒤
                  Spotify의 Comet 메뉴를 열어 주세요.
                </p>
                <p>
                  처음 한 번 연결하면 다시 실행해도 자동으로 연결돼요.{" "}
                  {mac || windows
                    ? "음악 위젯을 열면 종료된 Spotify도 실행돼요."
                    : "Spotify는 직접 실행해 주세요."}{" "}
                  재생과 음량은 Spotify에서 바꿔 주세요. Spotify 로그인 정보는 Comet에 전달하지
                  않아요.
                </p>
              </SettingsMenu>
            </div>
          </div>
          <div className={layout.rows}>
            <div className={layout.settingRow}>
              <span>상태</span>
              <p className={layout.status} role="status">
                {bridgeEnabled
                  ? bridgeStatusText(bridge, bridgeError)
                  : data.configured === true
                    ? "Spotify를 허용하면 연결 코드를 만들 수 있어요."
                    : "곡 정보 읽기를 허용하면 연결 코드를 만들 수 있어요."}
              </p>
            </div>
            <div className={layout.settingRow}>
              <span>
                <strong>Comet 확장 파일</strong>
                <span className={layout.caption}>Spicetify 확장 폴더에 놓는 파일이에요</span>
              </span>
              <Button
                type="button"
                size="small"
                variant="ghost"
                onClick={async () => {
                  const result = await invoke<string | null>("export_music_extension", {});
                  if (result?.value) setExtensionSaved(true);
                }}
              >
                Comet 확장 파일 저장
              </Button>
            </div>
            {bridgeEnabled && (
              <div className={layout.settingRow}>
                <span>
                  <strong>연결 코드</strong>
                  <span className={layout.caption}>
                    확장이 이 코드를 넣으면 연결돼요. 3분 동안 쓸 수 있어요.
                  </span>
                </span>
                <Button type="button" size="small" variant="ghost" onClick={() => void pair()}>
                  {bridge?.connected ? "새 연결 코드 발급" : "연결 코드 만들기"}
                </Button>
              </div>
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
        </section>
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
