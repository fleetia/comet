import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { runWidget } from "./sandbox";

const SOURCE =
  'function render(state) { return [{type:"number",value:state.count}]; } function reduce(state) { return {count:state.count+1}; }';

function pendingFrame(): { frame: HTMLIFrameElement; nonce: string; source: Window } {
  const frame = document.querySelector("iframe");
  if (!frame?.contentWindow) throw new Error("sandbox iframe missing");
  const nonce = /<script nonce="([^"]+)"/.exec(frame.srcdoc)?.[1];
  if (!nonce) throw new Error("sandbox nonce missing");
  return { frame, nonce, source: frame.contentWindow };
}

function message(
  frame: ReturnType<typeof pendingFrame>,
  type: string,
  payload?: string,
  overrides: MessageEventInit = {},
): void {
  window.dispatchEvent(
    new MessageEvent("message", {
      source: frame.source,
      origin: "null",
      data: { type, nonce: frame.nonce, payload },
      ...overrides,
    }),
  );
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

it("runs only after an authenticated ready message and returns validated JSON", async () => {
  const promise = runWidget(SOURCE, { count: 0 }, { type: "increment" }, 123);
  const sandbox = pendingFrame();
  const send = vi.spyOn(sandbox.source, "postMessage").mockImplementation(() => {});
  const payload = JSON.stringify({ state: { count: 1 }, view: [{ type: "number", value: 1 }] });
  message(sandbox, "comet-widget-result", payload);
  message(sandbox, "comet-widget-ready", undefined, { source: window });
  message(sandbox, "comet-widget-ready", undefined, { origin: "https://other.example" });
  message(sandbox, "comet-widget-ready", undefined, {
    data: { type: "comet-widget-ready", nonce: "wrong" },
  });
  expect(send).not.toHaveBeenCalled();
  message(sandbox, "comet-widget-ready");
  message(sandbox, "comet-widget-ready");
  expect(send).toHaveBeenCalledTimes(1);
  expect(send.mock.calls[0][0]).toEqual({
    type: "comet-widget-run",
    nonce: sandbox.nonce,
    payload: JSON.stringify({
      source: SOURCE,
      state: { count: 0 },
      action: { type: "increment" },
      now: 123,
    }),
  });
  expect(send.mock.calls[0][1]).toBe("*");
  message(sandbox, "comet-widget-result", payload);
  await expect(promise).resolves.toEqual(JSON.parse(payload));
  expect(document.querySelector("iframe")).toBeNull();
});

it("keeps source out of HTML and grants scripts alone to an opaque frame", async () => {
  const source = `${SOURCE}\n// </script><img src=https://outside.example>`;
  const controller = new AbortController();
  const promise = runWidget(source, {}, null, 123, controller.signal);
  const sandbox = pendingFrame();
  expect(sandbox.frame.getAttribute("sandbox")).toBe("allow-scripts");
  expect(sandbox.frame.srcdoc).not.toContain("outside.example");
  expect(sandbox.frame.srcdoc).toContain("connect-src 'none'");
  expect(sandbox.frame.srcdoc).toContain("worker-src blob:");
  expect(sandbox.frame.srcdoc).not.toContain("unsafe-eval");
  expect(sandbox.frame.srcdoc).not.toContain("allow-same-origin");
  const rejection = expect(promise).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejection;
});

it.each([
  '{"state":{"__proto__":{"polluted":true}},"view":[]}',
  '{"state":{"nested":{"constructor":{}}},"view":[]}',
  '{"state":{},"view":[{"type":"html","value":"<script>"}]}',
  '{"state":{},"view":[{"type":"text","value":"ok","onClick":"alert(1)"}]}',
  '{"state":{},"view":[{"type":"button","label":"Run"}]}',
  '{"state":{},"view":[{"type":"number","value":"text"}]}',
  '{"state":{},"view":[{"type":"progress","value":4,"min":10,"max":1}]}',
  JSON.stringify({
    state: {},
    view: Array.from({ length: 129 }, () => ({ type: "text", value: "x" })),
  }),
  JSON.stringify({ state: { text: "가".repeat(24_000) }, view: [] }),
])("rejects untrusted output outside the JSON and node contract: %s", async (payload) => {
  const promise = runWidget(SOURCE, {}, null);
  const sandbox = pendingFrame();
  vi.spyOn(sandbox.source, "postMessage").mockImplementation(() => {});
  message(sandbox, "comet-widget-ready");
  message(sandbox, "comet-widget-result", payload);
  await expect(promise).rejects.toBeInstanceOf(Error);
  expect(document.querySelector("iframe")).toBeNull();
});

it("rejects oversized or prototype-bearing input before creating an execution frame", async () => {
  await expect(runWidget(SOURCE, { text: "가".repeat(24_000) }, null)).rejects.toThrow("64KiB");
  await expect(runWidget("x".repeat(48 * 1024 + 1), {}, null)).rejects.toThrow("48KiB");
  await expect(runWidget(SOURCE, {}, { text: "x".repeat(4 * 1024) })).rejects.toThrow("4KiB");
  await expect(runWidget(SOURCE, JSON.parse('{"prototype":{}}'), null)).rejects.toThrow("키");
  expect(document.querySelector("iframe")).toBeNull();
});

it("ends unresponsive code at one second and removes its bridge", async () => {
  const promise = runWidget(SOURCE, {}, null);
  const sandbox = pendingFrame();
  vi.spyOn(sandbox.source, "postMessage").mockImplementation(() => {});
  message(sandbox, "comet-widget-ready");
  const rejection = expect(promise).rejects.toThrow("1초");
  vi.advanceTimersByTime(1_000);
  await rejection;
  expect(document.querySelector("iframe")).toBeNull();
  message(sandbox, "comet-widget-result", JSON.stringify({ state: {}, view: [] }));
});

it("uses a fresh nonce and rejects results from another invocation", async () => {
  const firstController = new AbortController();
  const first = runWidget(SOURCE, {}, null, 0, firstController.signal);
  const firstFrame = pendingFrame();
  const firstRejected = expect(first).rejects.toMatchObject({ name: "AbortError" });
  firstController.abort();
  await firstRejected;
  const second = runWidget(SOURCE, {}, null);
  const secondFrame = pendingFrame();
  expect(secondFrame.nonce).not.toBe(firstFrame.nonce);
  vi.spyOn(secondFrame.source, "postMessage").mockImplementation(() => {});
  message(secondFrame, "comet-widget-ready");
  message(firstFrame, "comet-widget-result", JSON.stringify({ state: { forged: true }, view: [] }));
  message(secondFrame, "comet-widget-result", JSON.stringify({ state: { valid: true }, view: [] }));
  await expect(second).resolves.toEqual({ state: { valid: true }, view: [] });
});

it("keeps the fixed bootstrap aligned with its pinned CSP hash", async () => {
  const controller = new AbortController();
  const promise = runWidget(SOURCE, {}, null, 0, controller.signal);
  const { frame } = pendingFrame();
  const script = new DOMParser().parseFromString(frame.srcdoc, "text/html").querySelector("script");
  const { webcrypto } = await vi.importActual<{ webcrypto: Crypto }>("node:crypto");
  const digest = await webcrypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(script?.textContent ?? ""),
  );
  const hash = btoa(String.fromCharCode(...new Uint8Array(digest)));
  expect(hash).toBe("fFL/ZftddjzVuHfKF+sGLW/W0kTQE6hYABVQE2h9qyw=");
  const rejection = expect(promise).rejects.toMatchObject({ name: "AbortError" });
  controller.abort();
  await rejection;
});

it("transfers a valid 48KiB source and 64KiB state within the separate 128KiB input limit", async () => {
  const source = `${SOURCE}\n/*${"x".repeat(48 * 1024 - SOURCE.length - 5)}*/`;
  const state = { text: "x".repeat(64 * 1024 - JSON.stringify({ text: "" }).length) };
  const promise = runWidget(source, state, { type: "inspect" }, 123);
  const sandbox = pendingFrame();
  const send = vi.spyOn(sandbox.source, "postMessage").mockImplementation(() => {});
  message(sandbox, "comet-widget-ready");
  expect(send).toHaveBeenCalledTimes(1);
  const packet = send.mock.calls[0][0] as { payload: string };
  expect(JSON.parse(packet.payload)).toEqual({
    source,
    state,
    action: { type: "inspect" },
    now: 123,
  });
  expect(new TextEncoder().encode(packet.payload).byteLength).toBeGreaterThan(64 * 1024);
  expect(new TextEncoder().encode(packet.payload).byteLength).toBeLessThanOrEqual(128 * 1024);
  message(sandbox, "comet-widget-result", JSON.stringify({ state: { count: 1 }, view: [] }));
  await expect(promise).resolves.toEqual({ state: { count: 1 }, view: [] });
});

it("reports bounded load, render and reduce error messages without reading their stacks", async () => {
  const promise = runWidget(SOURCE, {}, null);
  const sandbox = pendingFrame();
  const script = new DOMParser()
    .parseFromString(sandbox.frame.srcdoc, "text/html")
    .querySelector("script");
  const workerMain = /  function workerMain\(\) \{[\s\S]*?\n  \}/.exec(
    script?.textContent ?? "",
  )?.[0];
  if (!workerMain) throw new Error("worker bootstrap missing");
  const { runInNewContext } = await vi.importActual<{
    runInNewContext: (source: string, context: Record<string, unknown>) => void;
  }>("node:vm");
  let reported = "";
  for (const phase of ["load", "render", "reduce"]) {
    const failure = new Error(`${phase} failed: ${"x".repeat(400)}`);
    Object.defineProperty(failure, "stack", {
      get: () => {
        throw new Error("stack must stay private");
      },
    });
    const send = vi.fn();
    const scope: Record<string, unknown> = {
      postMessage: send,
      importScripts: () => {
        if (phase === "load") throw failure;
      },
      render: () => {
        if (phase === "render") throw failure;
        return [];
      },
      reduce: () => {
        if (phase === "reduce") throw failure;
        return {};
      },
    };
    runInNewContext(`(${workerMain})();`, { self: scope, TextEncoder });
    const receive = scope.onmessage as (event: { data: unknown }) => void;
    receive({ data: { url: "source.js", state: {}, action: { type: "test" }, now: 0 } });
    reported = failure.message.slice(0, 300);
    expect(send).toHaveBeenCalledExactlyOnceWith({ type: "comet-widget-error", error: reported });
  }
  vi.spyOn(sandbox.source, "postMessage").mockImplementation(() => {});
  message(sandbox, "comet-widget-ready");
  message(sandbox, "comet-widget-error", reported);
  await expect(promise).rejects.toThrow(reported);
  expect(document.querySelector("iframe")).toBeNull();
});

it("requires an object state and safe numeric values before results can reach storage", async () => {
  for (const state of [null, [], 3, "text", { count: 1e30 }, { nested: [-1e30] }]) {
    const promise = runWidget(SOURCE, {}, null);
    const sandbox = pendingFrame();
    vi.spyOn(sandbox.source, "postMessage").mockImplementation(() => {});
    message(sandbox, "comet-widget-ready");
    message(sandbox, "comet-widget-result", JSON.stringify({ state, view: [] }));
    await expect(promise).rejects.toBeInstanceOf(Error);
  }
  const promise = runWidget(SOURCE, {}, null);
  const sandbox = pendingFrame();
  vi.spyOn(sandbox.source, "postMessage").mockImplementation(() => {});
  message(sandbox, "comet-widget-ready");
  const result = {
    state: { positive: Number.MAX_SAFE_INTEGER, negative: -Number.MAX_SAFE_INTEGER, fraction: 0.5 },
    view: [],
  };
  message(sandbox, "comet-widget-result", JSON.stringify(result));
  await expect(promise).resolves.toEqual(result);
  expect(document.querySelector("iframe")).toBeNull();
});
