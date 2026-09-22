import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const sandbox = { module: { exports: {} }, Uint32Array, TextEncoder, setTimeout, clearTimeout };
const extensionSource = readFileSync(new URL("./comet.js", import.meta.url), "utf8");
runInNewContext(extensionSource, sandbox);
const { createConnection, dispatch, randomIndex, randomTrack, observe } = sandbox.module.exports;
const playlistUri = "spotify:playlist:0000000000000000000000";
const uri = index => `spotify:track:${String(index).padStart(22, "0")}`;
const check = () => {};
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function player(overrides = {}) {
  let liked = false;
  return { data: { item: { uri: uri(1), metadata: { title: "Song", artist_name: "Artist" } }, isPaused: true, positionAsOfTimestamp: 10, timestamp: Date.now() }, playUri: vi.fn(), setHeart: vi.fn(value => { liked = value; }), getHeart: () => liked, getVolume: () => 0, getDuration: () => 1000, getProgress: () => 10, ...overrides };
}

describe("Spicetify local bridge", () => {
  it("waits for Spotify's React menu modules and registers once when they are ready", () => {
    const register = vi.fn();
    const addEventListener = vi.fn();
    const timers = [];
    const api = {
      Player: player(),
      PopupModal: {},
      Menu: { Item: function MenuItem() { api.ReactJSX.jsx(); return { register }; } },
    };
    runInNewContext(extensionSource, {
      Spicetify: api, WebSocket: vi.fn(), crypto: webcrypto, window: { addEventListener },
      setTimeout: callback => { timers.push(callback); }, clearTimeout, Uint32Array, TextEncoder,
    });
    expect(register).not.toHaveBeenCalled();
    expect(timers).toHaveLength(1);
    api.ReactJSX = { jsx: vi.fn() };
    timers.shift()();
    expect(register).not.toHaveBeenCalled();
    api.React = {};
    timers.shift()();
    expect(register).not.toHaveBeenCalled();
    api.ReactComponent = { MenuItem: vi.fn() };
    timers.shift()();
    expect(register).toHaveBeenCalledTimes(1);
    expect(api.ReactJSX.jsx).toHaveBeenCalledTimes(1);
    expect(addEventListener).toHaveBeenCalledWith("beforeunload", expect.any(Function));
    expect(timers).toEqual([]);
  });
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
  it.each([
    ["play", "play", "canResume", "disallowResumingReasons", "disallow_resuming_reasons"],
    ["pause", "pause", "canPause", "disallowPausingReasons", "disallow_pausing_reasons"],
    ["next", "next", "canSkipNext", "disallowSkippingNextReasons", "disallow_skipping_next_reasons"],
    ["previous", "back", "canSkipPrevious", "disallowSkippingPreviousReasons", "disallow_skipping_prev_reasons"],
    ["seek", "seek", "canSeek", "disallowSeekingReasons", "disallow_seeking_reasons"],
    ["shuffle", "setShuffle", "canToggleShuffle", "disallowTogglingShuffleReasons", "disallow_toggling_shuffle_reasons"],
    ["repeat", "setRepeat", "canToggleRepeatContext", "disallowTogglingRepeatContextReasons", "disallow_toggling_repeat_context_reasons"],
    ["repeat", "setRepeat", "canToggleRepeatTrack", "disallowTogglingRepeatTrackReasons", "disallow_toggling_repeat_track_reasons"],
  ])("honors %s capability restrictions through %s / %s", (capability, method, permission, reason, legacyReason) => {
    const api = { Player: player({ [method]: vi.fn() }) };
    expect(observe(api).capabilities[capability]).toBe(true);
    api.Player.data.restrictions = { [permission]: false };
    expect(observe(api).capabilities[capability]).toBe(false);
    api.Player.data.restrictions = { [permission]: true, [reason]: ["restricted"] };
    expect(observe(api).capabilities[capability]).toBe(false);
    api.Player.data.restrictions = { [permission]: true, [reason]: [], [legacyReason]: ["restricted"] };
    expect(observe(api).capabilities[capability]).toBe(false);
    api.Player.data.restrictions = { [permission]: true, [reason]: [], [legacyReason]: [] };
    expect(observe(api).capabilities[capability]).toBe(true);
    delete api.Player[method];
    expect(observe(api).capabilities[capability]).toBe(false);
  });
  it("reads current album track/disc numbers and retains legacy metadata support", () => {
    const api = { Player: player() };
    api.Player.data.item.metadata = { album_track_number: "4", album_disc_number: "2", track_number: "9", disc_number: "9" };
    expect(observe(api)).toMatchObject({ trackNumber: 4, discNumber: 2 });
    api.Player.data.item.metadata = { track_number: "3", disc_number: "1" };
    expect(observe(api)).toMatchObject({ trackNumber: 3, discNumber: 1 });
  });
  it("seeks in milliseconds at the start, one ms, and the exact track end", async () => {
    let progress = 10;
    const seekTo = vi.fn(position => {
      progress = position;
      api.Player.data = { ...api.Player.data, positionAsOfTimestamp: position, timestamp: Date.now() };
    });
    const duration = 1000;
    const api = { Player: player({ getProgress: () => progress, seek: position => {
      // Preserve the installed Spicetify 2.45.1 wrapper's unit conversion.
      seekTo(!Number.isInteger(position) && position >= 0 && position <= 1 ? Math.round(position * duration) : position);
    } }) };
    for (const position of [0, 1, 500, duration, 0.5]) {
      await dispatch(api, "seek", position, check, webcrypto);
    }
    expect(seekTo.mock.calls.map(([position]) => position)).toEqual([0, 1, 500, duration, 1]);
    await expect(dispatch(api, "seek", 1001, check, webcrypto)).rejects.toThrow("invalid");
    expect(seekTo).toHaveBeenCalledTimes(5);
  });
  it.each([
    ["play", null, "play", { isPaused: true }, { isPaused: false }],
    ["pause", null, "pause", { isPaused: false }, { isPaused: true }],
    ["next", null, "next", {}, { uri: uri(2), position: 0 }],
    ["previous", null, "back", {}, { position: 0 }],
    ["seek", 7500, "seek", {}, { position: 7500 }],
    ["volume", 25, "setVolume", {}, { volume: 0.25 }],
    ["shuffle", true, "setShuffle", {}, { shuffle: true }],
    ["repeat", "one", "setRepeat", {}, { repeat: 2 }],
    ["like", { uri: uri(1), liked: true }, "setHeart", {}, { liked: true }],
    ["playUri", { uri: uri(2) }, "playUri", {}, { uri: uri(2) }],
    ["playRandom", { uri: playlistUri }, "playUri", {}, { uri: uri(2) }],
  ])("waits for observed state after %s before acknowledging the command", async (action, value, method, before, after) => {
    const state = { uri: uri(1), isPaused: false, position: 1000, volume: 0, shuffle: false, repeat: 0, liked: false, ...before };
    const api = {
      Player: player({
        data: { item: { uri: state.uri }, isPaused: state.isPaused, positionAsOfTimestamp: state.position, timestamp: Date.now() },
        [method]: vi.fn(),
        getDuration: () => 10000, getProgress: () => state.position, getVolume: () => state.volume,
        getShuffle: () => state.shuffle, getRepeat: () => state.repeat, getHeart: () => state.liked,
      }),
      Platform: { PlaylistAPI: { getContents: async () => ({ items: [{ uri: uri(2), isPlayable: true }], totalLength: 1 }) } },
    };
    let acknowledged = false;
    const work = dispatch(api, action, value, check, webcrypto).then(result => { acknowledged = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(api.Player[method]).toHaveBeenCalledTimes(1);
    expect(acknowledged).toBe(false);
    if (action === "playUri" || action === "playRandom") {
      api.Player.data = { item: { uri: uri(2) }, isPaused: true };
      await new Promise(resolve => setTimeout(resolve, 110));
      expect(acknowledged).toBe(false);
    }
    Object.assign(state, after);
    api.Player.data = { item: { uri: state.uri }, isPaused: state.isPaused, positionAsOfTimestamp: state.position, timestamp: Date.now() };
    await expect(work).resolves.toEqual({ ok: true });
    expect(api.Player[method]).toHaveBeenCalledTimes(1);
    expect(observe(api).playing).toBe(!state.isPaused);
  });
  it("confirms the seek event baseline even when the first observation is over 250 ms late", async () => {
    const now = Date.now();
    const api = { Player: player({
      data: { item: { uri: uri(1), uid: "first" }, isPaused: false, positionAsOfTimestamp: 1000, timestamp: now - 2000 },
      getDuration: () => 10000,
      getProgress: () => 9000,
      seek: vi.fn(() => {
        api.Player.data = { ...api.Player.data, positionAsOfTimestamp: 8000, timestamp: now - 1000 };
      }),
    }) };
    await expect(dispatch(api, "seek", 8000, check, webcrypto)).resolves.toEqual({ ok: true });
    expect(api.Player.seek).toHaveBeenCalledOnce();
  });
  it("accepts a seek already at the requested position without requiring a new update", async () => {
    const api = { Player: player({ seek: vi.fn() }) };
    const before = api.Player.data;
    await expect(dispatch(api, "seek", 10, check, webcrypto)).resolves.toEqual({ ok: true });
    expect(api.Player.data).toBe(before);
    expect(api.Player.seek).toHaveBeenCalledWith(10);
  });
  it("does not confirm a seek from null, unrelated updates, or naturally reaching the target", async () => {
    const now = Date.now();
    const before = { item: { uri: uri(1), uid: "first" }, isPaused: false, positionAsOfTimestamp: 1000, timestamp: now - 5000 };
    const api = { Player: player({ data: before, getDuration: () => 10000, getProgress: () => 5000, seek: vi.fn() }) };
    let acknowledged = false;
    const work = dispatch(api, "seek", 5000, check, webcrypto).then(result => { acknowledged = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 0));
    for (const update of [null, { ...before, shuffle: true }, { ...before, positionAsOfTimestamp: 5000, timestamp: now - 1000 }]) {
      api.Player.data = update;
      await new Promise(resolve => setTimeout(resolve, 110));
      expect(acknowledged).toBe(false);
    }
    api.Player.data = { ...before, positionAsOfTimestamp: 5000, timestamp: now };
    await expect(work).resolves.toEqual({ ok: true });
    expect(api.Player.seek).toHaveBeenCalledOnce();
  });
  it.each([["next", "next"], ["previous", "back"]])("requires an item transition for %s instead of any new snapshot", async (action, method) => {
    const now = Date.now();
    const before = { item: { uri: uri(1), uid: "first" }, isPaused: false, positionAsOfTimestamp: 1000, timestamp: now };
    const api = { Player: player({ data: before, [method]: vi.fn() }) };
    let acknowledged = false;
    const work = dispatch(api, action, null, check, webcrypto).then(result => { acknowledged = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 0));
    for (const update of [null, { ...before, shuffle: true, positionAsOfTimestamp: 1100, timestamp: now + 100 }]) {
      api.Player.data = update;
      await new Promise(resolve => setTimeout(resolve, 110));
      expect(acknowledged).toBe(false);
    }
    api.Player.data = { ...before, item: { uri: uri(1), uid: "second" }, positionAsOfTimestamp: 0, timestamp: now + 200 };
    await expect(work).resolves.toEqual({ ok: true });
    expect(api.Player[method]).toHaveBeenCalledOnce();
  });
  it("confirms a track-end seek only after an actual next item replaces a transient null state", async () => {
    const before = { item: { uri: uri(1), uid: "first" }, isPaused: false, positionAsOfTimestamp: 9000, timestamp: Date.now() };
    const api = { Player: player({ data: before, getDuration: () => 10000, seek: vi.fn() }) };
    let acknowledged = false;
    const work = dispatch(api, "seek", 10000, check, webcrypto).then(result => { acknowledged = true; return result; });
    await new Promise(resolve => setTimeout(resolve, 0));
    api.Player.data = null;
    await new Promise(resolve => setTimeout(resolve, 110));
    expect(acknowledged).toBe(false);
    api.Player.data = { ...before, item: { uri: uri(2), uid: "second" }, positionAsOfTimestamp: 0, timestamp: Date.now() };
    await expect(work).resolves.toEqual({ ok: true });
  });
  it("expires a pending like when the current song changes before confirmation", async () => {
    const api = { Player: player({ setHeart: vi.fn() }) };
    const work = dispatch(api, "like", { uri: uri(1), liked: true }, check, webcrypto);
    const rejected = expect(work).rejects.toThrow("expired");
    await new Promise(resolve => setTimeout(resolve, 0));
    api.Player.data = { item: { uri: uri(2) }, isPaused: false };
    api.Player.getHeart = () => true;
    await rejected;
    expect(api.Player.setHeart).toHaveBeenCalledTimes(1);
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
      receive(message) { return this.onmessage({ data: JSON.stringify(message) }); }
      drop() { this.readyState = 3; this.onclose(); }
    }
    return { Socket, sockets };
  }
  const storageKey = "comet-music-pairing-v2";
  const pairingId = "11111111-2222-4333-8444-555555555555";
  const code = "a".repeat(32);
  const secret = "d".repeat(64);
  const serverNonce = "e".repeat(64);
  function memoryStorage(record = null) {
    const values = new Map(record ? [[storageKey, JSON.stringify(record)]] : []);
    return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  }
  async function proof(hello, role, key, nonce = serverNonce, id = pairingId) {
    const hmac = await webcrypto.subtle.importKey("raw", Buffer.from(key, "hex"), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const value = `comet:music:v2:${role}:${hello.mode}:${id}:${hello.clientNonce}:${nonce}`;
    return Buffer.from(await webcrypto.subtle.sign("HMAC", hmac, new TextEncoder().encode(value))).toString("hex");
  }
  async function authenticate(ws, options = {}) {
    ws.open();
    const hello = ws.messages[0];
    const key = options.key ?? (hello.mode === "pair" ? code : secret);
    const id = options.id ?? pairingId;
    await ws.receive({ type: "challenge", version: 2, pairingId: id, serverNonce, proof: await proof(hello, "server", key, serverNonce, id) });
    expect(ws.messages[1]).toEqual({ type: "authenticate", proof: await proof(hello, "client", key, serverNonce, id) });
    await ws.receive({ type: "ready", version: 2, ...(hello.mode === "pair" ? { credential: { id, secret } } : {}) });
  }
  function bridge(api = { Player: player() }, record = null, options = {}) {
    const { Socket, sockets } = transport();
    const storage = options.storage ?? memoryStorage(record);
    const states = vi.fn();
    const connection = (options.create ?? createConnection)(api, Socket, options.crypto ?? webcrypto, states, storage);
    return { connection, sockets, storage, states, api };
  }
  function scheduledBridge(record, api = { Player: player() }, crypto = webcrypto) {
    const tasks = [];
    let serial = 0;
    const context = { module: { exports: {} }, Uint32Array, TextEncoder,
      setTimeout: (run, delay) => { const task = { run, delay, id: ++serial }; tasks.push(task); return task.id; },
      clearTimeout: id => { const index = tasks.findIndex(task => task.id === id); if (index >= 0) { tasks.splice(index, 1); } },
    };
    runInNewContext(extensionSource, context);
    return { ...bridge(api, record, { create: context.module.exports.createConnection, crypto }), tasks,
      advance: () => { const task = tasks.shift(); expect(task).toBeDefined(); task.run(); return task.delay; },
    };
  }
  it("sends only a nonce hello and rejects requests before mutual authentication", async () => {
    const { connection, sockets, states, storage } = bridge();
    connection.connect(code);
    const ws = sockets[0]; ws.open();
    expect(ws.messages[0]).toMatchObject({ type: "hello", version: 2, mode: "pair" });
    expect(ws.messages[0].clientNonce).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(ws.messages)).not.toContain(code);
    await ws.receive({ type: "request", id: "b".repeat(32), action: "play" });
    expect(ws.readyState).toBe(3);
    expect(storage.getItem(storageKey)).toBeNull();
    expect(states.mock.calls.flat()).not.toContain("Comet에 연결됨 · 다음 실행에도 자동 연결");
    expect(sockets).toHaveLength(1);
    connection.close();
  });
  it("cancels an in-flight random play and ignores frames from an old socket", async () => {
    const pending = deferred();
    const api = { Player: player(), Platform: { PlaylistAPI: { getContents: () => pending.promise } } };
    const { connection, sockets } = bridge(api);
    connection.connect(code);
    const old = sockets[0]; await authenticate(old);
    const id = "b".repeat(32);
    await old.receive({ type: "request", id, action: "playRandom", value: { uri: playlistUri }, expiresAt: Date.now() + 10000 });
    await old.receive({ type: "cancel", id });
    pending.resolve({ items: [{ uri: uri(1) }], totalLength: 1 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(api.Player.playUri).not.toHaveBeenCalled();
    expect(old.messages).toHaveLength(2);
    connection.connect(code);
    const current = sockets[1]; await authenticate(current);
    await old.receive({ type: "ready", version: 2 });
    expect(current.readyState).toBe(1);
    connection.close();
  });
  it("rejects expired requests before changing playback", async () => {
    const { connection, sockets, api } = bridge({ Player: player({ next: vi.fn() }) });
    connection.connect(code);
    const ws = sockets[0]; await authenticate(ws);
    await ws.receive({ type: "request", id: "b".repeat(32), action: "next", value: null, expiresAt: Date.now() - 1 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(api.Player.next).not.toHaveBeenCalled();
    expect(ws.messages[2].error).toBe("expired");
    connection.close();
  });
  it.each(["cancel", "expire"])("does not acknowledge a delayed playback update after %s", async cancellation => {
    const api = { Player: player({ pause: vi.fn() }) };
    api.Player.data.isPaused = false;
    const { connection, sockets } = bridge(api);
    connection.connect(code);
    const ws = sockets[0]; await authenticate(ws);
    const id = "b".repeat(32);
    await ws.receive({ type: "request", id, action: "pause", value: null, expiresAt: Date.now() + (cancellation === "expire" ? 50 : 10000) });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(api.Player.pause).toHaveBeenCalledTimes(1);
    expect(ws.messages).toHaveLength(2);
    if (cancellation === "cancel") { await ws.receive({ type: "cancel", id }); }
    await new Promise(resolve => setTimeout(resolve, 110));
    api.Player.data = { ...api.Player.data, isPaused: true };
    await new Promise(resolve => setTimeout(resolve, 110));
    if (cancellation === "cancel") {
      expect(ws.messages).toHaveLength(2);
    } else {
      expect(ws.messages[2]).toMatchObject({ type: "response", id, ok: false, error: "expired" });
      expect(ws.messages).toHaveLength(3);
    }
    expect(api.Player.pause).toHaveBeenCalledTimes(1);
    connection.close();
  });
  it("persists verified pairing and resumes after shutdown without exposing the secret", async () => {
    const first = bridge();
    first.connection.connect(code);
    await authenticate(first.sockets[0]);
    expect(JSON.parse(first.storage.getItem(storageKey))).toEqual({ id: pairingId, secret });
    first.connection.close();
    const second = bridge(undefined, null, { storage: first.storage });
    second.connection.resume();
    expect(second.sockets).toHaveLength(1);
    await authenticate(second.sockets[0]);
    expect(second.sockets[0].messages[0]).toMatchObject({ type: "hello", mode: "resume", pairingId });
    expect(JSON.stringify(second.sockets[0].messages)).not.toContain(secret);
    expect(second.states).toHaveBeenLastCalledWith("Comet에 연결됨 · 다음 실행에도 자동 연결");
    second.connection.close();
    expect(JSON.parse(second.storage.getItem(storageKey))).toEqual({ id: pairingId, secret });
  });
  it("automatically resumes when the first newly paired transport closes", async () => {
    const test = scheduledBridge(null);
    test.connection.connect(code);
    await authenticate(test.sockets[0]);
    test.sockets[0].drop();
    expect(test.tasks.map(task => task.delay)).toEqual([1000]);
    test.advance();
    await authenticate(test.sockets[1]);
    expect(test.sockets[1].messages[0].mode).toBe("resume");
    test.connection.close();
  });
  it("resumes a stored pairing on browser boot and retains it on beforeunload", async () => {
    const { Socket, sockets } = transport();
    const storage = memoryStorage({ id: pairingId, secret });
    const events = new Map();
    runInNewContext(extensionSource, {
      Spicetify: { Player: player(), PopupModal: {}, React: {}, ReactJSX: { jsx: vi.fn() },
        ReactComponent: { MenuItem: vi.fn() }, Menu: { Item: function() { return { register: vi.fn() }; } } },
      WebSocket: Socket, crypto: webcrypto, localStorage: storage, window: { addEventListener: (name, callback) => events.set(name, callback) },
      setTimeout, clearTimeout, Uint32Array, TextEncoder,
    });
    expect(sockets).toHaveLength(1);
    await authenticate(sockets[0]);
    events.get("beforeunload")();
    expect(sockets[0].readyState).toBe(3);
    expect(JSON.parse(storage.getItem(storageKey))).toEqual({ id: pairingId, secret });
  });
  it("retries resume exponentially up to 30 seconds and stops all timers on shutdown", () => {
    const test = scheduledBridge({ id: pairingId, secret });
    test.connection.resume();
    for (const delay of [1000, 2000, 4000, 8000, 16000, 30000, 30000]) {
      test.sockets.at(-1).drop();
      expect(test.tasks.map(task => task.delay)).toEqual([delay]);
      expect(test.advance()).toBe(delay);
    }
    expect(test.sockets).toHaveLength(8);
    test.connection.close();
    expect(test.tasks).toEqual([]);
    expect(JSON.parse(test.storage.getItem(storageKey))).toEqual({ id: pairingId, secret });
  });
  it("does not replay or complete a pending command after reconnect", async () => {
    const pending = deferred();
    const api = { Player: player(), Platform: { PlaylistAPI: { getContents: () => pending.promise } } };
    const test = scheduledBridge({ id: pairingId, secret }, api);
    test.connection.resume();
    const old = test.sockets[0]; await authenticate(old);
    await old.receive({ type: "request", id: "b".repeat(32), action: "playRandom", value: { uri: playlistUri }, expiresAt: Date.now() + 10000 });
    old.drop(); test.advance();
    const current = test.sockets[1]; await authenticate(current);
    pending.resolve({ items: [{ uri: uri(2) }], totalLength: 1 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(api.Player.playUri).not.toHaveBeenCalled();
    expect(current.messages).toHaveLength(2);
    expect(old.messages).toHaveLength(2);
    test.connection.close();
  });
  it.each(["wrong-proof", "wrong-identity", "premature-ready", "unauthenticated-revoke"])("rejects %s without changing durable credentials", async kind => {
    const test = scheduledBridge({ id: pairingId, secret });
    test.connection.resume();
    const ws = test.sockets[0]; ws.open();
    const message = kind === "premature-ready" ? { type: "ready", version: 2, credential: { id: pairingId, secret: "f".repeat(64) } }
      : kind === "unauthenticated-revoke" ? { type: "revoked", version: 2 }
      : { type: "challenge", version: 2, pairingId: kind === "wrong-identity" ? "00000000-0000-4000-8000-000000000000" : pairingId,
        serverNonce, proof: kind === "wrong-proof" ? "0".repeat(64) : await proof(ws.messages[0], "server", secret) };
    await ws.receive(message);
    expect(ws.readyState).toBe(3);
    expect(ws.messages).toHaveLength(1);
    expect(JSON.parse(test.storage.getItem(storageKey))).toEqual({ id: pairingId, secret });
    expect(test.tasks.map(task => task.delay)).toEqual([1000]);
    test.connection.close();
  });
  it.each(["pair", "resume"])("refuses credential replacement outside the authenticated %s identity", async mode => {
    const test = scheduledBridge({ id: pairingId, secret });
    if (mode === "pair") { test.connection.connect(code); } else { test.connection.resume(); }
    const ws = test.sockets[0]; ws.open();
    await ws.receive({ type: "challenge", version: 2, pairingId, serverNonce,
      proof: await proof(ws.messages[0], "server", mode === "pair" ? code : secret) });
    await ws.receive({ type: "ready", version: 2,
      credential: { id: "00000000-0000-4000-8000-000000000000", secret: "f".repeat(64) } });
    expect(ws.readyState).toBe(3);
    expect(JSON.parse(test.storage.getItem(storageKey))).toEqual({ id: pairingId, secret });
    test.connection.close();
  });
  it("binds server proof to a fresh client nonce on every reconnect", async () => {
    const test = scheduledBridge({ id: pairingId, secret });
    test.connection.resume();
    const first = test.sockets[0]; first.open();
    const oldProof = await proof(first.messages[0], "server", secret);
    first.drop(); test.advance();
    const second = test.sockets[1]; second.open();
    expect(second.messages[0].clientNonce).not.toBe(first.messages[0].clientNonce);
    await second.receive({ type: "challenge", version: 2, pairingId, serverNonce, proof: oldProof });
    expect(second.messages).toHaveLength(1);
    expect(second.readyState).toBe(3);
    test.connection.close();
  });
  it.each(["throw", "discard"])("does not connect when credential storage will %s writes", async behavior => {
    const storage = memoryStorage();
    storage.setItem = () => { if (behavior === "throw") { throw new Error("quota"); } };
    const test = bridge(undefined, null, { storage });
    test.connection.connect(code);
    await authenticate(test.sockets[0]);
    expect(test.states.mock.calls.flat()).not.toContain("Comet에 연결됨 · 다음 실행에도 자동 연결");
    expect(test.states).toHaveBeenLastCalledWith("연결 정보 저장에 실패했습니다. Spotify 저장 공간을 확인해 주세요.");
    expect(test.sockets[0].messages.at(-1)).toEqual({ type: "disconnect" });
    expect(storage.getItem(storageKey)).toBeNull();
    expect(test.sockets[0].readyState).toBe(3);
    test.connection.close();
  });
  it("persists offline unlink and reconnects only to revoke, never to execute queued commands", async () => {
    const test = scheduledBridge({ id: pairingId, secret }, { Player: player({ play: vi.fn() }) });
    test.connection.resume();
    test.sockets[0].drop();
    test.connection.disconnect();
    expect(JSON.parse(test.storage.getItem(storageKey))).toEqual({ id: pairingId, secret, pendingRevoke: true });
    const ws = test.sockets[1]; await authenticate(ws);
    expect(ws.messages.at(-1)).toEqual({ type: "disconnect" });
    await ws.receive({ type: "request", id: "b".repeat(32), action: "play", value: null, expiresAt: Date.now() + 10000 });
    expect(test.api.Player.play).not.toHaveBeenCalled();
    expect(ws.messages).toHaveLength(3);
    ws.drop(); test.advance();
    expect(JSON.parse(test.storage.getItem(storageKey)).pendingRevoke).toBe(true);
    const again = test.sockets[2]; await authenticate(again);
    await again.receive({ type: "disconnected", version: 2 });
    expect(test.storage.getItem(storageKey)).toBeNull();
    expect(test.tasks).toEqual([]);
    expect(test.states).toHaveBeenLastCalledWith("연결 해제됨");
  });
  it("sends online unlink immediately and keeps it pending until server acknowledgement", async () => {
    const test = scheduledBridge({ id: pairingId, secret });
    test.connection.resume();
    const ws = test.sockets[0]; await authenticate(ws);
    test.connection.disconnect();
    expect(test.sockets).toHaveLength(1);
    expect(ws.messages.at(-1)).toEqual({ type: "disconnect" });
    expect(JSON.parse(test.storage.getItem(storageKey)).pendingRevoke).toBe(true);
    await ws.receive({ type: "disconnected", version: 2 });
    expect(test.storage.getItem(storageKey)).toBeNull();
    expect(test.tasks).toEqual([]);
  });
  it("honors authenticated revocation and does not retry the forgotten pairing", async () => {
    const test = scheduledBridge({ id: pairingId, secret });
    test.connection.resume();
    const ws = test.sockets[0]; await authenticate(ws);
    await ws.receive({ type: "revoked", version: 2 });
    expect(test.storage.getItem(storageKey)).toBeNull();
    expect(test.tasks).toEqual([]);
    expect(ws.readyState).toBe(3);
  });
  it("allows an explicitly verified new code to replace pending unlink", async () => {
    const test = bridge(undefined, { id: pairingId, secret, pendingRevoke: true });
    test.connection.resume();
    test.connection.connect(code);
    const newId = "00000000-0000-4000-8000-000000000000";
    await authenticate(test.sockets[1], { id: newId });
    expect(JSON.parse(test.storage.getItem(storageKey))).toEqual({ id: newId, secret });
    test.connection.close();
  });
  it("ignores a stale asynchronous handshake and refuses duplicate challenge reentry", async () => {
    const waiting = deferred();
    const crypto = { getRandomValues: values => webcrypto.getRandomValues(values), subtle: {
      importKey: (...args) => waiting.promise.then(() => webcrypto.subtle.importKey(...args)),
      sign: (...args) => webcrypto.subtle.sign(...args), verify: (...args) => webcrypto.subtle.verify(...args),
    } };
    const test = scheduledBridge({ id: pairingId, secret }, undefined, crypto);
    test.connection.resume();
    const ws = test.sockets[0]; ws.open();
    const challenge = { type: "challenge", version: 2, pairingId, serverNonce, proof: await proof(ws.messages[0], "server", secret) };
    const work = ws.receive(challenge);
    await ws.receive(challenge);
    expect(ws.readyState).toBe(3);
    test.advance();
    waiting.resolve(); await work;
    expect(ws.messages).toHaveLength(1);
    expect(test.sockets[1].messages).toEqual([]);
    expect(JSON.parse(test.storage.getItem(storageKey))).toEqual({ id: pairingId, secret });
    test.connection.close();
  });
});
