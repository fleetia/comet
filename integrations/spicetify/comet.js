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
    const allowed = (method, permission, ...reasons) => has(method) && restrictions[permission] !== false && !reasons.some(name => restrictions[name]?.length);
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
      trackNumber: number(metadata.album_track_number ?? metadata.track_number), discNumber: number(metadata.album_disc_number ?? metadata.disc_number),
      description: text(metadata.description, 8000), lyrics: null,
      capabilities: {
        play: allowed("play", "canResume", "disallowResumingReasons", "disallow_resuming_reasons"),
        pause: allowed("pause", "canPause", "disallowPausingReasons", "disallow_pausing_reasons"),
        next: allowed("next", "canSkipNext", "disallowSkippingNextReasons", "disallow_skipping_next_reasons"),
        previous: allowed("back", "canSkipPrevious", "disallowSkippingPreviousReasons", "disallow_skipping_prev_reasons"),
        seek: allowed("seek", "canSeek", "disallowSeekingReasons", "disallow_seeking_reasons"), volume: has("setVolume"),
        shuffle: allowed("setShuffle", "canToggleShuffle", "disallowTogglingShuffleReasons", "disallow_toggling_shuffle_reasons"),
        repeat: allowed("setRepeat", "canToggleRepeatContext", "disallowTogglingRepeatContextReasons", "disallow_toggling_repeat_context_reasons")
          && allowed("setRepeat", "canToggleRepeatTrack", "disallowTogglingRepeatTrackReasons", "disallow_toggling_repeat_track_reasons"),
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
  async function waitForState(confirmed, check) {
    for (;;) {
      check();
      if (confirmed()) { return; }
      // Read Spotify's in-process state until its update arrives; check enforces the request deadline.
      await new Promise(resolve => setTimeout(resolve, 100));
      check();
    }
  }
  function playbackPositionAt(data, at) {
    const position = number(data?.positionAsOfTimestamp);
    const timestamp = number(data?.timestamp);
    if (position == null || timestamp == null || typeof data?.isPaused !== "boolean") { return null; }
    return position + (data.isPaused ? 0 : Math.max(0, at - timestamp));
  }
  function playbackItemChanged(previous, current) {
    return Boolean(previous?.item && current?.item && (previous.item.uri !== current.item.uri
      || (previous.item.uid != null && current.item.uid != null && previous.item.uid !== current.item.uid)));
  }
  async function dispatch(spicetify, action, value, check, cryptoApi) {
    validate(action, value);
    check();
    const player = spicetify.Player;
    let confirmed = () => true;
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
        confirmed = () => player.data?.item?.uri === uri && player.data.isPaused === false;
        break;
      }
      case "like":
        if (player.data?.item?.uri !== value.uri) { fail("expired"); }
        await call(player, "setHeart", value.liked);
        confirmed = () => {
          if (player.data?.item?.uri !== value.uri) { fail("expired"); }
          return call(player, "getHeart") === value.liked;
        };
        break;
      case "enqueue": await call(spicetify, "addToQueue", [{ uri: value.uri }]); break;
      case "playUri":
        await call(player, "playUri", value.uri);
        confirmed = () => player.data?.item?.uri === value.uri && player.data.isPaused === false;
        break;
      case "play": case "pause":
        await call(player, action);
        confirmed = () => Boolean(player.data?.item) && player.data.isPaused === (action === "pause");
        break;
      case "next": case "previous": {
        const previous = player.data;
        await call(player, action === "next" ? "next" : "back");
        confirmed = () => {
          const current = player.data;
          if (!current?.item || current === previous) { return false; }
          if (playbackItemChanged(previous, current)) { return true; }
          const position = number(current.positionAsOfTimestamp);
          const timestamp = number(current.timestamp);
          const naturalPosition = timestamp == null ? null : playbackPositionAt(previous, timestamp);
          return action === "previous" && position != null && timestamp != null && timestamp >= previous?.timestamp
            && naturalPosition != null && position <= 250 && naturalPosition - position > 250;
        };
        break;
      }
      case "seek": {
        const duration = call(player, "getDuration");
        if (!Number.isFinite(duration) || duration <= 0 || value > duration) { fail("invalid"); }
        const previous = player.data;
        const initialPosition = playbackPositionAt(previous, Date.now());
        if (!previous?.item || initialPosition == null) { fail("unsupported"); }
        const target = Math.round(value);
        // Spicetify 2.45 treats integer values as milliseconds, including 0 and 1.
        await call(player, "seek", target);
        confirmed = () => {
          const current = player.data;
          if (!current?.item) { return false; }
          if (playbackItemChanged(previous, current)) {
            if (target >= duration) { return true; }
            fail("expired");
          }
          if (Math.abs(initialPosition - target) < 1) { return true; }
          const position = number(current.positionAsOfTimestamp);
          const timestamp = number(current.timestamp);
          const naturalPosition = timestamp == null ? null : playbackPositionAt(previous, timestamp);
          // Compare event baselines, not getProgress()'s clock interpolation or natural playback.
          return current !== previous && position != null && timestamp != null && timestamp >= previous.timestamp
            && naturalPosition != null && Math.abs(position - target) <= 250
            && Math.abs(position - naturalPosition) > Math.min(250, Math.abs(initialPosition - target) / 2);
        };
        break;
      }
      case "volume":
        await call(player, "setVolume", value / 100);
        confirmed = () => {
          const volume = number(call(player, "getVolume"));
          return volume != null && Math.abs(volume * 100 - value) <= 0.5;
        };
        break;
      case "shuffle":
        await call(player, "setShuffle", value);
        confirmed = () => call(player, "getShuffle") === value;
        break;
      case "repeat":
        await call(player, "setRepeat", ["off", "all", "one"].indexOf(value));
        confirmed = () => ["off", "all", "one"][call(player, "getRepeat")] === value;
        break;
      default: fail("unsupported");
    }
    await waitForState(confirmed, check);
    check();
    return { ok: true };
  }

  const STORAGE_KEY = "comet-music-pairing-v2";
  const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
  const SECRET = /^[a-f0-9]{64}$/;
  function hex(bytes) { return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join(""); }
  function bytes(value) { return Uint8Array.from(value.match(/../g), byte => parseInt(byte, 16)); }
  function validCredential(value) {
    return exactObject(value, ["id", "secret", "pendingRevoke"]) && ID.test(value.id) && SECRET.test(value.secret)
      && (value.pendingRevoke === undefined || typeof value.pendingRevoke === "boolean");
  }
  function createConnection(spicetify, WebSocketApi, cryptoApi, onState, storage) {
    if (storage === undefined) {
      try { storage = globalThis.localStorage; } catch { storage = null; }
    }
    let socket = null;
    let generation = 0;
    let ready = false;
    let enabled = false;
    let credential = null;
    let retry = null;
    let timeout = null;
    let retryDelay = 1000;
    let sendDisconnect = null;
    const pending = new Map();
    function save(value) {
      if (!storage) { fail("storage"); }
      if (value == null) {
        storage.removeItem(STORAGE_KEY);
        if (storage.getItem(STORAGE_KEY) !== null) { fail("storage"); }
      } else {
        const serialized = JSON.stringify(value);
        storage.setItem(STORAGE_KEY, serialized);
        if (storage.getItem(STORAGE_KEY) !== serialized) { fail("storage"); }
      }
      credential = value;
    }
    function stopTransport() {
      generation++;
      ready = false;
      pending.clear();
      clearTimeout(timeout); timeout = null;
      sendDisconnect = null;
      const previous = socket;
      socket = null;
      if (previous) { previous.close(); }
    }
    function close() {
      enabled = false;
      clearTimeout(retry); retry = null;
      stopTransport();
      onState("연결 안 됨");
    }
    function retryResume() {
      if (!enabled || !credential || retry != null) { return; }
      onState(credential.pendingRevoke ? "연결 해제 대기 중… Comet을 열면 완료합니다." : "Comet을 기다리는 중… 자동으로 다시 연결합니다.");
      retry = setTimeout(() => { retry = null; if (enabled && credential) { start("resume"); } }, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 30000);
    }
    function start(mode, code = "") {
      stopTransport();
      const epoch = generation;
      const saved = credential;
      let phase = "opening";
      let serverAuthenticated = false;
      let authenticatedIdentity = null;
      let established = false;
      const clientNonce = hex(cryptoApi.getRandomValues(new Uint8Array(32)));
      let ws;
      try { ws = new WebSocketApi(URL); } catch {
        code = "";
        if (mode === "resume") { retryResume(); } else { onState("Comet에 연결하지 못했습니다."); }
        return;
      }
      socket = ws;
      function current() { return epoch === generation && socket === ws && enabled; }
      function expired() { if (!current()) { fail("expired"); } }
      function broken() {
        if (!current()) { return; }
        code = "";
        stopTransport();
        if (mode === "resume" || established) { retryResume(); }
        else { onState("연결하지 못했습니다. Comet에서 새 연결 코드를 확인해 주세요."); }
      }
      function deadline() { clearTimeout(timeout); timeout = setTimeout(broken, 6000); }
      function forget() {
        enabled = false;
        clearTimeout(retry); retry = null;
        let removed = false;
        try { save(null); removed = true; } catch { /* Never resume in this process after an authenticated revocation. */ }
        stopTransport();
        onState(removed ? "연결 해제됨" : "연결은 해제됐지만 저장 정보 삭제에 실패했습니다.");
      }
      sendDisconnect = () => {
        if (!current() || !serverAuthenticated || phase !== "ready" || ws.readyState !== WebSocketApi.OPEN) { return false; }
        ready = false; pending.clear(); phase = "revoking";
        deadline();
        try { ws.send(JSON.stringify({ type: "disconnect" })); } catch { broken(); return true; }
        onState("연결 해제 중…");
        return true;
      };
      onState(saved?.pendingRevoke ? "연결 해제 대기 중…" : mode === "resume" ? "자동으로 다시 연결 중…" : "연결 중…");
      deadline();
      ws.onopen = () => {
        if (!current() || phase !== "opening") { return; }
        phase = "challenge";
        ws.send(JSON.stringify({ type: "hello", version: 2, mode, clientNonce, ...(mode === "resume" ? { pairingId: saved.id } : {}) }));
      };
      ws.onclose = broken;
      ws.onerror = broken;
      ws.onmessage = async event => {
        if (!current()) { return; }
        try {
          if (typeof event.data !== "string" || event.data.length > MAX_MESSAGE) { fail("invalid"); }
          const message = JSON.parse(event.data);
          if (phase === "challenge") {
            if (!exactObject(message, ["type", "version", "pairingId", "serverNonce", "proof"]) || message.type !== "challenge"
              || message.version !== 2 || !ID.test(message.pairingId) || !SECRET.test(message.serverNonce) || !SECRET.test(message.proof)
              || (mode === "resume" && message.pairingId !== saved.id)) { fail("invalid"); }
            phase = "proving";
            const key = await cryptoApi.subtle.importKey("raw", bytes(mode === "pair" ? code : saved.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
            expired();
            const transcript = role => new TextEncoder().encode(`comet:music:v2:${role}:${mode}:${message.pairingId}:${clientNonce}:${message.serverNonce}`);
            const verified = await cryptoApi.subtle.verify("HMAC", key, bytes(message.proof), transcript("server"));
            expired();
            if (!verified) { fail("invalid"); }
            const proof = await cryptoApi.subtle.sign("HMAC", key, transcript("client"));
            expired();
            serverAuthenticated = true;
            authenticatedIdentity = message.pairingId;
            phase = "ready-wait";
            ws.send(JSON.stringify({ type: "authenticate", proof: hex(new Uint8Array(proof)) }));
            return;
          }
          if (serverAuthenticated && message.type === "revoked" && message.version === 2
            && exactObject(message, ["type", "version"])) { forget(); return; }
          if (phase === "ready-wait") {
            if (!serverAuthenticated || !exactObject(message, ["type", "version", "credential"]) || message.type !== "ready" || message.version !== 2) { fail("invalid"); }
            if (mode === "pair") {
              if (!validCredential(message.credential) || message.credential.pendingRevoke !== undefined) { fail("invalid"); }
              // The challenge identity is bound into both proofs; the stored identity must be the same.
              if (message.credential.id !== authenticatedIdentity) { fail("invalid"); }
              try { save(message.credential); } catch {
                ws.send(JSON.stringify({ type: "disconnect" }));
                code = ""; enabled = false; stopTransport();
                onState("연결 정보 저장에 실패했습니다. Spotify 저장 공간을 확인해 주세요.");
                return;
              }
            } else if (message.credential !== undefined) { fail("invalid"); }
            code = "";
            phase = "ready";
            established = true;
            clearTimeout(timeout); timeout = null;
            if (credential.pendingRevoke) { sendDisconnect(); return; }
            ready = true; retryDelay = 1000; onState("Comet에 연결됨 · 다음 실행에도 자동 연결");
            return;
          }
          if (phase === "revoking") {
            if (serverAuthenticated && message.type === "disconnected" && message.version === 2 && exactObject(message, ["type", "version"])) { forget(); return; }
            // Requests sent before disconnect are intentionally ignored and never replayed.
            if (message.type === "request" || message.type === "cancel") { return; }
            fail("invalid");
          }
          if (phase !== "ready" || !ready) { fail("invalid"); }
          if (message.type === "cancel") { pending.delete(message.id); return; }
          if (message.type !== "request" || !/^[a-f0-9]{32}$/.test(message.id) || pending.has(message.id) || pending.size >= 8
            || !Number.isSafeInteger(message.expiresAt) || message.expiresAt > Date.now() + 21000) { fail("invalid"); }
          const operation = {};
          pending.set(message.id, operation);
          function check() {
            if (!current() || !ready || ws.readyState !== WebSocketApi.OPEN || pending.get(message.id) !== operation || Date.now() >= message.expiresAt) { fail("expired"); }
          }
          function respond(reply) {
            if (current() && ready && pending.get(message.id) === operation && ws.readyState === WebSocketApi.OPEN) {
              let body = JSON.stringify({ type: "response", id: message.id, ...reply });
              if (new TextEncoder().encode(body).byteLength > MAX_MESSAGE) { body = JSON.stringify({ type: "response", id: message.id, ok: false, error: "limit" }); }
              ws.send(body);
            }
            if (pending.get(message.id) === operation) { pending.delete(message.id); }
          }
          dispatch(spicetify, message.action, message.value, check, cryptoApi).then(
            value => respond({ ok: true, value }),
            error => respond({ ok: false, error: ["expired", "unsupported", "empty", "limit", "invalid"].includes(error?.message) ? error.message : "failed" }),
          );
        } catch { broken(); }
      };
    }
    function resume() {
      close();
      retryDelay = 1000;
      try {
        const serialized = storage?.getItem(STORAGE_KEY);
        credential = serialized == null ? null : JSON.parse(serialized);
        if (credential && !validCredential(credential)) { fail("storage"); }
      } catch { credential = null; onState("저장된 연결 정보를 읽지 못했습니다. 새 연결 코드를 확인해 주세요."); return; }
      if (credential) { enabled = true; start("resume"); }
    }
    function connect(code) {
      if (!/^[a-f0-9]{32}$/.test(code)) { fail("invalid"); }
      close();
      enabled = true;
      retryDelay = 1000;
      start("pair", code);
    }
    function disconnect() {
      if (!credential) { close(); return; }
      try { save({ ...credential, pendingRevoke: true }); } catch {
        close(); onState("연결 해제를 저장하지 못했습니다. Spotify 저장 공간을 확인해 주세요."); return;
      }
      if (sendDisconnect?.()) { return; }
      clearTimeout(retry); retry = null;
      enabled = true;
      retryDelay = 1000;
      start("resume");
    }
    return { connect, resume, close, disconnect };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createConnection, dispatch, randomIndex, randomTrack, observe, validate };
    return;
  }
  function boot() {
    const spicetify = globalThis.Spicetify;
    // Menu.Item is exposed before the React modules its constructor uses are ready.
    if (!spicetify?.Player || !spicetify?.Menu?.Item || !spicetify?.PopupModal
      || !spicetify?.React || typeof spicetify?.ReactJSX?.jsx !== "function" || !spicetify?.ReactComponent?.MenuItem) {
      setTimeout(boot, 1000); return;
    }
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
      const disconnect = document.createElement("button"); disconnect.textContent = "연결 해제"; disconnect.style.marginLeft = "12px"; disconnect.onclick = connection.disconnect;
      statusNode = document.createElement("p"); statusNode.textContent = status; statusNode.setAttribute("role", "status");
      const description = document.createElement("p"); description.textContent = "현재 곡·플레이리스트·대기열을 Comet에서 확인하고 재생을 제어합니다. 처음 한 번만 코드로 연결하면 Spotify나 Comet을 다시 열 때 이 컴퓨터에서 자동으로 연결합니다. 연결 해제를 누르면 저장한 연결을 지웁니다. Comet이 꺼져 있으면 다음 연결 때 해제를 마칩니다.";
      content.append(label, input, connect, disconnect, statusNode, description);
      spicetify.PopupModal.display({ title: "Comet 음악 연결", content });
    }
    new spicetify.Menu.Item("Comet 음악 연결", false, settings).register();
    window.addEventListener("beforeunload", connection.close);
    connection.resume();
  }
  boot();
})();
