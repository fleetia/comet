import { Button } from "@fleetia/lagrange";
import { useState, type ReactElement } from "react";
import { record, rows, text, type DataRecord } from "../toolData";
import type { WidgetValue } from "../types";
import { finiteNumber } from "./musicData";
import * as c from "../../lagrange.css";
import * as s from "./musicTool.css";

type Props = {
  mode: "playlists" | "queue";
  can: (action: string) => boolean;
  busy: boolean;
  request: (action: string, value?: WidgetValue) => Promise<WidgetValue | undefined>;
};

export function MusicLibrary({ mode, can, busy, request }: Props): ReactElement {
  const [items, setItems] = useState<DataRecord[] | null>(null);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [selected, setSelected] = useState<DataRecord | null>(null);
  const [tracks, setTracks] = useState<DataRecord[] | null>(null);
  const [trackOffset, setTrackOffset] = useState<number | null>(null);
  async function load(offset = 0): Promise<void> {
    const response = await request(mode, mode === "queue" ? null : { offset });
    if (response === undefined) return;
    const data = record(response);
    setItems((previous) =>
      offset === 0 ? rows(data.items) : [...(previous ?? []), ...rows(data.items)],
    );
    setNextOffset(finiteNumber(data.nextOffset));
  }
  async function select(playlist: DataRecord, offset = 0): Promise<void> {
    const response = await request("playlistTracks", { uri: text(playlist.uri), offset });
    if (response === undefined) return;
    const data = record(response);
    setSelected(playlist);
    setTracks((previous) =>
      offset === 0 ? rows(data.items) : [...(previous ?? []), ...rows(data.items)],
    );
    setTrackOffset(finiteNumber(data.nextOffset));
  }
  if (selected) {
    return (
      <section className={s.library} aria-label="플레이리스트 곡">
        <div className={s.libraryHeading}>
          <Button
            variant="quiet"
            size="compact"
            onClick={() => {
              setSelected(null);
              setTracks(null);
            }}
          >
            ← 플레이리스트
          </Button>
          <Button
            variant="primary"
            size="compact"
            disabled={busy || !can("playRandom")}
            onClick={() => void request("playRandom", { uri: text(selected.uri) })}
          >
            랜덤 한 곡 재생
          </Button>
        </div>
        <h3>{text(selected.title) || text(selected.name)}</h3>
        {tracks?.length === 0 && <p className={s.empty}>재생할 수 있는 곡이 없어요.</p>}
        <ol className={s.trackList}>
          {tracks?.map((item, index) => (
            <li className={s.trackRow} key={`${text(item.uri)}-${index}`}>
              <div className={s.trackSummary}>
                <strong>{text(item.title) || text(item.name) || "제목 정보 없음"}</strong>
                <span className={c.quiet}>{text(item.artist) || text(item.album)}</span>
              </div>
              <Button
                size="compact"
                variant="quiet"
                disabled={busy || !can("playUri")}
                aria-label={`${text(item.title) || text(item.name)} 재생`}
                onClick={() => void request("playUri", { uri: text(item.uri) })}
              >
                재생
              </Button>
              {can("enqueue") && (
                <Button
                  size="compact"
                  variant="quiet"
                  disabled={busy}
                  aria-label={`${text(item.title) || text(item.name)} 큐에 추가`}
                  onClick={() => void request("enqueue", { uri: text(item.uri) })}
                >
                  + 큐
                </Button>
              )}
            </li>
          ))}
        </ol>
        {trackOffset !== null && (
          <Button
            variant="secondary"
            disabled={busy || !can("playlistTracks")}
            onClick={() => void select(selected, trackOffset)}
          >
            곡 더 보기
          </Button>
        )}
      </section>
    );
  }
  return (
    <section
      className={s.library}
      aria-label={mode === "playlists" ? "내 플레이리스트" : "재생 대기열"}
    >
      <div className={s.libraryHeading}>
        <h3>{mode === "playlists" ? "내 플레이리스트" : "다음에 재생"}</h3>
        <Button
          variant="quiet"
          size="compact"
          disabled={busy || !can(mode)}
          onClick={() => void load()}
        >
          {items ? "새로고침" : "불러오기"}
        </Button>
      </div>
      {items === null && (
        <p className={s.empty}>
          {mode === "playlists"
            ? "Spotify의 플레이리스트를 불러와 원하는 목록에서 한 곡을 골라요."
            : "Spotify의 현재 재생 대기열을 불러옵니다."}
        </p>
      )}
      {items?.length === 0 && (
        <p className={s.empty}>
          {mode === "playlists" ? "플레이리스트가 없어요." : "재생 대기열이 비어 있어요."}
        </p>
      )}
      <ol className={s.trackList}>
        {items?.map((item, index) => (
          <li className={s.trackRow} key={`${text(item.uri)}-${index}`}>
            <div className={s.trackSummary}>
              <strong>{text(item.title) || text(item.name) || "제목 정보 없음"}</strong>
              <span className={c.quiet}>{text(item.artist) || text(item.description)}</span>
            </div>
            {mode === "playlists" ? (
              <>
                <Button
                  variant="quiet"
                  size="compact"
                  disabled={busy || !can("playlistTracks")}
                  onClick={() => void select(item)}
                >
                  곡 보기
                </Button>
                <Button
                  variant="secondary"
                  size="compact"
                  disabled={busy || !can("playRandom")}
                  aria-label={`${text(item.title) || text(item.name)}에서 랜덤 한 곡 재생`}
                  onClick={() => void request("playRandom", { uri: text(item.uri) })}
                >
                  랜덤 재생
                </Button>
              </>
            ) : (
              <Button
                variant="quiet"
                size="compact"
                disabled={busy || !can("playUri")}
                aria-label={`${text(item.title) || text(item.name)} 재생`}
                onClick={() => void request("playUri", { uri: text(item.uri) })}
              >
                재생
              </Button>
            )}
          </li>
        ))}
      </ol>
      {nextOffset !== null && (
        <Button
          variant="secondary"
          disabled={busy || !can(mode)}
          onClick={() => void load(nextOffset)}
        >
          더 보기
        </Button>
      )}
    </section>
  );
}
