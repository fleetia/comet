// NAME: Comet local music bridge
// AUTHOR: Fleetia
// DESCRIPTION: Explicitly paired local controls. No Spotify credentials leave this process.
// SPDX-License-Identifier: AGPL-3.0-only
(function cometMusicBridge() {
  "use strict";
  const URL = "ws://127.0.0.1:18743/comet/v1";
  const PAGE_SIZE = 100;
  const MAX_TRACKS = 10000;
  const MAX_MESSAGE = 128 * 1024;
  const URI = /^spotify:(track|episode|playlist):[a-zA-Z0-9]{22}$/;

  function fail(code) { throw new Error(code); }
  function text(value, max = 1000) { return typeof value === "string" ? value.slice(0, max) : null; }
  function number(value) { const n = Number(value); return value != null && Number.isFinite(n) && n >= 0 ? n : null; }
  function isUri(value, kinds) { return typeof value === "string" && URI.test(value) && kinds.includes(value.split(":")[1]); }
  function requireUri(value, kinds) { if (!isUri(value, kinds)) { fail("invalid"); } return value; }
  function exactObject(value, keys) { return value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key)); }
  function offset(value) { const n = value?.offset ?? 0; if (!Number.isInteger(n) || n < 0 || n > MAX_TRACKS) { fail("invalid"); } return n; }
  function validate(action, value) {
    switch (action) {
      case "observe": case "play": case "pause": case "next": case "previous": case "queue":
        if (value !== null) { fail("invalid"); } break;
      case "seek": case "volume":
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > (action === "volume" ? 100 : 86400000)) { fail("invalid"); } break;
      case "shuffle": if (typeof value !== "boolean") { fail("invalid"); } break;
      case "repeat": if (!["off", "all", "one"].includes(value)) { fail("invalid"); } break;
      case "playlists": if (value !== null && !exactObject(value, ["offset"])) { fail("invalid"); } offset(value); break;
      case "playlistTracks":
        if (!exactObject(value, ["uri", "offset"])) { fail("invalid"); } requireUri(value.uri, ["playlist"]); offset(value); break;
      case "playRandom":
        if (!exactObject(value, ["uri"])) { fail("invalid"); } requireUri(value.uri, ["playlist"]); break;
      case "playUri": case "enqueue":
        if (!exactObject(value, ["uri"])) { fail("invalid"); } requireUri(value.uri, ["track", "episode"]); break;
      case "like":
        if (!exactObject(value, ["uri", "liked"]) || typeof value.liked !== "boolean") { fail("invalid"); } requireUri(value.uri, ["track"]); break;
      default: fail("unsupported");
    }
  }
  function call(target, method, ...args) {
    if (typeof target?.[method] !== "function") { fail("unsupported"); }
    return target[method](...args);
  }
  function track(item) {
    const data = item.contextTrack ?? item.track ?? item;
    const metadata = data.metadata ?? {};
    return {
      uri: data.uri,
      title: text(data.name ?? metadata.title),
      artist: text(data.artists?.map(artist => artist.name).join(", ") ?? metadata.artist_name),
      album: text(data.album?.name ?? metadata.album_title),
    };
  }
  function imageUrl(value) {
    if (typeof value !== "string") { return null; }
    if (/^https:\/\/i\.scdn\.co\/image\/[a-fA-F0-9]+$/.test(value)) { return value; }
    const image = /^spotify:image:([a-fA-F0-9]+)$/.exec(value);
    return image ? `https://i.scdn.co/image/${image[1]}` : null;
  }
  function observe(spicetify) {
    const player = spicetify.Player;
    const data = player.data;
    const item = data?.item;
    const metadata = item?.metadata ?? {};
    const has = name => typeof player[name] === "function";
    const get = name => has(name) ? player[name]() : null;
    const artists = [metadata.artist_name];
    for (let i = 1; i < 30 && metadata[`artist_name:${i}`]; i++) { artists.push(metadata[`artist_name:${i}`]); }
    const restrictions = data?.restrictions ?? {};
    const allowed = (name, method) => has(method) && !(restrictions[name]?.length);
    return {
      running: true,
      playing: Boolean(item && !data.isPaused),
      title: text(metadata.title), artist: text(artists.filter(Boolean).join(", ")), album: text(metadata.album_title),
      albumArtist: text(metadata.album_artist_name), trackId: isUri(item?.uri, ["track", "episode"]) ? item.uri : null,
      contextUri: text(data?.context?.uri), contentType: item?.uri?.split(":")[1] ?? null,
      artworkUrl: imageUrl(metadata.image_xlarge_url ?? metadata.image_large_url),
      durationMs: number(get("getDuration")), positionMs: number(get("getProgress")),
      volume: number(get("getVolume")) == null ? null : Math.round(get("getVolume") * 100),
      shuffle: get("getShuffle"), repeat: ["off", "all", "one"][get("getRepeat")] ?? null,
      liked: get("getHeart"), explicit: metadata.is_explicit === "true" ? true : metadata.is_explicit === "false" ? false : null,
      trackNumber: number(metadata.track_number), discNumber: number(metadata.disc_number),
      description: text(metadata.description, 8000), lyrics: null,
      capabilities: {
        play: allowed("disallow_resuming_reasons", "play"), pause: allowed("disallow_pausing_reasons", "pause"),
        next: allowed("disallow_skipping_next_reasons", "next"), previous: allowed("disallow_skipping_prev_reasons", "back"),
        seek: allowed("disallow_seeking_reasons", "seek"), volume: has("setVolume"),
        shuffle: allowed("disallow_toggling_shuffle_reasons", "setShuffle"), repeat: allowed("disallow_toggling_repeat_context_reasons", "setRepeat"),
        like: isUri(item?.uri, ["track"]) && has("setHeart"), playUri: has("playUri"),
        playlists: typeof spicetify.Platform?.RootlistAPI?.getContents === "function",
        playlistTracks: typeof spicetify.Platform?.PlaylistAPI?.getContents === "function",
        playRandom: typeof spicetify.Platform?.PlaylistAPI?.getContents === "function" && has("playUri"),
        queue: Array.isArray(spicetify.Queue?.nextTracks), enqueue: typeof spicetify.addToQueue === "function",
      },
    };
  }
  function pageResult(response, start) {
    if (!Array.isArray(response?.items) || response.items.length > PAGE_SIZE) { fail("unsupported"); }
    const total = Number.isInteger(response.totalLength) ? response.totalLength : Number.isInteger(response.total) ? response.total : null;
    if (total != null && (total < 0 || total > MAX_TRACKS)) { fail("limit"); }
    const end = start + response.items.length;
    const hasMore = total != null ? end < total : response.items.length === PAGE_SIZE;
    if (hasMore && response.items.length === 0) { fail("unsupported"); }
    return { items: response.items, total, nextOffset: hasMore ? end : null };
  }
  async function playlistPage(spicetify, uri, start, check) {
    check();
    const response = await call(spicetify.Platform?.PlaylistAPI, "getContents", uri, { offset: start, limit: PAGE_SIZE });
    check();
    return pageResult(response, start);
  }
  // Rejection sampling avoids modulo bias. Every playable playlist occurrence has equal probability.
  function randomIndex(length, cryptoApi) {
    if (!Number.isInteger(length) || length < 1 || length > MAX_TRACKS) { fail("empty"); }
    const ceiling = Math.floor(0x100000000 / length) * length;
    const value = new Uint32Array(1);
    do { cryptoApi.getRandomValues(value); } while (value[0] >= ceiling);
    return value[0] % length;
  }
  async function randomTrack(spicetify, uri, check, cryptoApi) {
    const tracks = [];
    const pageStarts = new Set();
    let start = 0;
    while (start != null) {
      if (start >= MAX_TRACKS || pageStarts.has(start)) { fail("limit"); }
      pageStarts.add(start);
      const page = await playlistPage(spicetify, uri, start, check);
      for (const item of page.items) {
        if (item.isPlayable !== false && isUri(item.uri, ["track", "episode"])) { tracks.push(item.uri); }
      }
      start = page.nextOffset;
    }
    check();
    return tracks[randomIndex(tracks.length, cryptoApi)];
  }
  async function playlists(spicetify, start, check) {
    check();
    // RootlistAPI returns a tree, including playlists inside folders.
    const response = await call(spicetify.Platform?.RootlistAPI, "getContents");
    check();
    if (!Array.isArray(response?.items)) { fail("unsupported"); }
    if (response.items.length > MAX_TRACKS) { fail("limit"); }
    const nodes = [...response.items];
    const items = [];
    for (let i = 0; i < nodes.length; i++) {
      if (nodes.length > MAX_TRACKS) { fail("limit"); }
      const item = nodes[i];
      if (isUri(item.uri, ["playlist"])) { items.push({ uri: item.uri, title: text(item.name) }); }
      if (Array.isArray(item.items)) {
        if (nodes.length + item.items.length > MAX_TRACKS) { fail("limit"); }
        nodes.push(...item.items);
      }
    }
    return { items: items.slice(start, start + PAGE_SIZE), total: items.length, nextOffset: start + PAGE_SIZE < items.length ? start + PAGE_SIZE : null };
  }
  async function dispatch(spicetify, action, value, check, cryptoApi) {
    validate(action, value);
    check();
    const player = spicetify.Player;
    switch (action) {
      case "observe": return observe(spicetify);
      case "playlists": return playlists(spicetify, offset(value), check);
      case "playlistTracks": {
        const page = await playlistPage(spicetify, value.uri, offset(value), check);
        return { ...page, items: page.items.filter(item => item.isPlayable !== false && isUri(item.uri, ["track", "episode"])).map(track) };
      }
      case "queue": {
        const items = spicetify.Queue?.nextTracks;
        if (!Array.isArray(items)) { fail("unsupported"); }
        return { items: items.slice(0, PAGE_SIZE).map(track).filter(item => isUri(item.uri, ["track", "episode"])), total: items.length, nextOffset: null };
      }
      case "playRandom": {
        const uri = await randomTrack(spicetify, value.uri, check, cryptoApi);
        check();
        await call(player, "playUri", uri);
        break;
      }
      case "like":
        if (player.data?.item?.uri !== value.uri) { fail("expired"); }
        await call(player, "setHeart", value.liked); break;
      case "enqueue": await call(spicetify, "addToQueue", [{ uri: value.uri }]); break;
      case "playUri": await call(player, "playUri", value.uri); break;
      case "play": case "pause": case "next": await call(player, action); break;
      case "previous": await call(player, "back"); break;
      case "seek": {
        const duration = call(player, "getDuration");
        if (!Number.isFinite(duration) || duration <= 0 || value > duration) { fail("invalid"); }
        // Player.seek interprets values from 0 to 1 as a fraction.
        await call(player, "seek", value / duration); break;
      }
      case "volume": await call(player, "setVolume", value / 100); break;
      case "shuffle": await call(player, "setShuffle", value); break;
      case "repeat": await call(player, "setRepeat", ["off", "all", "one"].indexOf(value)); break;
      default: fail("unsupported");
    }
    check();
    return { ok: true };
  }

  function createConnection(spicetify, WebSocketApi, cryptoApi, onState) {
    let socket = null;
    let generation = 0;
    let ready = false;
    const pending = new Map();
    function close() {
      generation++;
      ready = false;
      pending.clear();
      const previous = socket;
      socket = null;
      if (previous) { previous.close(); }
      onState("연결 안 됨");
    }
    function connect(code) {
      if (!/^[a-f0-9]{32}$/.test(code)) { fail("invalid"); }
      close();
      const epoch = generation;
      const ws = new WebSocketApi(URL);
      socket = ws;
      onState("연결 중…");
      const timeout = setTimeout(() => { if (socket === ws && !ready) { close(); } }, 6000);
      ws.onopen = () => { if (socket === ws) { ws.send(JSON.stringify({ type: "hello", version: 1, code })); code = ""; } };
      ws.onclose = () => { clearTimeout(timeout); if (socket === ws) { close(); } };
      ws.onerror = () => { if (socket === ws) { close(); } };
      ws.onmessage = event => {
        if (socket !== ws) { return; }
        if (typeof event.data !== "string" || event.data.length > MAX_MESSAGE) { close(); return; }
        let message;
        try { message = JSON.parse(event.data); } catch { close(); return; }
        if (!ready) {
          if (message.type !== "ready" || message.version !== 1) { close(); return; }
          ready = true; clearTimeout(timeout); onState("Comet에 연결됨"); return;
        }
        if (message.type === "cancel") { pending.delete(message.id); return; }
        if (message.type !== "request" || !/^[a-f0-9]{32}$/.test(message.id) || pending.has(message.id) || pending.size >= 8 || !Number.isSafeInteger(message.expiresAt) || message.expiresAt > Date.now() + 21000) { close(); return; }
        pending.set(message.id, true);
        function check() {
          if (epoch !== generation || !ready || socket !== ws || ws.readyState !== WebSocketApi.OPEN || !pending.has(message.id) || Date.now() >= message.expiresAt) { fail("expired"); }
        }
        function respond(reply) {
          if (epoch === generation && ready && socket === ws && pending.has(message.id) && ws.readyState === WebSocketApi.OPEN) {
            let body = JSON.stringify({ type: "response", id: message.id, ...reply });
            if (new TextEncoder().encode(body).byteLength > MAX_MESSAGE) { body = JSON.stringify({ type: "response", id: message.id, ok: false, error: "limit" }); }
            ws.send(body);
          }
          pending.delete(message.id);
        }
        dispatch(spicetify, message.action, message.value, check, cryptoApi).then(
          value => respond({ ok: true, value }),
          error => respond({ ok: false, error: ["expired", "unsupported", "empty", "limit", "invalid"].includes(error?.message) ? error.message : "failed" }),
        );
      };
    }
    return { connect, close };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createConnection, dispatch, randomIndex, randomTrack, observe, validate };
    return;
  }
  function boot() {
    const spicetify = globalThis.Spicetify;
    if (!spicetify?.Player || !spicetify?.Menu?.Item || !spicetify?.PopupModal) { setTimeout(boot, 1000); return; }
    let status = "연결 안 됨";
    let statusNode;
    const connection = createConnection(spicetify, WebSocket, crypto, next => { status = next; if (statusNode) { statusNode.textContent = next; } });
    function settings() {
      const content = document.createElement("div");
      const label = document.createElement("label");
      label.textContent = "Comet 음악 설정에서 만든 연결 코드";
      const input = document.createElement("input");
      input.type = "password"; input.autocomplete = "off"; input.maxLength = 32;
      input.setAttribute("aria-label", "Comet 연결 코드");
      input.style.cssText = "display:block;width:100%;margin:12px 0;padding:8px;color:var(--spice-text);background:var(--spice-main);border:1px solid var(--spice-subtext)";
      const connect = document.createElement("button"); connect.textContent = "연결";
      connect.onclick = () => { try { const code = input.value.trim(); input.value = ""; connection.connect(code); } catch { statusNode.textContent = "Comet에서 새 연결 코드를 확인해 주세요."; } };
      const disconnect = document.createElement("button"); disconnect.textContent = "연결 해제"; disconnect.style.marginLeft = "12px"; disconnect.onclick = connection.close;
      statusNode = document.createElement("p"); statusNode.textContent = status; statusNode.setAttribute("role", "status");
      const description = document.createElement("p"); description.textContent = "현재 곡·플레이리스트·대기열을 Comet에서 확인하고 재생을 제어합니다. 연결은 이 컴퓨터에서만 유지되고 Spotify나 Comet을 다시 열면 새 코드가 필요합니다.";
      content.append(label, input, connect, disconnect, statusNode, description);
      spicetify.PopupModal.display({ title: "Comet 음악 연결", content });
    }
    new spicetify.Menu.Item("Comet 음악 연결", false, settings).register();
    window.addEventListener("beforeunload", connection.close);
  }
  boot();
})();
