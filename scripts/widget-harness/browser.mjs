import { runWidget } from "./sandbox.js";
import fixtures from "./fixtures.js";

const results = [];
const display = document.querySelector("pre");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function same(actual, expected, message) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), message);
}

async function check(id, execute) {
  const start = performance.now();
  try {
    const observed = await execute();
    assert(document.querySelectorAll("iframe").length === 0, "Execution iframe leaked");
    results.push({
      id,
      status: "pass",
      elapsedMs: Math.round(performance.now() - start),
      observed,
    });
  } catch (error) {
    results.push({
      id,
      status: "fail",
      elapsedMs: Math.round(performance.now() - start),
      error: String(error.message).slice(0, 500),
    });
  }
  display.textContent = results
    .map(
      (result) =>
        `${result.status.toUpperCase()} ${result.id}${result.error ? `: ${result.error}` : ""}`,
    )
    .join("\n");
}

for (const fixture of fixtures.failures) {
  await check(fixture.id, async () => {
    const state = structuredClone(fixtures.state);
    let diagnostic;
    try {
      await runWidget(fixture.source, state, fixture.action);
    } catch (error) {
      diagnostic = error.message;
    }
    assert(
      typeof diagnostic === "string" && diagnostic.includes(fixture.diagnosticIncludes),
      `Expected specific diagnostic containing ${fixture.diagnosticIncludes}; got ${diagnostic ?? "success"}`,
    );
    assert(diagnostic.length <= 300, "Diagnostic exceeds the model feedback bound");
    same(state, fixtures.state, "Failed code changed the original state");
    const repaired = await runWidget(fixtures.repair.source, state, null);
    same(repaired.state, fixtures.state, "Repair reset existing state to initialState");
    const acted = await runWidget(fixtures.repair.source, repaired.state, { type: "increment" });
    same(
      acted.state,
      { ...fixtures.state, count: fixtures.state.count + 1 },
      "Repaired action lost state fields",
    );
    return { diagnostic, preservedState: repaired.state, actionState: acted.state };
  });
}

await check("capabilities-and-prototypes", async () => {
  const source = `function reduce(state) { return state; }
function render() {
  const names = ['Worker','SharedWorker','importScripts','fetch','XMLHttpRequest','WebSocket','EventSource','WebTransport','RTCPeerConnection','BroadcastChannel','indexedDB','caches','navigator','postMessage'];
  const exposed = [];
  for (let target = self; target; target = Object.getPrototypeOf(target)) {
    for (const name of names) if (Object.hasOwn(target,name) && target[name] !== undefined) exposed.push(name);
  }
  return [{type:'text',value:exposed.join(',')}];
}`;
  const value = await runWidget(source, {}, null);
  assert(value.view[0].value === "", `Exposed worker capabilities: ${value.view[0].value}`);
  return { exposed: value.view[0].value };
});

await check("constructor-eval-blocked", async () => {
  const value = await runWidget(
    `function reduce(state) { return state; }
function render() { let blocked = false; try { (()=>{}).constructor('return self')(); } catch (_) { blocked = true; } return [{type:'text',value:String(blocked)}]; }`,
    {},
    null,
  );
  assert(value.view[0].value === "true", "Function constructor bypassed CSP");
  return { blocked: true };
});

await check("bounded-runtime", async () => {
  let diagnostic;
  const start = performance.now();
  try {
    await runWidget(
      "function reduce(state){return state} function render(){while(true){}}",
      {},
      null,
    );
  } catch (error) {
    diagnostic = error.message;
  }
  assert(diagnostic?.includes("1초"), `Expected execution timeout, got ${diagnostic ?? "success"}`);
  assert(performance.now() - start < 3000, "Timeout failed to stop the invocation promptly");
  return { diagnostic };
});

await check("abort-cleans-execution", async () => {
  const controller = new AbortController();
  const pending = runWidget(
    "function reduce(state){return state} function render(){while(true){}}",
    {},
    null,
    Date.now(),
    controller.signal,
  );
  setTimeout(() => controller.abort(), 30);
  let name;
  try {
    await pending;
  } catch (error) {
    name = error.name;
  }
  assert(name === "AbortError", `Expected cancellation, got ${name ?? "success"}`);
  return { name };
});

const report = { version: 1, userAgent: navigator.userAgent, results };
// A same-origin form preserves the application's connect-src without adding a fetch permission.
const form = document.createElement("form");
form.method = "POST";
form.action = "./report";
const payload = document.createElement("input");
payload.type = "hidden";
payload.name = "report";
payload.value = JSON.stringify(report);
form.append(payload);
document.body.append(form);
form.submit();
