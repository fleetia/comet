import { TabPanel, externalTabPanels } from "../../primitives";
import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { isDesktop } from "../../hooks/useSnapshot";
import { record, text, type DataRecord } from "../toolData";
import type { WidgetValue, WidgetView } from "../types";
import { MusicLibrary } from "./MusicLibrary";
import { Icon } from "@comet/icon";
import { Button, ContextMenu, IconButton, MusicWidget, Tabs } from "@comet/ui";
import {
  artworkUrl,
  finiteNumber,
  metadataText,
  MUSIC_METADATA_LABELS,
  musicIsFresh,
  musicPosition,
  musicTime,
} from "./musicData";
import { useMusicRequest } from "./useMusicRequest";
import * as c from "../../common.css";
import * as s from "./musicTool.css";

function Artwork({ url, title }: { url: string | null; title: string }): ReactElement {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [url]);
  return url && !failed ? (
    <img
      className={s.artwork}
      src={url}
      alt={`${title || "현재 곡"} 앨범 아트`}
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
    />
  ) : (
    <div className={s.artworkPlaceholder} aria-label="앨범 아트 없음">
      <Icon name="music" size={28} />
    </div>
  );
}

function SongInformation({
  observation,
  hideMissing,
}: {
  observation: DataRecord;
  hideMissing: boolean;
}): ReactElement {
  const metadata = record(observation.metadata);
  const metadataKeys = [
    ...new Set([
      "albumArtist",
      "genre",
      "composer",
      "year",
      "trackNumber",
      "discNumber",
      ...Object.keys(metadata),
    ]),
  ];
  const position = finiteNumber(observation.positionMs);
  const volume = finiteNumber(observation.volume);
  const observedAt = finiteNumber(observation.observedAt);
  const observedDate = observedAt === null ? null : new Date(observedAt);
  const playbackState = text(observation.playbackState);
  const repeat = text(observation.repeat);
  const playbackLabels: Record<string, string> = {
    playing: "재생 중",
    paused: "일시정지",
    stopped: "정지",
  };
  const repeatLabels: Record<string, string> = { off: "끔", all: "전체", one: "한 곡" };
  const entries: [string, WidgetValue | undefined][] = [
    ["곡 제목", observation.title],
    ["아티스트", observation.artist],
    ["앨범", observation.album],
    [
      "재생 시간",
      finiteNumber(observation.durationMs) === null
        ? null
        : musicTime(finiteNumber(observation.durationMs)),
    ],
    ["재생 상태", playbackLabels[playbackState] ?? playbackState],
    ["마지막 조회 위치", position === null ? null : musicTime(position)],
    ["음량", volume === null ? null : `${volume}%`],
    [
      "셔플",
      typeof observation.shuffle === "boolean" ? (observation.shuffle ? "켜짐" : "끔") : null,
    ],
    ["반복", repeatLabels[repeat] ?? repeat],
    ["좋아요", observation.liked],
    ...metadataKeys.map((key): [string, WidgetValue | undefined] => [
      MUSIC_METADATA_LABELS[key] ?? key,
      metadata[key],
    ]),
    ["곡 ID", observation.trackId],
    ["재생 목록 URI", observation.contextUri],
    ["재생 앱", observation.source],
    [
      "마지막 조회",
      observedDate !== null && Number.isFinite(observedDate.getTime())
        ? observedDate.toLocaleString()
        : null,
    ],
  ];
  return (
    <section className={s.info} aria-label="곡 정보">
      <p className={c.quiet}>음악 앱이 제공하는 정보입니다.</p>
      <dl className={s.metadata}>
        {entries
          .filter(
            ([, value]) => !hideMissing || (value !== null && value !== undefined && value !== ""),
          )
          .map(([label, value], index) => (
            <div className={s.metadataRow} key={`${label}-${index}`}>
              <dt>{label}</dt>
              <dd>{metadataText(value)}</dd>
            </div>
          ))}
      </dl>
    </section>
  );
}

export function MusicTool({
  widget,
  embedded = false,
  onCollapse,
}: {
  widget: WidgetView;
  embedded?: boolean;
  onCollapse?: () => void;
}): ReactElement {
  const data = record(widget.data),
    observation = record(data.observation),
    config = record(data.config);
  const capabilities = record(observation.capabilities);
  const { busy, error, request, invoke } = useMusicRequest(widget);
  const [clock, setClock] = useState(Date.now);
  const now = Math.max(clock, Date.now());
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState("lyrics");
  const tabsId = useId();
  const tabItems = [
    { value: "lyrics", label: "가사", content: null },
    { value: "info", label: "곡 정보", content: null },
    ...(capabilities.playlists === true
      ? [{ value: "playlists", label: "플레이리스트", content: null }]
      : []),
    ...(capabilities.queue === true ? [{ value: "queue", label: "재생 대기열", content: null }] : []),
  ];
  const detailScroll = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menu = useRef<HTMLDivElement>(null);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!menuOpen) return;
    menu.current?.querySelector<HTMLButtonElement>("[role='menuitem']:not(:disabled)")?.focus();
    function dismiss(event: PointerEvent): void {
      if (event.target instanceof Node && !menu.current?.contains(event.target)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [menuOpen]);
  function closeMenu(): void {
    setMenuOpen(false);
    menuTrigger.current?.focus();
  }
  useEffect(() => {
    if (detailScroll.current) {
      detailScroll.current.scrollTop = 0;
    }
  }, [tab]);
  useEffect(() => {
    if (
      (tab === "playlists" && capabilities.playlists !== true) ||
      (tab === "queue" && capabilities.queue !== true)
    )
      setTab("lyrics");
  }, [tab, capabilities.playlists, capabilities.queue]);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  const fresh = musicIsFresh(data, now);
  const can = (action: string): boolean => fresh && capabilities[action] === true && !busy;
  const title = text(observation.title),
    artist = text(observation.artist),
    album = text(observation.album);
  const identity = `${text(observation.provider)}:${text(observation.trackId) || `${title}:${artist}:${album}`}`;
  const position = musicPosition(observation, now, fresh),
    duration = finiteNumber(observation.durationMs);
  const playing = observation.playing === true;
  let state = playing ? "재생 중" : "일시정지";
  if (!title) state = observation.running === true ? "재생 대기" : "앱이 닫혀 있어요";
  if (!fresh && data.observation) state = "이전 정보";
  async function expand(value: boolean, selectedTab = tab): Promise<void> {
    if (
      !embedded &&
      isDesktop() &&
      !(await invoke<void>("set_music_expanded", { id: widget.id, expanded: value }))
    )
      return;
    setTab(selectedTab);
    setExpanded(value);
  }
  if (data.configured !== true)
    return (
      <div className={s.empty}>
        <h2>음악과 함께</h2>
        <p>설정창의 위젯에서 음악 앱을 연결해 주세요.</p>
        <p className={c.quiet}>곡 정보만 읽어요. 재생과 음량은 음악 앱에서 바꿔요.</p>
        <Button
          variant="ghost"
          disabled={busy}
          onClick={() => void invoke<void>("open_planner_settings", { kind: "music" })}
        >
          음악 설정 열기
        </Button>
        {error && (
          <p role="alert" className={c.error}>
            {error}
          </p>
        )}
      </div>
    );
  return (
    <div className={s.root} data-expanded={expanded}>
      <header className={s.fixed} aria-label="현재 곡 정보">
        <div className={s.primary}>
          <MusicWidget
            style={{ width: "100%" }}
            title={title || "지금은 조용한 시간"}
            onCollapse={onCollapse}
            artist={artist}
            album={album}
            labels={{
              heading: "음악 정보",
              progress: "음악 재생 위치",
              discuss: "이 곡 이야기하기",
              openPlayer: `${text(observation.source).replace(/\s*·.*$/, "") || "음악 앱"} 열기`,
              openPlayerAccessible: "음악 앱 열기",
              share: "친구들이 이 곡 이야기하기",
              shareDescription: "곡 제목과 아티스트만 대화에 써요",
              disclaimer: "곡 정보만 읽어요. 재생과 음량은 그 앱에서 바꿔요.",
              settings: "음악 정보 설정",
            }}
            onSettings={() => void invoke<void>("open_planner_settings", { kind: "music" })}
            showArtwork={config.showArtwork !== false}
            artwork={
              config.showArtwork !== false ? (
                <Artwork key={identity} url={artworkUrl(observation.artworkUrl)} title={title} />
              ) : undefined
            }
            elapsed={musicTime(position)}
            duration={musicTime(duration)}
            progress={
              duration && position !== null ? Math.min(1, Math.max(0, position / duration)) : 0
            }
            source={[text(observation.source), state].filter(Boolean).join(" · ")}
            busy={busy}
            shareEnabled={config.allowTalk !== false}
            onShareChange={(allowTalk) =>
              void invoke<void>("configure_connection_widget", {
                id: widget.id,
                input: { ...config, allowTalk },
              })
            }
            onDiscuss={
              fresh && title
                ? () =>
                    void invoke<void>("discuss_music_widget", {
                      id: widget.id,
                      expectedRevision: widget.revision,
                    })
                : undefined
            }
            onOpenPlayer={
              ["music", "spotify", "spicetify"].includes(
                text(observation.provider) || text(config.provider),
              )
                ? () => void request("open")
                : undefined
            }
          />
          <div ref={menu} className={s.moreMenu} data-collapse={Boolean(onCollapse) || undefined}>
            <IconButton
              ref={menuTrigger}
              icon="more"
              size="compact"
              aria-label="음악 상세 메뉴"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              disabled={busy}
              onClick={() => setMenuOpen((open) => !open)}
            />
            {menuOpen && (
              <ContextMenu
                className={s.morePanel}
                label="음악 상세와 조회"
                actions={[
                  { id: "lyrics", label: "가사", disabled: busy },
                  { id: "info", label: "곡 정보", disabled: busy },
                  ...(capabilities.playlists === true
                    ? [{ id: "playlists", label: "플레이리스트", disabled: busy }]
                    : []),
                  ...(capabilities.queue === true
                    ? [{ id: "queue", label: "재생 대기열", disabled: busy }]
                    : []),
                  { id: "refresh", label: "다시 조회", disabled: busy, separatorBefore: true },
                ]}
                onAction={(action) => {
                  closeMenu();
                  if (action === "refresh")
                    void invoke<void>("refresh_connection_widget", { id: widget.id });
                  else void expand(true, action);
                }}
                onDismiss={closeMenu}
              />
            )}
          </div>
        </div>
        {(error || text(data.error)) && (
          <p role="alert" className={c.error}>
            {error || text(data.error)}
          </p>
        )}
        {!fresh && data.observation && (
          <p role="status" className={s.notice}>
            현재 상태를 확인하지 못했어요. 마지막으로 조회한 곡 정보를 보여 드려요.
          </p>
        )}
        {!data.observation && (
          <p className={s.notice}>음악 앱에서 곡을 선택한 뒤 정보를 조회해 주세요.</p>
        )}
      </header>
      {expanded ? (
        <div className={s.tabs}>
          <div className={s.tabHeading}>
            <Tabs
              label="음악 상세 보기"
              className={s.tabList}
              items={tabItems}
              value={tab}
              onValueChange={setTab}
              externalPanels={externalTabPanels(tabsId, tabItems.map((item) => item.value))}
            />
            <Button
              size="small"
              variant="ghost"
              aria-label="상세 접기"
              disabled={busy}
              onClick={() => void expand(false)}
            >
              접기
            </Button>
          </div>
          <div
            ref={detailScroll}
            className={s.scrollBody}
            role="region"
            aria-label="음악 상세 내용"
            tabIndex={0}
          >
            <TabPanel tabs={tabsId} value="lyrics" selected={tab}>
              <section className={s.lyrics} aria-label="가사">
                {config.showLyrics === false ? (
                  <p className={s.empty}>가사 표시를 꺼 두었어요.</p>
                ) : text(observation.lyrics) ? (
                  <>
                    <p className={c.quiet}>음악 앱이 제공한 가사</p>
                    <p className={s.lyricsText} key={identity}>
                      {text(observation.lyrics)}
                    </p>
                  </>
                ) : (
                  <div className={s.empty}>
                    <h3>이 곡은 가사가 없어요</h3>
                    <p>연결한 음악 앱에서 가사를 제공하지 않았어요.</p>
                  </div>
                )}
              </section>
            </TabPanel>
            <TabPanel tabs={tabsId} value="info" selected={tab}>
              <SongInformation
                observation={observation}
                hideMissing={config.hideMissing !== false}
              />
            </TabPanel>
            {capabilities.playlists === true && (
              <TabPanel tabs={tabsId} value="playlists" selected={tab}>
                <MusicLibrary
                  key={`${text(config.provider)}:playlists`}
                  mode="playlists"
                  can={can}
                  busy={busy}
                  request={request}
                />
              </TabPanel>
            )}
            {capabilities.queue === true && (
              <TabPanel tabs={tabsId} value="queue" selected={tab}>
                <MusicLibrary
                  key={`${text(config.provider)}:queue`}
                  mode="queue"
                  can={can}
                  busy={busy}
                  request={request}
                />
              </TabPanel>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
