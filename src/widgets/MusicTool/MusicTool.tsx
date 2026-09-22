import { Button, Tab, TabList, TabPanel, Tabs } from "@fleetia/lagrange";
import { useEffect, useState, type ReactElement } from "react";
import { isDesktop } from "../../hooks/useSnapshot";
import { record, text, type DataRecord } from "../toolData";
import type { WidgetValue, WidgetView } from "../types";
import { MusicLibrary } from "./MusicLibrary";
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
import * as c from "../../lagrange.css";
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
      <span aria-hidden="true">♫</span>
    </div>
  );
}

function RangeControl({
  label,
  value,
  max,
  disabled,
  format,
  onCommit,
}: {
  label: string;
  value: number;
  max: number;
  disabled: boolean;
  format?: string;
  onCommit: (value: number) => void;
}): ReactElement {
  const [draft, setDraft] = useState<number | null>(null);
  function commit(): void {
    if (draft !== null && !disabled) onCommit(draft);
    setDraft(null);
  }
  return (
    <input
      className={s.range}
      type="range"
      aria-label={label}
      aria-valuetext={format}
      min={0}
      max={Math.max(1, max)}
      value={draft ?? Math.min(max, Math.max(0, value))}
      disabled={disabled}
      onChange={(event) => setDraft(Number(event.target.value))}
      onPointerUp={commit}
      onPointerCancel={() => setDraft(null)}
      onKeyUp={(event) => {
        if (
          [
            "ArrowLeft",
            "ArrowRight",
            "ArrowUp",
            "ArrowDown",
            "Home",
            "End",
            "PageUp",
            "PageDown",
          ].includes(event.key)
        )
          commit();
      }}
      onBlur={commit}
    />
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

export function MusicTool({ widget }: { widget: WidgetView }): ReactElement {
  const data = record(widget.data),
    observation = record(data.observation),
    config = record(data.config);
  const capabilities = record(observation.capabilities);
  const { busy, error, request, invoke } = useMusicRequest(widget);
  const [clock, setClock] = useState(Date.now);
  const now = Math.max(clock, Date.now());
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState("lyrics");
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
  const repeatModes = observation.provider === "spotify" ? ["off", "all"] : ["off", "all", "one"];
  const nextRepeat =
    repeatModes[(repeatModes.indexOf(text(observation.repeat)) + 1) % repeatModes.length];
  let state = playing ? "재생 중" : "일시정지";
  if (!title) state = observation.running === true ? "재생 대기" : "앱이 닫혀 있어요";
  if (!fresh && data.observation) state = "이전 정보";
  async function expand(value: boolean, selectedTab = tab): Promise<void> {
    if (
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
        <p className={c.quiet}>현재 곡을 보고 이 위젯에서 재생을 제어할 수 있어요.</p>
      </div>
    );
  return (
    <div className={s.root} data-expanded={expanded}>
      <header className={s.fixed} aria-label="현재 곡과 재생 제어">
        <div className={s.hero}>
          {config.showArtwork !== false && (
            <Artwork key={identity} url={artworkUrl(observation.artworkUrl)} title={title} />
          )}
          <div className={s.summary}>
            <p className={s.source}>
              <span aria-hidden="true">▪ </span>
              {state}
              {text(observation.source) && ` · ${text(observation.source)}`}
            </p>
            <h2 className={s.title}>{title || "지금은 조용한 시간"}</h2>
            {(artist || album) && (
              <p className={s.artist}>{[artist, album].filter(Boolean).join(" · ")}</p>
            )}
            <div className={s.timeline}>
              <RangeControl
                key={`${identity}:seek`}
                label="재생 위치"
                value={position ?? 0}
                max={duration ?? 0}
                disabled={!can("seek") || duration === null || position === null}
                format={`${musicTime(position)} / ${musicTime(duration)}`}
                onCommit={(value) => void request("seek", value)}
              />
              <div className={s.time}>
                <span>{musicTime(position)}</span>
                <span>{musicTime(duration)}</span>
              </div>
            </div>
          </div>
        </div>
        <div className={s.controls} aria-label="재생 제어">
          <div className={s.transport}>
            <Button
              variant="quiet"
              size="compact"
              aria-label="이전 곡"
              disabled={!can("previous")}
              onClick={() => void request("previous")}
            >
              이전
            </Button>
            <Button
              variant="primary"
              size="compact"
              aria-label={playing ? "일시정지" : "재생"}
              disabled={!can(playing ? "pause" : "play")}
              onClick={() => void request(playing ? "pause" : "play")}
            >
              {playing ? "일시정지" : "재생"}
            </Button>
            <Button
              variant="quiet"
              size="compact"
              aria-label="다음 곡"
              disabled={!can("next")}
              onClick={() => void request("next")}
            >
              다음
            </Button>
          </div>
          <div className={s.secondaryControls}>
            {capabilities.shuffle === true && (
              <Button
                variant="quiet"
                size="compact"
                aria-pressed={observation.shuffle === true}
                disabled={!can("shuffle")}
                onClick={() => void request("shuffle", observation.shuffle !== true)}
              >
                셔플
              </Button>
            )}
            {capabilities.repeat === true && (
              <Button
                variant="quiet"
                size="compact"
                aria-label={`반복: ${{ off: "끔", all: "전체", one: "한 곡" }[text(observation.repeat)] ?? "끔"}`}
                aria-pressed={observation.repeat !== "off" && !!observation.repeat}
                disabled={!can("repeat")}
                onClick={() => void request("repeat", nextRepeat)}
              >
                {observation.repeat === "one" ? "한 곡 반복" : "반복"}
              </Button>
            )}
            {capabilities.like === true && (
              <Button
                variant="quiet"
                size="compact"
                aria-label={observation.liked === true ? "좋아요 취소" : "좋아요"}
                aria-pressed={observation.liked === true}
                disabled={!can("like") || !text(observation.trackId)}
                onClick={() =>
                  void request("like", {
                    uri: text(observation.trackId),
                    liked: observation.liked !== true,
                  })
                }
              >
                {observation.liked === true ? "♥" : "♡"}
              </Button>
            )}
            {capabilities.volume === true && (
              <label className={s.volume}>
                <span>음량</span>
                <RangeControl
                  key={`${identity}:volume`}
                  label="음량"
                  value={finiteNumber(observation.volume) ?? 0}
                  max={100}
                  disabled={!can("volume") || finiteNumber(observation.volume) === null}
                  format={`${finiteNumber(observation.volume) ?? 0}%`}
                  onCommit={(value) => void request("volume", value)}
                />
              </label>
            )}
          </div>
        </div>
        {(error || text(data.error)) && (
          <p role="alert" className={s.notice}>
            {error || text(data.error)}
          </p>
        )}
        {!fresh && data.observation && (
          <p role="status" className={s.notice}>
            현재 상태를 확인하지 못했어요. 다시 조회하면 제어할 수 있어요.
          </p>
        )}
        {!data.observation && (
          <p className={s.notice}>음악 앱에서 곡을 선택한 뒤 정보를 조회해 주세요.</p>
        )}
      </header>
      {expanded ? (
        <Tabs className={s.tabs} value={tab} onValueChange={setTab}>
          <div className={s.tabHeading}>
            <TabList aria-label="음악 상세 보기" className={s.tabList}>
              <Tab value="lyrics">가사</Tab>
              <Tab value="info">곡 정보</Tab>
              {capabilities.playlists === true && <Tab value="playlists">플레이리스트</Tab>}
              {capabilities.queue === true && <Tab value="queue">재생 대기열</Tab>}
            </TabList>
            <Button
              size="compact"
              variant="quiet"
              aria-label="상세 접기"
              disabled={busy}
              onClick={() => void expand(false)}
            >
              접기
            </Button>
          </div>
          <div className={s.scrollBody}>
            <TabPanel value="lyrics">
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
            <TabPanel value="info">
              <SongInformation
                observation={observation}
                hideMissing={config.hideMissing !== false}
              />
            </TabPanel>
            {capabilities.playlists === true && (
              <TabPanel value="playlists">
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
              <TabPanel value="queue">
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
        </Tabs>
      ) : (
        <nav className={s.compactLinks} aria-label="음악 상세 보기">
          <Button
            variant="quiet"
            size="compact"
            disabled={busy}
            onClick={() => void expand(true, "lyrics")}
          >
            가사
          </Button>
          <Button
            variant="quiet"
            size="compact"
            disabled={busy}
            onClick={() => void expand(true, "info")}
          >
            곡 정보
          </Button>
          {capabilities.playlists === true && (
            <Button
              variant="quiet"
              size="compact"
              disabled={busy}
              onClick={() => void expand(true, "playlists")}
            >
              플레이리스트
            </Button>
          )}
        </nav>
      )}
      <footer className={s.footer}>
        <span className={c.quiet}>{fresh ? "로컬 연결" : "연결 확인 필요"}</span>
        <Button
          variant="quiet"
          size="compact"
          disabled={busy}
          onClick={() => void invoke<void>("refresh_connection_widget", { id: widget.id })}
        >
          {busy ? "처리 중…" : "다시 조회"}
        </Button>
      </footer>
    </div>
  );
}
