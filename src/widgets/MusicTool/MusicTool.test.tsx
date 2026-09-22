import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { command } from "../../hooks/useSnapshot";
import type { WidgetValue, WidgetView } from "../types";
import { MusicTool } from "./MusicTool";
import { MusicSettings } from "./MusicSettings";

vi.mock("../../hooks/useSnapshot", async (load) => ({
  ...(await load<typeof import("../../hooks/useSnapshot")>()),
  command: vi.fn(),
  isDesktop: () => true,
}));
const NOW = 1_800_000_000_000;
function widget(
  observation: Record<string, WidgetValue> = {},
  config: Record<string, WidgetValue> = {},
): WidgetView {
  return {
    id: "music",
    kind: "music",
    installed: true,
    enabled: true,
    revision: 7,
    version: 1,
    error: null,
    status: "enabled",
    missing: [],
    packageBytes: 0,
    data: {
      configured: true,
      status: "ready",
      config: { provider: "music", ...config },
      observation: {
        running: true,
        playing: true,
        provider: "music",
        source: "Apple Music",
        title: "밤의 산책",
        artist: "별빛정원",
        album: "조용한 궤도",
        trackId: "track-a",
        observedAt: NOW,
        positionMs: 120_000,
        durationMs: 240_000,
        volume: 50,
        shuffle: false,
        repeat: "off",
        lyrics: "천천히 걷는 밤의 길\n작은 별 하나 곁에 두어요",
        capabilities: { pause: true, play: true, seek: true, next: true },
        ...observation,
      },
    },
  };
}
beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("opens lyrics first and keeps the same song header and controls while switching tabs", async () => {
  render(<MusicTool widget={widget()} />);
  const header = screen.getByRole("banner", { name: "현재 곡과 재생 제어" });
  expect(command).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "가사" }));
  await screen.findByRole("tab", { name: "가사", selected: true });
  expect(command).toHaveBeenCalledWith("set_music_expanded", { id: "music", expanded: true });
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["가사", "곡 정보"]);
  expect(screen.getByText(/천천히 걷는 밤의 길/)).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "곡 정보" }));
  expect(screen.getByRole("banner", { name: "현재 곡과 재생 제어" })).toBe(header);
  expect(within(header).getByRole("button", { name: "일시정지" })).toBeTruthy();
  expect(screen.getByRole("tabpanel").textContent).toContain("조용한 궤도");
});

it("sends one revision-bound command and never offers unsupported volume or shuffle controls", async () => {
  render(<MusicTool widget={widget()} />);
  expect(screen.getByRole("button", { name: "이전 곡" })).toHaveProperty("disabled", true);
  expect(screen.queryByRole("slider", { name: "음량" })).toBeNull();
  expect(screen.queryByRole("button", { name: "셔플" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "일시정지" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("music_request", {
      id: "music",
      expectedRevision: 7,
      action: "pause",
      value: null,
    }),
  );
  expect(command).toHaveBeenCalledTimes(1);
});

it("shows the observed playback details, false and zero metadata, and optional missing fields", async () => {
  vi.mocked(Date.now).mockReturnValue(NOW + 8_000);
  const observation = {
    playbackState: "paused",
    playing: false,
    volume: 0,
    shuffle: false,
    liked: false,
    repeat: "one",
    contextUri: "spotify:playlist:evening",
    metadata: { albumArtist: "별빛정원", contentType: "track", playbackRate: 1, explicit: false },
  };
  const view = render(<MusicTool widget={widget(observation)} />);
  fireEvent.click(screen.getByRole("button", { name: "곡 정보" }));
  const panel = within(await screen.findByRole("tabpanel"));
  expect(panel.getByText("마지막 조회 위치").nextElementSibling?.textContent).toBe("2:00");
  expect(panel.getByText("재생 상태").nextElementSibling?.textContent).toBe("일시정지");
  expect(panel.getByText("음량").nextElementSibling?.textContent).toBe("0%");
  expect(panel.getByText("셔플").nextElementSibling?.textContent).toBe("끔");
  expect(panel.getByText("반복").nextElementSibling?.textContent).toBe("한 곡");
  expect(panel.getByText("좋아요").nextElementSibling?.textContent).toBe("아니요");
  expect(panel.getByText("콘텐츠 종류").nextElementSibling?.textContent).toBe("track");
  expect(panel.getByText("재생 속도").nextElementSibling?.textContent).toBe("1");
  expect(panel.getByText("재생 목록 URI").nextElementSibling?.textContent).toBe(
    "spotify:playlist:evening",
  );
  expect(panel.getByText("마지막 조회").nextElementSibling?.textContent).toBe(
    new Date(NOW).toLocaleString(),
  );
  expect(panel.queryByText("작곡가")).toBeNull();
  view.rerender(<MusicTool widget={widget(observation, { hideMissing: false })} />);
  expect(
    within(screen.getByRole("tabpanel")).getByText("작곡가").nextElementSibling?.textContent,
  ).toBe("제공하지 않음");
});

it("blocks stale playback and does not carry a seek drag to a different song", async () => {
  const view = render(<MusicTool widget={widget()} />);
  const seek = screen.getByRole("slider", { name: "재생 위치" });
  fireEvent.change(seek, { target: { value: "150000" } });
  view.rerender(
    <MusicTool widget={widget({ trackId: "track-b", title: "다음 곡", positionMs: 0 })} />,
  );
  fireEvent.pointerUp(screen.getByRole("slider", { name: "재생 위치" }));
  expect(command).not.toHaveBeenCalled();
  view.rerender(<MusicTool widget={widget({ observedAt: NOW - 31_000 })} />);
  expect(screen.getByRole("button", { name: "일시정지" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("slider", { name: "재생 위치" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("slider", { name: "재생 위치" })).toHaveProperty("value", "120000");
  expect(screen.getByRole("status").textContent).toContain("현재 상태를 확인하지 못했어요");
});

it("preserves paused song details and rejects executable or local artwork URLs", () => {
  const view = render(
    <MusicTool widget={widget({ playing: false, artworkUrl: "file:///private/music.jpg" })} />,
  );
  expect(screen.getByRole("heading", { name: "밤의 산책" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "재생" })).toBeTruthy();
  expect(screen.queryByRole("img")).toBeNull();
  view.rerender(
    <MusicTool widget={widget({ artworkUrl: "data:image/svg+xml,<svg onload='alert(1)'/>" })} />,
  );
  expect(screen.queryByRole("img")).toBeNull();
  view.rerender(<MusicTool widget={widget({ artworkUrl: "https://i.scdn.co/image/cover" })} />);
  expect(screen.getByRole("img")).toHaveProperty("src", "https://i.scdn.co/image/cover");
});

it("loads playlists on request and sends their URI for random playback", async () => {
  const capabilities = { playlists: true, playlistTracks: true, playRandom: true, queue: true };
  vi.mocked(command).mockImplementation(async (name) =>
    name === "music_request"
      ? { items: [{ uri: "spotify:playlist:abc", title: "조용한 저녁" }], nextOffset: null }
      : null,
  );
  render(
    <MusicTool
      widget={widget({ provider: "spicetify", capabilities }, { provider: "spicetify" })}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "플레이리스트" }));
  fireEvent.click(await screen.findByRole("button", { name: "불러오기" }));
  fireEvent.click(await screen.findByRole("button", { name: "조용한 저녁에서 랜덤 한 곡 재생" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("music_request", {
      id: "music",
      expectedRevision: 7,
      action: "playRandom",
      value: { uri: "spotify:playlist:abc" },
    }),
  );
});

it("requests the playback queue without a playlist pagination argument", async () => {
  vi.mocked(command).mockImplementation(async (name) =>
    name === "music_request" ? { items: [] } : null,
  );
  render(
    <MusicTool widget={widget({ capabilities: { queue: true } }, { provider: "spicetify" })} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "가사" }));
  fireEvent.click(await screen.findByRole("tab", { name: "재생 대기열" }));
  fireEvent.click(screen.getByRole("button", { name: "불러오기" }));
  await screen.findByText("재생 대기열이 비어 있어요.");
  expect(command).toHaveBeenCalledWith("music_request", {
    id: "music",
    expectedRevision: 7,
    action: "queue",
    value: null,
  });
});

it("ignores a playlist response received after the connection settings change", async () => {
  let resolve: (value: unknown) => void = () => {};
  const capabilities = { playlists: true, playlistTracks: true, playRandom: true };
  vi.mocked(command).mockImplementation(async (name) =>
    name === "music_request"
      ? new Promise((done) => {
          resolve = done;
        })
      : null,
  );
  const view = render(<MusicTool widget={widget({ capabilities }, { provider: "spicetify" })} />);
  fireEvent.click(screen.getByRole("button", { name: "플레이리스트" }));
  fireEvent.click(await screen.findByRole("button", { name: "불러오기" }));
  view.rerender(
    <MusicTool widget={widget({ capabilities }, { provider: "spicetify", allowTalk: false })} />,
  );
  resolve({ items: [{ uri: "spotify:playlist:old", title: "이전 연결의 목록" }] });
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "불러오기" })).toHaveProperty("disabled", false),
  );
  expect(screen.queryByText("이전 연결의 목록")).toBeNull();
});

it("asks for consent before configuring the chosen app and preserves a failed draft", async () => {
  vi.mocked(command).mockRejectedValue(new Error("설정을 저장하지 못했어요."));
  render(<MusicSettings widget={{ ...widget(), data: { configured: false, config: {} } }} />);
  expect(command).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("음악 앱"), { target: { value: "spotify" } });
  fireEvent.click(screen.getByRole("button", { name: "곡 정보 조회·재생 제어 허용하고 연결" }));
  await screen.findByRole("alert");
  expect(command).toHaveBeenCalledWith("configure_connection_widget", {
    id: "music",
    input: {
      provider: "spotify",
      allowedProviders: ["music", "spotify"],
      showArtwork: true,
      showLyrics: true,
      hideMissing: true,
      allowTalk: true,
    },
  });
  expect(screen.getByLabelText("음악 앱")).toHaveProperty("value", "spotify");
});

it("lets a remembered Spotify connection be forgotten while awaiting automatic reconnection", async () => {
  vi.mocked(command).mockImplementation(async (name) =>
    name === "music_bridge_status"
      ? { connected: false, remembered: true, pairing: false, enabled: true, port: 18743 }
      : null,
  );
  render(<MusicSettings widget={widget({}, { provider: "spicetify" })} />);
  await screen.findByText("Spotify 확장의 자동 재연결을 기다리고 있어요.");
  expect(screen.getByRole("button", { name: "연결 코드 만들기" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "로컬 연결 해제" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("music_bridge_disconnect", {
      id: "music",
      expectedRevision: 7,
    }),
  );
  await waitFor(() => expect(screen.queryByRole("button", { name: "로컬 연결 해제" })).toBeNull());
  expect(screen.getByText("Spotify 확장 연결을 기다리고 있어요.")).toBeTruthy();
});
