// @vitest-environment jsdom
// happy-dom does not disable controls inside a disabled fieldset.
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
    reaction: true,
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
  vi.spyOn(navigator, "platform", "get").mockReturnValue("MacIntel");
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  vi.mocked(command).mockReset();
  vi.mocked(command).mockResolvedValue(null);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("opens lyrics first and keeps the same read-only song header while switching tabs", async () => {
  render(<MusicTool widget={widget()} />);
  const header = screen.getByRole("banner", { name: "현재 곡 정보" });
  expect(command).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "음악 상세 메뉴" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "가사" }));
  await screen.findByRole("tab", { name: "가사", selected: true });
  expect(command).toHaveBeenCalledWith("set_music_expanded", { id: "music", expanded: true });
  expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual(["가사", "곡 정보"]);
  expect(screen.getByText(/천천히 걷는 밤의 길/)).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "곡 정보" }));
  expect(screen.getByRole("banner", { name: "현재 곡 정보" })).toBe(header);
  expect(within(header).getByRole("progressbar", { name: "음악 재생 위치" })).toBeTruthy();
  expect(screen.getByRole("tabpanel").textContent).toContain("조용한 궤도");
});

it("starts each detail tab at the top after scrolling another tab", async () => {
  render(<MusicTool widget={widget()} />);
  fireEvent.click(screen.getByRole("button", { name: "음악 상세 메뉴" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "가사" }));
  const detail = await screen.findByRole("region", { name: "음악 상세 내용" });
  detail.scrollTop = 180;
  fireEvent.click(screen.getByRole("tab", { name: "곡 정보" }));
  expect(detail.scrollTop).toBe(0);
  detail.scrollTop = 120;
  fireEvent.click(screen.getByRole("tab", { name: "가사" }));
  expect(detail.scrollTop).toBe(0);
});

it("never exposes playback mutations even when the connected app supports them", () => {
  render(
    <MusicTool
      widget={widget({
        capabilities: {
          play: true,
          pause: true,
          previous: true,
          next: true,
          seek: true,
          volume: true,
          shuffle: true,
          repeat: true,
          like: true,
        },
      })}
    />,
  );
  expect(screen.queryByRole("slider")).toBeNull();
  for (const name of ["이전 곡", "다음 곡", "재생", "일시정지", "셔플", /반복/, /좋아요/]) {
    expect(screen.queryByRole("button", { name })).toBeNull();
  }
  expect(screen.getByRole("progressbar", { name: "음악 재생 위치" })).toHaveProperty("value", 0.5);
  expect(command).not.toHaveBeenCalled();
});

it("opens only the selected music app and prepares a song discussion without submitting a message", async () => {
  render(<MusicTool widget={widget()} />);
  fireEvent.click(screen.getByRole("button", { name: "음악 앱 열기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("music_request", {
      id: "music",
      expectedRevision: 7,
      action: "open",
      value: null,
    }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "이 곡 이야기하기" })).toHaveProperty(
      "disabled",
      false,
    ),
  );
  fireEvent.click(screen.getByRole("button", { name: "이 곡 이야기하기" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("discuss_music_widget", {
      id: "music",
      expectedRevision: 7,
    }),
  );
  expect(command).not.toHaveBeenCalledWith("send_message", expect.anything());
  const settings = screen.getByRole("button", { name: "음악 정보 설정" });
  await waitFor(() => expect(settings).toHaveProperty("disabled", false));
  fireEvent.click(settings);
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("open_planner_settings", { kind: "music" }),
  );
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
  fireEvent.click(screen.getByRole("button", { name: "음악 상세 메뉴" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "곡 정보" }));
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

it("keeps stale observations visibly read-only and allows an explicit refresh", async () => {
  render(<MusicTool widget={widget({ observedAt: NOW - 31_000 })} />);
  expect(screen.queryByRole("slider")).toBeNull();
  expect(screen.getByRole("progressbar", { name: "음악 재생 위치" })).toHaveProperty("value", 0.5);
  expect(screen.getByRole("status").textContent).toContain("마지막으로 조회한 곡 정보");
  fireEvent.click(screen.getByRole("button", { name: "음악 상세 메뉴" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "다시 조회" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("refresh_connection_widget", { id: "music" }),
  );
  expect(command).not.toHaveBeenCalledWith("music_request", expect.anything());
});

it("preserves paused song details and rejects executable or local artwork URLs", () => {
  const view = render(
    <MusicTool widget={widget({ playing: false, artworkUrl: "file:///private/music.jpg" })} />,
  );
  expect(screen.getByText("밤의 산책")).toBeTruthy();
  expect(screen.getByText(/Apple Music · 일시정지/)).toBeTruthy();
  expect(screen.queryByRole("button", { name: "재생" })).toBeNull();
  expect(screen.queryByRole("img")).toBeNull();
  view.rerender(
    <MusicTool widget={widget({ artworkUrl: "data:image/svg+xml,<svg onload='alert(1)'/>" })} />,
  );
  expect(screen.queryByRole("img")).toBeNull();
  view.rerender(<MusicTool widget={widget({ artworkUrl: "https://i.scdn.co/image/cover" })} />);
  expect(screen.getByRole("img")).toHaveProperty("src", "https://i.scdn.co/image/cover");
});

it("loads playlists and their tracks without offering playback or queue mutations", async () => {
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name !== "music_request") return null;
    if (args?.action === "playlists")
      return { items: [{ uri: "spotify:playlist:abc", title: "조용한 저녁" }], nextOffset: null };
    return { items: [{ uri: "spotify:track:abc", title: "저녁 노래" }], nextOffset: null };
  });
  render(
    <MusicTool
      widget={widget(
        {
          provider: "spicetify",
          capabilities: {
            playlists: true,
            playlistTracks: true,
            playRandom: true,
            playUri: true,
            enqueue: true,
            queue: true,
          },
        },
        { provider: "spicetify" },
      )}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "음악 상세 메뉴" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "플레이리스트" }));
  fireEvent.click(await screen.findByRole("button", { name: "불러오기" }));
  fireEvent.click(await screen.findByRole("button", { name: "곡 보기" }));
  await screen.findByText("저녁 노래");
  expect(command).toHaveBeenCalledWith("music_request", {
    id: "music",
    expectedRevision: 7,
    action: "playlistTracks",
    value: { uri: "spotify:playlist:abc", offset: 0 },
  });
  expect(screen.queryByRole("button", { name: /재생|큐에 추가/ })).toBeNull();
  expect(
    vi
      .mocked(command)
      .mock.calls.filter(([name]) => name === "music_request")
      .map(([, args]) => args?.action),
  ).toEqual(["playlists", "playlistTracks"]);
});

it("blocks another library query while the track query is pending", async () => {
  let finish: (value: WidgetValue) => void = () => {};
  vi.mocked(command).mockImplementation(async (name, args) => {
    if (name !== "music_request") return null;
    if (args?.action === "playlists")
      return { items: [{ uri: "spotify:playlist:qa", title: "합성 목록" }] };
    return new Promise<WidgetValue>((resolve) => {
      finish = resolve;
    });
  });
  render(
    <MusicTool
      widget={widget(
        { capabilities: { playlists: true, playlistTracks: true } },
        { provider: "spicetify" },
      )}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "음악 상세 메뉴" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "플레이리스트" }));
  fireEvent.click(await screen.findByRole("button", { name: "불러오기" }));
  const query = await screen.findByRole("button", { name: "곡 보기" });
  fireEvent.click(query);
  expect(query).toHaveProperty("disabled", true);
  finish({ items: [{ uri: "spotify:track:qa", title: "합성 곡" }] });
  await screen.findByText("합성 곡");
  expect(screen.queryByRole("button", { name: /합성 곡 재생|큐에 추가/ })).toBeNull();
});

it("requests the playback queue without a playlist pagination argument", async () => {
  vi.mocked(command).mockImplementation(async (name) =>
    name === "music_request" ? { items: [] } : null,
  );
  render(
    <MusicTool widget={widget({ capabilities: { queue: true } }, { provider: "spicetify" })} />,
  );
  fireEvent.click(screen.getByRole("button", { name: "음악 상세 메뉴" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "가사" }));
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
  fireEvent.click(screen.getByRole("button", { name: "음악 상세 메뉴" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "플레이리스트" }));
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
  fireEvent.click(screen.getByRole("button", { name: "곡 정보 읽기 허용하고 연결" }));
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
      priority: "last-played",
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

it("autosaves a configured preview preference and blocks both sides while saving", async () => {
  const side = document.createElement("aside");
  document.body.append(side);
  const onBusyChange = vi.fn();
  let finish: (value: null) => void = () => {};
  vi.mocked(command).mockImplementation(
    async () =>
      new Promise<null>((resolve) => {
        finish = resolve;
      }),
  );
  try {
    const view = render(
      <MusicSettings widget={widget()} sideContainer={side} onBusyChange={onBusyChange} />,
    );
    const artwork = within(side).getByRole("switch", { name: "앨범 아트 표시" });
    expect(within(side).queryByText("밤의 산책")).toBeNull();
    fireEvent.click(artwork);
    expect(artwork).toHaveProperty("checked", false);
    await waitFor(() =>
      expect(command).toHaveBeenCalledWith("configure_connection_widget", {
        id: "music",
        input: expect.objectContaining({ provider: "music", showArtwork: false }),
      }),
    );
    expect(artwork.matches(":disabled")).toBe(true);
    expect(screen.queryByRole("button", { name: "다시 저장" })).toBeNull();
    expect(onBusyChange).toHaveBeenLastCalledWith(true);
    finish(null);
    await waitFor(() => expect(onBusyChange).toHaveBeenLastCalledWith(false));
    view.rerender(<MusicSettings widget={widget()} sideContainer={side} disabled />);
    expect(artwork.matches(":disabled")).toBe(true);
  } finally {
    cleanup();
    side.remove();
  }
});

it.each(["Linux x86_64", "Win32"])("marks Apple Music as macOS-only on %s", (platform) => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
  render(<MusicSettings widget={{ ...widget(), data: { configured: false, config: {} } }} />);
  expect(screen.queryByRole("switch", { name: "Apple Music · macOS" })).toBeNull();
  expect(screen.getByText("macOS 전용")).toBeTruthy();
  expect(screen.getByText("macOS에서만 바로 읽을 수 있어요")).toBeTruthy();
  expect(screen.queryByText("이 Mac에서 바로 읽어요")).toBeNull();
  expect(screen.getByRole("switch", { name: "Spotify · Spicetify" })).toBeTruthy();
  expect(screen.getByRole("option", { name: "Apple Music · macOS", hidden: true })).toHaveProperty(
    "disabled",
    true,
  );
  expect(screen.getByRole("option", { name: "Apple Music 우선" })).toHaveProperty("disabled", true);
  expect(command).not.toHaveBeenCalled();
});

it("keeps Linux Spotify extension available without claiming native reads or app launch", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
  render(<MusicSettings widget={{ ...widget(), data: { configured: false, config: {} } }} />);
  expect(screen.getByRole("switch", { name: "Spotify · Spicetify" })).toHaveProperty(
    "checked",
    true,
  );
  expect(screen.getByText("Windows 전용")).toBeTruthy();
  expect(
    screen.getByRole("option", { name: "Spotify · 직접 읽기 (macOS · Windows)", hidden: true }),
  ).toHaveProperty("disabled", true);
  expect(
    screen.getByRole("option", { name: "시스템 미디어 · Windows", hidden: true }),
  ).toHaveProperty("disabled", true);
  expect(screen.getByRole("option", { name: "Spotify + Spicetify", hidden: true })).toHaveProperty(
    "disabled",
    false,
  );
  expect(screen.getByText(/Spotify는 직접 실행해 주세요/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "곡 정보 읽기 허용하고 연결" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("configure_connection_widget", {
      id: "music",
      input: expect.objectContaining({ provider: "auto", allowedProviders: ["spotify"] }),
    }),
  );
});

it("filters unsupported saved providers on Linux without saving on mount", async () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
  render(
    <MusicSettings
      widget={{
        ...widget(),
        data: {
          configured: false,
          config: {
            provider: "music",
            allowedProviders: ["music", "spotify", "system"],
            priority: "music",
          },
        },
      }}
    />,
  );
  expect(command).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "곡 정보 읽기 허용하고 연결" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("configure_connection_widget", {
      id: "music",
      input: expect.objectContaining({
        provider: "auto",
        allowedProviders: ["spotify"],
        priority: "last-played",
      }),
    }),
  );
});

it("blocks an empty Linux automatic selection and restores its supported default", () => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Linux x86_64");
  render(<MusicSettings widget={{ ...widget(), data: { configured: false, config: {} } }} />);
  fireEvent.click(screen.getByRole("switch", { name: "Spotify · Spicetify" }));
  expect(screen.getByRole("button", { name: "곡 정보 읽기 허용하고 연결" })).toHaveProperty(
    "disabled",
    true,
  );
  fireEvent.click(screen.getByRole("button", { name: "선택 초기화" }));
  expect(screen.getByRole("switch", { name: "Spotify · Spicetify" })).toHaveProperty(
    "checked",
    true,
  );
  expect(command).not.toHaveBeenCalled();
});

it.each([
  ["MacIntel", "music", ["music", "spotify"]],
  ["Win32", "auto", ["system"]],
])("preserves supported defaults on %s", async (platform, provider, allowedProviders) => {
  vi.spyOn(navigator, "platform", "get").mockReturnValue(platform as string);
  render(<MusicSettings widget={{ ...widget(), data: { configured: false, config: {} } }} />);
  fireEvent.click(screen.getByRole("button", { name: "곡 정보 읽기 허용하고 연결" }));
  await waitFor(() =>
    expect(command).toHaveBeenCalledWith("configure_connection_widget", {
      id: "music",
      input: expect.objectContaining({ provider, allowedProviders }),
    }),
  );
});
