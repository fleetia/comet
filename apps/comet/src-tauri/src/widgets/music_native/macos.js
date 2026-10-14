function run(argv) {
  const input = JSON.parse(argv[0]);
  ObjC.import("AppKit");
  const spotify = input.provider === "spotify";
  const running = $.NSRunningApplication.runningApplicationsWithBundleIdentifier(input.appId).count > 0;
  if (input.action === "launch") {
    if (!running) {
      const url = $.NSWorkspace.sharedWorkspace.URLForApplicationWithBundleIdentifier(input.appId);
      if (!url || url.isNil() || !$.NSWorkspace.sharedWorkspace.openURL(url)) throw new Error("LAUNCH_FAILED");
    }
    return JSON.stringify({ running: true });
  }
  if (!running) {
    if (input.action !== "observe") throw new Error("APP_CLOSED");
    return JSON.stringify({ running: false });
  }
  const app = Application(input.appId);
  function optional(read) {
    try {
      const value = read();
      if (value === undefined || value === null) return null;
      if (value instanceof Date) return isNaN(value.getTime()) ? null : value.toISOString();
      if (typeof value === "number") return isFinite(value) ? value : null;
      return typeof value === "string" || typeof value === "boolean" ? value : null;
    } catch (_) { return null; }
  }
  function property(object, name, limit) {
    const value = optional(function () { return object[name](); });
    return typeof value === "string" ? value.slice(0, limit || 1000) : value;
  }
  function duration(track) {
    const value = property(track, "duration");
    return typeof value === "number" ? value * (spotify ? 1 : 1000) : null;
  }
  function capabilities(state, position, length) {
    return {
      play: true, pause: true, next: true, previous: true,
      seek: state !== "stopped" && typeof position === "number" && typeof length === "number" && length > 0,
      volume: typeof property(app, "soundVolume") === "number",
      shuffle: !spotify || property(app, "shufflingEnabled") === true,
      repeat: !spotify || property(app, "repeatingEnabled") === true,
      playUri: spotify
    };
  }
  const playerState = app.playerState();
  const state = playerState === "fast forwarding" || playerState === "rewinding" ? "playing" : playerState;
  const track = state === "stopped" ? null : app.currentTrack();
  const length = track ? duration(track) : null;
  const position = property(app, "playerPosition");
  if (input.action !== "observe") {
    const supported = capabilities(state, position, length);
    if (!supported[input.action]) throw new Error("UNSUPPORTED_CONTROL");
    switch (input.action) {
      case "play": app.play(); break;
      case "pause": app.pause(); break;
      case "next": app.nextTrack(); break;
      case "previous": app.previousTrack(); break;
      case "seek":
        if (input.value > length) throw new Error("UNSUPPORTED_CONTROL");
        app.playerPosition = input.value / 1000;
        break;
      case "volume": app.soundVolume = Math.round(input.value); break;
      case "shuffle":
        if (spotify) app.shuffling = input.value;
        else app.shuffleEnabled = input.value;
        break;
      case "repeat":
        if (spotify) app.repeating = input.value !== "off";
        else app.songRepeat = input.value;
        break;
      case "playUri": app.playTrack(input.value); break;
      default: throw new Error("UNSUPPORTED_CONTROL");
    }
    return JSON.stringify({ ok: true });
  }
  const trackId = track ? property(track, spotify ? "id" : "persistentID") : null;
  const metadata = {};
  const fields = spotify
    ? ["albumArtist", "discNumber", "trackNumber", "playedCount", "starred", "popularity"]
    : ["albumArtist", "genre", "releaseDate", "year", "composer", "bpm", "trackNumber", "trackCount", "discNumber", "discCount", "work", "movement", "movementNumber", "movementCount", "kind", "bitRate", "sampleRate", "description", "favorited", "rating", "playedCount", "playedDate"];
  if (track) fields.forEach(function (key) { metadata[key] = property(track, key); });
  if (spotify && track) metadata.spotifyUrl = property(track, "spotifyUrl");
  if (!spotify) {
    metadata.mute = property(app, "mute");
    metadata.shuffleMode = property(app, "shuffleMode");
  }
  function musicArtwork() {
    // NSAppleEventDescriptor preserves artwork bytes that JXA's plain data coercion loses.
    try {
      ObjC.import("Foundation");
      ObjC.import("AppKit");
      const script = $.NSAppleScript.alloc.initWithSource('tell application "Music" to get raw data of artwork 1 of current track');
      const descriptor = script.executeAndReturnError(Ref());
      const data = descriptor.data;
      if (!data || data.length === 0 || data.length > 16777216) return null;
      const original = $.NSImage.alloc.initWithData(data);
      const size = original.size;
      if (size.width <= 0 || size.height <= 0) return null;
      const ratio = Math.min(1, 256 / Math.max(size.width, size.height));
      const bounds = $.NSMakeRect(0, 0, Math.round(size.width * ratio), Math.round(size.height * ratio));
      const thumbnail = $.NSImage.alloc.initWithSize(bounds.size);
      thumbnail.lockFocus;
      original.drawInRectFromRectOperationFraction(bounds, $.NSZeroRect, $.NSCompositingOperationCopy, 1);
      thumbnail.unlockFocus;
      const image = $.NSBitmapImageRep.imageRepWithData(thumbnail.TIFFRepresentation);
      const png = image.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $({}));
      if (!png || png.length > 524288) return null;
      return "data:image/png;base64," + ObjC.unwrap(png.base64EncodedStringWithOptions(0));
    } catch (_) { return null; }
  }
  const repeated = spotify ? property(app, "repeating") : property(app, "songRepeat");
  const result = {
    running: true, playbackState: state,
    title: track ? property(track, "name") : null,
    artist: track ? property(track, "artist") : null,
    album: track ? property(track, "album") : null,
    trackId: trackId,
    durationMs: length,
    positionMs: typeof position === "number" ? position * 1000 : null,
    artworkUrl: track ? (spotify ? property(track, "artworkUrl") : musicArtwork()) : null,
    lyrics: track && !spotify ? property(track, "lyrics", 65536) : null,
    volume: property(app, "soundVolume"),
    shuffle: property(app, spotify ? "shuffling" : "shuffleEnabled"),
    repeat: spotify ? (repeated === null ? null : repeated ? "all" : "off") : repeated,
    metadata: metadata,
    capabilities: capabilities(state, position, length)
  };
  if (trackId !== null && property(app.currentTrack(), spotify ? "id" : "persistentID") !== trackId) {
    throw new Error("TRACK_CHANGED");
  }
  return JSON.stringify(result);
}
