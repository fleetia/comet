import { record, text, type DataRecord } from "../toolData";
import type { WidgetValue } from "../types";

export const MUSIC_FRESHNESS_MS = 30_000;

export function finiteNumber(value: WidgetValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function musicIsFresh(data: DataRecord, now: number): boolean {
  const observation = record(data.observation);
  const observedAt = finiteNumber(observation.observedAt);
  return (
    (data.status === "ready" || data.status === "syncing") &&
    observedAt !== null &&
    now >= observedAt &&
    now - observedAt <= MUSIC_FRESHNESS_MS
  );
}

export function musicTime(value: number | null): string {
  if (value === null || value < 0) return "—:—";
  const seconds = Math.floor(value / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function artworkUrl(value: WidgetValue | undefined): string | null {
  const candidate = text(value);
  if (candidate.length > 750_000) return null;
  if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(candidate)) return candidate;
  try {
    const url = new URL(candidate);
    const trustedHost = ["scdn.co", "spotifycdn.com", "mzstatic.com"].some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
    if (url.protocol === "https:" && trustedHost && !url.username && !url.password && !url.port)
      return url.href;
  } catch {
    return null;
  }
  return null;
}

export function musicPosition(observation: DataRecord, now: number, fresh: boolean): number | null {
  const position = finiteNumber(observation.positionMs);
  if (position === null) return null;
  const observedAt = finiteNumber(observation.observedAt);
  const elapsed =
    fresh && observation.playing === true && observedAt !== null
      ? Math.max(0, now - observedAt)
      : 0;
  const duration = finiteNumber(observation.durationMs);
  return Math.max(0, Math.min(duration ?? Infinity, position + elapsed));
}

export const MUSIC_METADATA_LABELS: Record<string, string> = {
  albumArtist: "앨범 아티스트",
  composer: "작곡가",
  genre: "장르",
  year: "발매 연도",
  trackNumber: "트랙 번호",
  discNumber: "디스크 번호",
  trackCount: "전체 트랙 수",
  discCount: "전체 디스크 수",
  durationMs: "재생 시간",
  bitrate: "비트레이트",
  bitRate: "비트레이트",
  sampleRate: "샘플 레이트",
  playCount: "재생 횟수",
  playedCount: "재생 횟수",
  rating: "평점",
  popularity: "인기도",
  comment: "메모",
  compilation: "컴필레이션",
  releaseDate: "발매일",
  dateAdded: "추가한 날짜",
  kind: "파일 종류",
  contentType: "콘텐츠 종류",
  playbackRate: "재생 속도",
  grouping: "그룹",
  bpm: "BPM",
  loved: "좋아요",
  starred: "즐겨찾기",
  favorited: "즐겨찾기",
  work: "작품",
  movement: "악장",
  movementNumber: "악장 번호",
  movementCount: "전체 악장 수",
  description: "설명",
  playedDate: "마지막 재생",
  mute: "음소거",
  shuffleMode: "셔플 범위",
  explicit: "명시적 콘텐츠",
  spotifyUrl: "Spotify 주소",
  url: "주소",
};

export function metadataText(value: WidgetValue | undefined): string {
  if (typeof value === "boolean") return value ? "예" : "아니요";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "제공하지 않음";
  if (typeof value === "string" && value.trim()) return value;
  return "제공하지 않음";
}
