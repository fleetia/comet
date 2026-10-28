import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

// Linux only. COMET_E2E_BINARY must point to an already-built Comet binary.
// Requires tauri-driver, WebKitWebDriver, dbus-run-session, and a display (e.g. Xvfb).
// DBus and all XDG data are isolated: this test must never use an existing app profile.
if (process.platform !== "linux" || !process.env.COMET_E2E_BINARY) {
  throw new Error("Linux, an isolated display, and COMET_E2E_BINARY are required");
}

const binary = resolve(process.env.COMET_E2E_BINARY);
const root = await mkdtemp(resolve(tmpdir(), "comet-widget-e2e-"));
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const waitFor = async (fn, description, timeout = 30_000) => {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError}` : ""}`);
};
const freePort = () => new Promise((resolvePort, reject) => {
  const socket = createServer();
  socket.on("error", reject);
  socket.listen(0, "127.0.0.1", () => {
    const port = socket.address().port;
    socket.close((error) => error ? reject(error) : resolvePort(port));
  });
});

let driver;
let base;
let session;
let logs = "";
async function request(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10_000),
  });
  const result = await response.json();
  if (!response.ok || result.value?.error) {
    throw new Error(result.value?.message ?? `WebDriver ${response.status}`);
  }
  return result.value;
}
const command = (method, path, body) => request(method, `/session/${session}${path}`, body);
const execute = (script, args = []) => command("POST", "/execute/sync", { script, args });
async function invoke(name, args = {}) {
  const result = await command("POST", "/execute/async", {
    script: `const done = arguments[arguments.length - 1];
      window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1])
        .then(value => done({ value }), error => done({ error: String(error) }));`,
    args: [name, args],
  });
  if (result.error) throw new Error(result.error);
  return result.value;
}
async function findVisible(selector) {
  const elements = await command("POST", "/elements", { using: "css selector", value: selector });
  for (const element of elements) {
    const id = element["element-6066-11e4-a52e-4f735466cecf"];
    if (await command("GET", `/element/${id}/displayed`)) return id;
  }
  return null;
}
const element = (selector) => waitFor(() => findVisible(selector), selector);
const click = async (selector) => command("POST", `/element/${await element(selector)}/click`, {});
async function switchToView(view) {
  await waitFor(async () => {
    for (const handle of await command("GET", "/window/handles")) {
      await command("POST", "/window", { handle });
      if (await execute("return new URL(location.href).searchParams.get('view')") === view) {
        return true;
      }
    }
    return false;
  }, `${view} window`);
}
async function switchToAnyWindow() {
  await waitFor(async () => {
    const handles = await command("GET", "/window/handles");
    if (!handles.length) return false;
    await command("POST", "/window", { handle: handles[0] });
    return execute("return Boolean(window.__TAURI_INTERNALS__?.invoke)");
  }, "application WebView");
}
async function snapshotTodo() {
  const snapshot = await invoke("get_widgets");
  const todo = snapshot.widgets.find((widget) => widget.kind === "todo");
  assert.ok(todo, "official todo widget must exist");
  return todo;
}
async function start() {
  const port = await freePort();
  let nativePort = await freePort();
  while (nativePort === port) nativePort = await freePort();
  base = `http://127.0.0.1:${port}`;
  driver = spawn("dbus-run-session", ["--", "tauri-driver", "--port", String(port), "--native-port", String(nativePort)], {
    env: {
      ...process.env,
      XDG_DATA_HOME: resolve(root, "data"),
      XDG_CONFIG_HOME: resolve(root, "config"),
      XDG_CACHE_HOME: resolve(root, "cache"),
      XDG_RUNTIME_DIR: resolve(root, "runtime"),
      WEBKIT_DISABLE_DMABUF_RENDERER: "1",
    },
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  logs = "";
  driver.stdout.on("data", (data) => { logs += data; });
  driver.stderr.on("data", (data) => { logs += data; });
  driver.on("error", (error) => { logs += String(error); });
  await waitFor(async () => {
    if (driver.exitCode !== null) throw new Error(`tauri-driver exited: ${logs}`);
    return request("GET", "/status");
  }, "tauri-driver");
  const result = await request("POST", "/session", {
    capabilities: { alwaysMatch: { "tauri:options": { application: binary } } },
  });
  session = result.sessionId;
  assert.ok(session, "WebDriver did not return a session id");
  await switchToAnyWindow();
}
async function stop() {
  if (session) {
    await command("DELETE", "").catch(() => {});
    session = undefined;
  }
  if (driver?.pid && driver.exitCode === null) {
    const closed = new Promise((done) => driver.once("exit", done));
    try { process.kill(-driver.pid, "SIGTERM"); } catch (error) {
      if (error.code !== "ESRCH") throw error;
    }
    await Promise.race([closed, sleep(5_000)]);
    if (driver.exitCode === null) {
      try { process.kill(-driver.pid, "SIGKILL"); } catch (error) {
        if (error.code !== "ESRCH") throw error;
      }
    }
  }
  driver = undefined;
}
async function reactionControl() {
  const inputs = await command("POST", "/elements", {
    using: "css selector", value: 'input[aria-label="할 일 캐릭터 반응"]',
  });
  for (const input of inputs) {
    const id = input["element-6066-11e4-a52e-4f735466cecf"];
    const fieldId = await command("GET", `/element/${id}/attribute/id`);
    const label = fieldId && await findVisible(`label[for="${fieldId}"]`);
    if (label) return { id, label };
  }
  return null;
}
async function openSettings() {
  await invoke("open_widgets");
  await switchToView("settings");
  await waitFor(reactionControl, "todo reaction switch");
}
async function setReaction(enabled) {
  const control = await waitFor(reactionControl, "todo reaction switch");
  const selected = await command("GET", `/element/${control.id}/selected`);
  if (selected !== enabled) {
    await command("POST", `/element/${control.label}/click`, {});
  }
  await waitFor(async () => (await snapshotTodo()).reaction === enabled, `reaction ${enabled}`);
  const current = await waitFor(reactionControl, "todo reaction switch");
  await waitFor(async () => (await command("GET", `/element/${current.id}/selected`)) === enabled, "switch state");
}
async function openTodo() {
  await click('button[aria-label^="할 일 "]');
  await switchToView("planner");
  await element('[aria-label="새 할 일"]');
}

try {
  for (const directory of ["data", "config", "cache", "runtime"]) {
    await mkdir(resolve(root, directory), { mode: 0o700 });
  }
  const title = `E2E 보존 ${Date.now()}`;
  await start();
  await openSettings();
  await setReaction(false);
  await openTodo();
  const input = await element('[aria-label="새 할 일"]');
  const keys = `${title}\uE007`;
  await command("POST", `/element/${input}/value`, { text: keys, value: Array.from(keys) });
  await waitFor(async () => (await snapshotTodo()).data.items.some((item) => item.title === title), "saved todo");
  await waitFor(() => execute("return document.body.innerText.includes(arguments[0])", [title]), "todo in planner");
  await stop();

  await start();
  await openSettings();
  assert.equal((await snapshotTodo()).reaction, false, "reaction preference must survive restart");
  const control = await waitFor(reactionControl, "todo reaction switch");
  assert.equal(await command("GET", `/element/${control.id}/selected`), false);
  await openTodo();
  await waitFor(() => execute("return document.body.innerText.includes(arguments[0])", [title]), "saved todo after restart");
  await switchToView("settings");
  await setReaction(true);
  assert.ok((await snapshotTodo()).data.items.some((item) => item.title === title));
  await stop();

  await start();
  await openSettings();
  assert.equal((await snapshotTodo()).reaction, true, "re-enabled preference must survive restart");
  const reenabled = await waitFor(reactionControl, "todo reaction switch");
  assert.equal(await command("GET", `/element/${reenabled.id}/selected`), true);
  await openTodo();
  await waitFor(() => execute("return document.body.innerText.includes(arguments[0])", [title]), "saved todo after re-enable");
  console.log("PASS: reaction toggle, widget use, and restart persistence");
} finally {
  await stop();
  await rm(root, { recursive: true, force: true });
}
