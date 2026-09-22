import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const sandbox = { module: { exports: {} }, Uint32Array, TextEncoder, setTimeout, clearTimeout };
runInNewContext(readFileSync(new URL("./comet.js", import.meta.url), "utf8"), sandbox);
const { createConnection, dispatch, randomIndex, randomTrack, observe } = sandbox.module.exports;
const playlistUri = "spotify:playlist:0000000000000000000000";
const uri = index => `spotify:track:${String(index).padStart(22, "0")}`;
const check = () => {};
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function player(overrides = {}) {
  return { data: { item: { uri: uri(1), metadata: { title: "Song", artist_name: "Artist" } }, isPaused: true }, playUri: vi.fn(), setHeart: vi.fn(), getVolume: () => 0, getDuration: () => 1000, getProgress: () => 10, ...overrides };
}

describe("Spicetify local bridge", () => {
  it("samples every paginated playable occurrence and skips unplayable/local items", async () => {
    const getContents = vi.fn(async (_uri, { offset }) => ({ totalLength: 102, items: offset === 0 ? Array.from({ length: 100 }, (_, i) => ({ uri: uri(i), isPlayable: i !== 5 })) : [{ uri: uri(100), isPlayable: true }, { uri: "spotify:local:private" }] }));
    const api = { Platform: { PlaylistAPI: { getContents } } };
    const selected = await randomTrack(api, playlistUri, check, { getRandomValues: values => { values[0] = 99; } });
    expect(selected).toBe(uri(100));
    expect(getContents.mock.calls.map(call => call[1].offset)).toEqual([0, 100]);
  });
  it("includes playlists in nested folders and paginates the full list", async () => {
    const items = Array.from({ length: 101 }, (_, i) => ({ uri: `spotify:playlist:${String(i).padStart(22, "0")}`, name: `Playlist ${i}` }));
    const api = { Platform: { RootlistAPI: { getContents: async () => ({ items: [{ type: "folder", items }] }) } } };
    const first = await dispatch(api, "playlists", null, check, webcrypto);
    expect(first.items).toHaveLength(100);
    expect(first.nextOffset).toBe(100);
    const second = await dispatch(api, "playlists", { offset: 100 }, check, webcrypto);
    expect(second.items[0].title).toBe("Playlist 100");
    expect(second.nextOffset).toBeNull();
  });
  it("does not bias the integer draw through modulo wrapping", () => {
    const values = [0xffffffff, 2];
    expect(randomIndex(3, { getRandomValues: output => { output[0] = values.shift(); } })).toBe(2);
    expect(values).toEqual([]);
  });
  it("does not start a random song after cancellation during a playlist read", async () => {
    const pending = deferred();
    const api = { Player: player(), Platform: { PlaylistAPI: { getContents: () => pending.promise } } };
    let canceled = false;
    const work = dispatch(api, "playRandom", { uri: playlistUri }, () => { if (canceled) { throw new Error("expired"); } }, webcrypto);
    canceled = true;
    pending.resolve({ items: [{ uri: uri(1) }], totalLength: 1 });
    await expect(work).rejects.toThrow("expired");
    expect(api.Player.playUri).not.toHaveBeenCalled();
  });
  it("fails on incomplete oversized pages instead of choosing only the first page", async () => {
    const api = { Platform: { PlaylistAPI: { getContents: async () => ({ items: [], totalLength: 500 }) } } };
    await expect(randomTrack(api, playlistUri, check, webcrypto)).rejects.toThrow("unsupported");
    api.Platform.PlaylistAPI.getContents = async () => ({ items: [{ uri: uri(1) }], totalLength: 10001 });
    await expect(randomTrack(api, playlistUri, check, webcrypto)).rejects.toThrow("limit");
  });
  it("rejects unknown commands, arbitrary URI schemes and stale-song likes", async () => {
    const api = { Player: player() };
    await expect(dispatch(api, "eval", "doSomething()", check, webcrypto)).rejects.toThrow("unsupported");
    await expect(dispatch(api, "playUri", { uri: "https://evil.example" }, check, webcrypto)).rejects.toThrow("invalid");
    await expect(dispatch(api, "like", { uri: uri(2), liked: true }, check, webcrypto)).rejects.toThrow("expired");
    expect(api.Player.setHeart).not.toHaveBeenCalled();
    await dispatch(api, "like", { uri: uri(1), liked: true }, check, webcrypto);
    expect(api.Player.setHeart).toHaveBeenCalledWith(true);
  });
  it("keeps paused metadata and real zero values but never returns credentials", () => {
    const api = { Player: player({ data: { item: { uri: uri(1), metadata: { title: "Paused", accessToken: "secret" } }, isPaused: true, token: "secret" } }) };
    const result = observe(api);
    expect(result.title).toBe("Paused");
    expect(result.playing).toBe(false);
    expect(result.volume).toBe(0);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.capabilities.playlists).toBe(false);
    expect(result.capabilities.playlistTracks).toBe(false);
    const withPlaylist = observe({ ...api, Platform: { PlaylistAPI: { getContents: vi.fn() } } });
    expect(withPlaylist.capabilities.playlistTracks).toBe(true);
  });
  it("converts millisecond seeking to a fraction, including a one-ms position", async () => {
    const api = { Player: player({ seek: vi.fn() }) };
    await dispatch(api, "seek", 1, check, webcrypto);
    expect(api.Player.seek).toHaveBeenCalledWith(0.001);
    await expect(dispatch(api, "seek", 1001, check, webcrypto)).rejects.toThrow("invalid");
  });

  function transport() {
    const sockets = [];
    class Socket {
      static OPEN = 1;
      readyState = 1;
      messages = [];
      constructor(url) { this.url = url; sockets.push(this); }
      send(text) { this.messages.push(JSON.parse(text)); }
      close() { this.readyState = 3; }
      open() { this.onopen(); }
      receive(message) { this.onmessage({ data: JSON.stringify(message) }); }
    }
    return { Socket, sockets };
  }
  it("requires the ready handshake and never retries after a disconnect", () => {
    const { Socket, sockets } = transport();
    const connection = createConnection({ Player: player() }, Socket, webcrypto, vi.fn());
    connection.connect("a".repeat(32));
    const ws = sockets[0]; ws.open();
    expect(ws.messages).toEqual([{ type: "hello", version: 1, code: "a".repeat(32) }]);
    ws.receive({ type: "request", id: "b".repeat(32), action: "play" });
    expect(ws.readyState).toBe(3);
    expect(sockets).toHaveLength(1);
    connection.close();
  });
  it("cancels an in-flight random play and ignores frames from an old socket", async () => {
    const { Socket, sockets } = transport();
    const pending = deferred();
    const api = { Player: player(), Platform: { PlaylistAPI: { getContents: () => pending.promise } } };
    const connection = createConnection(api, Socket, webcrypto, vi.fn());
    connection.connect("a".repeat(32));
    const old = sockets[0]; old.open(); old.receive({ type: "ready", version: 1 });
    const id = "b".repeat(32);
    old.receive({ type: "request", id, action: "playRandom", value: { uri: playlistUri }, expiresAt: Date.now() + 10000 });
    old.receive({ type: "cancel", id });
    pending.resolve({ items: [{ uri: uri(1) }], totalLength: 1 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(api.Player.playUri).not.toHaveBeenCalled();
    expect(old.messages).toHaveLength(1);
    connection.connect("c".repeat(32));
    const current = sockets[1]; current.open(); current.receive({ type: "ready", version: 1 });
    old.receive({ type: "ready", version: 1 });
    expect(current.readyState).toBe(1);
    connection.close();
  });
  it("rejects expired requests before changing playback", async () => {
    const { Socket, sockets } = transport();
    const api = { Player: player({ next: vi.fn() }) };
    const connection = createConnection(api, Socket, webcrypto, vi.fn());
    connection.connect("a".repeat(32));
    const ws = sockets[0]; ws.open(); ws.receive({ type: "ready", version: 1 });
    ws.receive({ type: "request", id: "b".repeat(32), action: "next", value: null, expiresAt: Date.now() - 1 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(api.Player.next).not.toHaveBeenCalled();
    expect(ws.messages[1].error).toBe("expired");
    connection.close();
  });
});
