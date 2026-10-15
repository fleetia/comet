import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mock, test } from "node:test";
import { runInNewContext } from "node:vm";

const script = readFileSync(new URL("./macos.js", import.meta.url), "utf8");
const spotifyAppId = "com.spotify.client";

function harness({ running = false, installed = true, opens = true } = {}) {
  const url = { isNil: () => !installed };
  const lookup = mock.fn(() => url);
  const open = mock.fn(() => opens);
  const runningApplications = mock.fn(() => ({ count: running ? 1 : 0 }));
  const context = {
    ObjC: { import() {} },
    $: {
      NSRunningApplication: { runningApplicationsWithBundleIdentifier: runningApplications },
      NSWorkspace: {
        sharedWorkspace: { URLForApplicationWithBundleIdentifier: lookup, openURL: open },
      },
    },
    Application() {
      throw new Error("Launch must not request automation or playback");
    },
  };
  runInNewContext(script, context, { filename: "macos.js" });
  return {
    lookup,
    open,
    runningApplications,
    url,
    run(action = "launch") {
      return JSON.parse(
        context.run([JSON.stringify({ provider: "spotify", appId: spotifyAppId, action })]),
      );
    },
  };
}

test("launch leaves an already running Spotify instance alone", () => {
  const app = harness({ running: true });
  assert.deepEqual(app.run(), { running: true });
  assert.deepEqual(Array.from(app.runningApplications.mock.calls[0].arguments), [spotifyAppId]);
  assert.equal(app.lookup.mock.callCount(), 0);
  assert.equal(app.open.mock.callCount(), 0);
});

test("launch opens the installed Spotify app once without automation or playback", () => {
  const app = harness();
  assert.deepEqual(app.run(), { running: true });
  assert.equal(app.lookup.mock.callCount(), 1);
  assert.deepEqual(Array.from(app.lookup.mock.calls[0].arguments), [spotifyAppId]);
  assert.equal(app.open.mock.callCount(), 1);
  assert.deepEqual(Array.from(app.open.mock.calls[0].arguments), [app.url]);
});

test("launch fails without opening a URL when Spotify is not installed", () => {
  const app = harness({ installed: false });
  assert.throws(() => app.run(), /LAUNCH_FAILED/);
  assert.deepEqual(Array.from(app.lookup.mock.calls[0].arguments), [spotifyAppId]);
  assert.equal(app.open.mock.callCount(), 0);
});

test("launch reports a failed workspace open instead of claiming Spotify is running", () => {
  const app = harness({ opens: false });
  assert.throws(() => app.run(), /LAUNCH_FAILED/);
  assert.equal(app.open.mock.callCount(), 1);
});

test("observe preserves the closed app state without launching Spotify", () => {
  const app = harness();
  assert.deepEqual(app.run("observe"), { running: false });
  assert.equal(app.lookup.mock.callCount(), 0);
  assert.equal(app.open.mock.callCount(), 0);
});
