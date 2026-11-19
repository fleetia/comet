import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

const sandbox = { module: { exports: {} }, Uint32Array, TextEncoder, setTimeout, clearTimeout };
const extensionSource = readFileSync(new URL("./comet.js", import.meta.url), "utf8");
runInNewContext(extensionSource, sandbox);
const { createConnection, dispatch, observe } = sandbox.module.exports;
const playlistUri = "spotify:playlist:0000000000000000000000";
const uri = index => `spotify:track:${String(index).padStart(22, "0")}`;
const check = () => {};
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function player(overrides = {}) {
  return { data: { item: { uri: uri(1), metadata: { title: "Song", artist_name: "Artist" } }, isPaused: true, positionAsOfTimestamp: 10, timestamp: Date.now() }, getHeart: () => false, getVolume: () => 0, getDuration: () => 1000, getProgress: () => 10, ...overrides };
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
  it("includes playlists in nested folders and paginates the full list", async () => {
    const items = Array.from({ length: 101 }, (_, i) => ({ uri: `spotify:playlist:${String(i).padStart(22, "0")}`, name: `Playlist ${i}` }));
    const api = { Platform: { RootlistAPI: { getContents: async () => ({ items: [{ type: "folder", items }] }) } } };
    const first = await dispatch(api, "playlists", null, check);
    expect(first.items).toHaveLength(100);
    expect(first.nextOffset).toBe(100);
    const second = await dispatch(api, "playlists", { offset: 100 }, check);
    expect(second.items[0].title).toBe("Playlist 100");
    expect(second.nextOffset).toBeNull();
  });
  it.each(["play", "pause", "next", "previous", "seek", "volume", "shuffle", "repeat", "playUri", "playRandom", "enqueue", "like"])("rejects removed action %s", async action => {
    await expect(dispatch({ Player: player() }, action, null, check)).rejects.toThrow("unsupported");
  });
  it("rejects unknown commands and arbitrary playlist URI schemes", async () => {
    const api = { Player: player() };
    await expect(dispatch(api, "eval", "doSomething()", check)).rejects.toThrow("unsupported");
    await expect(dispatch(api, "playlistTracks", { uri: "https://evil.example" }, check)).rejects.toThrow("invalid");
  });
  it("fails on incomplete or oversized playlist pages", async () => {
    const api = { Platform: { PlaylistAPI: { getContents: async () => ({ items: [], totalLength: 500 }) } } };
    await expect(dispatch(api, "playlistTracks", { uri: playlistUri }, check)).rejects.toThrow("unsupported");
    api.Platform.PlaylistAPI.getContents = async () => ({ items: [{ uri: uri(1) }], totalLength: 10001 });
    await expect(dispatch(api, "playlistTracks", { uri: playlistUri }, check)).rejects.toThrow("limit");
  });
  it("keeps paused metadata and real zero values but never returns credentials", () => {
    const api = { Player: player({ data: { item: { uri: uri(1), metadata: { title: "Paused", accessToken: "secret" } }, isPaused: true, token: "secret" } }) };
    const result = observe(api);
    expect(result.title).toBe("Paused");
    expect(result.playing).toBe(false);
    expect(result.volume).toBe(0);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(result.capabilities).toEqual({ playlists: false, playlistTracks: false, queue: false });
    const withPlaylist = observe({ ...api, Platform: { PlaylistAPI: { getContents: vi.fn() } } });
    expect(withPlaylist.capabilities.playlistTracks).toBe(true);
  });
  it("reads current album track/disc numbers and retains legacy metadata support", () => {
    const api = { Player: player() };
    api.Player.data.item.metadata = { album_track_number: "4", album_disc_number: "2", track_number: "9", disc_number: "9" };
    expect(observe(api)).toMatchObject({ trackNumber: 4, discNumber: 2 });
    api.Player.data.item.metadata = { track_number: "3", disc_number: "1" };
    expect(observe(api)).toMatchObject({ trackNumber: 3, discNumber: 1 });
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
  it("cancels an in-flight playlist read and ignores frames from an old socket", async () => {
    const pending = deferred();
    const api = { Player: player(), Platform: { PlaylistAPI: { getContents: () => pending.promise } } };
    const { connection, sockets } = bridge(api);
    connection.connect(code);
    const old = sockets[0]; await authenticate(old);
    const id = "b".repeat(32);
    await old.receive({ type: "request", id, action: "playlistTracks", value: { uri: playlistUri }, expiresAt: Date.now() + 10000 });
    await old.receive({ type: "cancel", id });
    pending.resolve({ items: [{ uri: uri(1) }], totalLength: 1 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(old.messages).toHaveLength(2);
    connection.connect(code);
    const current = sockets[1]; await authenticate(current);
    await old.receive({ type: "ready", version: 2 });
    expect(current.readyState).toBe(1);
    connection.close();
  });
  it("rejects expired requests before reading a playlist", async () => {
    const getContents = vi.fn();
    const { connection, sockets } = bridge({ Player: player(), Platform: { PlaylistAPI: { getContents } } });
    connection.connect(code);
    const ws = sockets[0]; await authenticate(ws);
    await ws.receive({ type: "request", id: "b".repeat(32), action: "playlistTracks", value: { uri: playlistUri }, expiresAt: Date.now() - 1 });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(getContents).not.toHaveBeenCalled();
    expect(ws.messages[2].error).toBe("expired");
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
    await old.receive({ type: "request", id: "b".repeat(32), action: "playlistTracks", value: { uri: playlistUri }, expiresAt: Date.now() + 10000 });
    old.drop(); test.advance();
    const current = test.sockets[1]; await authenticate(current);
    pending.resolve({ items: [{ uri: uri(2) }], totalLength: 1 });
    await new Promise(resolve => setTimeout(resolve, 0));
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
    const getContents = vi.fn();
    const test = scheduledBridge({ id: pairingId, secret }, { Player: player(), Platform: { RootlistAPI: { getContents } } });
    test.connection.resume();
    test.sockets[0].drop();
    test.connection.disconnect();
    expect(JSON.parse(test.storage.getItem(storageKey))).toEqual({ id: pairingId, secret, pendingRevoke: true });
    const ws = test.sockets[1]; await authenticate(ws);
    expect(ws.messages.at(-1)).toEqual({ type: "disconnect" });
    await ws.receive({ type: "request", id: "b".repeat(32), action: "playlists", value: null, expiresAt: Date.now() + 10000 });
    expect(getContents).not.toHaveBeenCalled();
    expect(ws.messages).toHaveLength(3);
    ws.drop(); test.advance();
    expect(JSON.parse(test.storage.getItem(storageKey)).pendingRevoke).toBe(true);
    const again = test.sockets[2]; await authenticate(again);
    await again.receive({ type: "disconnected", version: 2 });
    expect(test.storage.getItem(storageKey)).toBeNull();
    expect(test.tasks).toEqual([]);
    expect(test.states).toHaveBeenLastCalledWith("연결 끊김");
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
