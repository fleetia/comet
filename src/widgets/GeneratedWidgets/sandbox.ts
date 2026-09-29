import type { WidgetValue } from "../types";

export type WidgetNode = {
  type: "text" | "number" | "button" | "input" | "progress";
  label?: string;
  value?: string | number;
  action?: string;
  min?: number;
  max?: number;
};
export type WidgetResult = { state: WidgetValue; view: WidgetNode[] };

const MAX_INPUT_BYTES = 128 * 1024;
const MAX_SOURCE_BYTES = 48 * 1024;
const MAX_STATE_BYTES = 64 * 1024;
const MAX_ACTION_BYTES = 4 * 1024;
const MAX_RESULT_BYTES = 64 * 1024;
const MAX_NODES = 128;
const MAX_DURATION_MS = 1_000;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const NODE_KEYS = new Set(["type", "label", "value", "action", "min", "max"]);

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function checkJson(value: unknown, depth = 0, budget = { remaining: 4_096 }): void {
  if (depth > 16 || --budget.remaining < 0) throw new Error("위젯 상태가 너무 복잡해요.");
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)
      throw new Error("위젯 숫자는 안전한 숫자 범위 안에 있어야 해요.");
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) checkJson(item, depth + 1, budget);
    return;
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error("위젯은 JSON 상태만 저장할 수 있어요.");
  }
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error("위젯 상태에 허용되지 않은 키가 있어요.");
    checkJson(item, depth + 1, budget);
  }
}

function checkJsonSize(value: unknown, maxBytes: number, error: string): void {
  checkJson(value);
  const serialized = JSON.stringify(value);
  if (byteLength(serialized) > maxBytes) throw new Error(error);
}

function readResult(payload: unknown): WidgetResult {
  if (typeof payload !== "string" || byteLength(payload) > MAX_RESULT_BYTES) {
    throw new Error("위젯 결과가 허용 크기를 넘었어요.");
  }
  const result: unknown = JSON.parse(payload);
  checkJson(result);
  if (!result || typeof result !== "object" || Array.isArray(result))
    throw new Error("위젯 결과 형식이 잘못됐어요.");
  const record = result as Record<string, unknown>;
  if (
    !record.state ||
    typeof record.state !== "object" ||
    Object.getPrototypeOf(record.state) !== Object.prototype
  ) {
    throw new Error("위젯 상태는 JSON 객체여야 해요.");
  }
  if (
    Object.keys(record).length !== 2 ||
    !("state" in record) ||
    !Array.isArray(record.view) ||
    record.view.length > MAX_NODES
  ) {
    throw new Error("위젯 화면은 128개 이하 항목이어야 해요.");
  }
  for (const value of record.view) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error("위젯 화면 항목이 잘못됐어요.");
    const node = value as Record<string, unknown>;
    if (
      Object.keys(node).some((key) => !NODE_KEYS.has(key)) ||
      !["text", "number", "button", "input", "progress"].includes(String(node.type))
    ) {
      throw new Error("지원하지 않는 위젯 화면 항목이에요.");
    }
    if (node.label !== undefined && (typeof node.label !== "string" || node.label.length > 256))
      throw new Error("위젯 표시 이름이 너무 길어요.");
    if (
      node.action !== undefined &&
      (typeof node.action !== "string" || !node.action.trim() || node.action.length > 80)
    )
      throw new Error("위젯 동작 이름이 잘못됐어요.");
    if (
      (node.type === "button" || node.type === "input") &&
      (typeof node.action !== "string" || typeof node.label !== "string" || !node.label.trim())
    )
      throw new Error("위젯 버튼과 입력란에는 이름과 동작이 필요해요.");
    if (
      node.value !== undefined &&
      typeof node.value !== "string" &&
      typeof node.value !== "number"
    )
      throw new Error("위젯 표시 값은 글자나 숫자여야 해요.");
    if (typeof node.value === "string" && node.value.length > 8_192)
      throw new Error("위젯 표시 내용이 너무 길어요.");
    if ((node.type === "number" || node.type === "progress") && typeof node.value !== "number")
      throw new Error("위젯 숫자 항목에 숫자가 필요해요.");
    for (const key of ["min", "max"] as const) {
      if (node[key] !== undefined && typeof node[key] !== "number")
        throw new Error("위젯 숫자 범위가 잘못됐어요.");
    }
    if (typeof node.min === "number" && typeof node.max === "number" && node.min >= node.max)
      throw new Error("위젯 숫자 범위가 잘못됐어요.");
  }
  return record as WidgetResult;
}

// This exact fixed script needs its SHA-256 in the application's script-src. Generated
// source is only transferred as data and is never interpolated into this document.
const BOOTSTRAP = String.raw`"use strict";
(() => {
  const script = document.currentScript;
  const nonce = script.nonce;
  const expectedOrigin = script.dataset.parentOrigin;
  const replyOrigin = expectedOrigin === "null" ? "*" : expectedOrigin;
  const maxInputBytes = 131072;
  const maxBytes = 65536;
  const size = value => new TextEncoder().encode(value).byteLength;
  let worker;
  let timer;
  let workerUrl;
  let sourceUrl;
  let finished = false;
  function cleanup() {
    clearTimeout(timer);
    if (worker) worker.terminate();
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    if (sourceUrl) URL.revokeObjectURL(sourceUrl);
  }
  function finish(type, payload) {
    if (finished) return;
    finished = true;
    cleanup();
    parent.postMessage({type, nonce, payload}, replyOrigin);
  }
  addEventListener("pagehide", cleanup, {once:true});
  function receive(event) {
    if (event.source !== parent || event.origin !== expectedOrigin) return;
    const envelope = event.data;
    if (!envelope || envelope.type !== "comet-widget-run" || envelope.nonce !== nonce) return;
    removeEventListener("message", receive);
    try {
      if (typeof envelope.payload !== "string" || size(envelope.payload) > maxInputBytes) throw new Error("위젯 입력 크기가 제한을 넘었어요.");
      const input = JSON.parse(envelope.payload);
      sourceUrl = URL.createObjectURL(new Blob([input.source], {type:"application/javascript"}));
      const workerCode = '"use strict";(' + workerMain.toString() + ')();';
      workerUrl = URL.createObjectURL(new Blob([workerCode], {type:"application/javascript"}));
      worker = new Worker(workerUrl);
      timer = setTimeout(() => finish("comet-widget-error", "위젯 실행이 1초 제한을 넘었어요."), 800);
      worker.onmessage = result => {
        if (result.data && typeof result.data === "object" && result.data.type === "comet-widget-error" && typeof result.data.error === "string" && result.data.error.length <= 300) {
          finish("comet-widget-error", result.data.error);
          return;
        }
        if (typeof result.data !== "string" || size(result.data) > maxBytes) {
          finish("comet-widget-error", "위젯 결과가 허용 크기를 넘었어요.");
          return;
        }
        finish("comet-widget-result", result.data);
      };
      worker.onerror = () => finish("comet-widget-error", "위젯 코드를 실행하지 못했어요.");
      worker.postMessage({url:sourceUrl,state:input.state,action:input.action,now:input.now});
    } catch (_) {
      finish("comet-widget-error", "위젯 실행 환경을 준비하지 못했어요.");
    }
  }
  function workerMain() {
    const scope = self;
    const send = scope.postMessage.bind(scope);
    const load = scope.importScripts.bind(scope);
    const stringify = JSON.stringify;
    const slice = String.prototype.slice.call.bind(String.prototype.slice);
    const encode = TextEncoder.prototype.encode.bind(new TextEncoder());
    const define = Object.defineProperty;
    const getPrototype = Object.getPrototypeOf;
    const hasOwn = Object.prototype.hasOwnProperty.call.bind(Object.prototype.hasOwnProperty);
    const blocked = ["Worker", "SharedWorker", "importScripts", "fetch", "XMLHttpRequest", "WebSocket", "EventSource", "WebTransport", "RTCPeerConnection", "BroadcastChannel", "indexedDB", "caches", "navigator", "postMessage"];
    for (const name of blocked) {
      for (let target = scope; target; target = getPrototype(target)) {
        if (hasOwn(target, name)) define(target, name, {value:undefined,writable:false,configurable:false});
      }
      define(scope, name, {value:undefined,writable:false,configurable:false});
    }
    scope.onmessage = event => {
      scope.onmessage = null;
      const input = event.data;
      try {
        load(input.url);
        if (typeof scope.render !== "function" || typeof scope.reduce !== "function") throw new Error("render와 reduce 함수가 필요해요.");
        const next = input.action === null ? input.state : scope.reduce(input.state, input.action, input.now);
        const view = scope.render(next, input.now);
        if ((next && typeof next.then === "function") || (view && typeof view.then === "function")) throw new Error("위젯 함수는 동기 함수여야 해요.");
        const result = stringify({state:next,view});
        if (typeof result !== "string" || encode(result).byteLength > 65536) throw new Error("위젯 결과가 너무 커요.");
        send(result);
      } catch (cause) {
        let error = "위젯 코드를 실행하지 못했어요.";
        try {
          if (typeof cause === "string") error = cause;
          else if (cause && typeof cause.message === "string") error = cause.message;
        } catch (_) {}
        send({type:"comet-widget-error",error:slice(error,0,300)});
      }
    };
  }
  addEventListener("message", receive);
  parent.postMessage({type:"comet-widget-ready",nonce}, replyOrigin);
})();`;

function attribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export async function runWidget(
  source: string,
  state: WidgetValue,
  action: WidgetValue | null,
  now = Date.now(),
  signal?: AbortSignal,
): Promise<WidgetResult> {
  if (signal?.aborted) throw new DOMException("위젯 실행을 취소했어요.", "AbortError");
  if (!source.trim() || !Number.isFinite(now))
    throw new Error("위젯 코드와 실행 시각을 확인해 주세요.");
  if (byteLength(source) > MAX_SOURCE_BYTES) throw new Error("위젯 코드는 48KiB 이하여야 해요.");
  checkJsonSize(state, MAX_STATE_BYTES, "위젯 상태는 64KiB 이하여야 해요.");
  checkJsonSize(action, MAX_ACTION_BYTES, "위젯 동작 입력은 4KiB 이하여야 해요.");
  const input = JSON.stringify({ source, state, action, now });
  if (byteLength(input) > MAX_INPUT_BYTES)
    throw new Error("위젯 전체 입력은 128KiB 이하여야 해요.");
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const frame = document.createElement("iframe");
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("aria-hidden", "true");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.hidden = true;
  const csp = `default-src 'none'; script-src 'nonce-${nonce}' blob:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'`;
  frame.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="${attribute(csp)}"><script nonce="${nonce}" data-parent-origin="${attribute(location.origin)}">${BOOTSTRAP}</script>`;
  return new Promise<WidgetResult>((resolve, reject) => {
    let settled = false;
    let started = false;
    const timer = window.setTimeout(
      () => finish(new Error("위젯 실행이 1초 제한을 넘었어요.")),
      MAX_DURATION_MS,
    );
    function finish(error?: Error, value?: WidgetResult): void {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", receive);
      signal?.removeEventListener("abort", abort);
      frame.remove();
      if (error) reject(error);
      else if (value) resolve(value);
    }
    function abort(): void {
      finish(new DOMException("위젯 실행을 취소했어요.", "AbortError"));
    }
    function receive(event: MessageEvent<unknown>): void {
      if (event.source !== frame.contentWindow || event.origin !== "null") return;
      const envelope = event.data;
      if (
        !envelope ||
        typeof envelope !== "object" ||
        !("nonce" in envelope) ||
        envelope.nonce !== nonce ||
        !("type" in envelope)
      )
        return;
      if (envelope.type === "comet-widget-ready" && !started) {
        started = true;
        frame.contentWindow?.postMessage({ type: "comet-widget-run", nonce, payload: input }, "*");
        return;
      }
      if (!started || !("payload" in envelope)) return;
      if (envelope.type === "comet-widget-result") {
        try {
          finish(undefined, readResult(envelope.payload));
        } catch (cause) {
          finish(cause instanceof Error ? cause : new Error("위젯 결과를 읽지 못했어요."));
        }
      } else if (envelope.type === "comet-widget-error") {
        finish(
          new Error(
            typeof envelope.payload === "string" && envelope.payload.length <= 300
              ? envelope.payload
              : "위젯을 실행하지 못했어요.",
          ),
        );
      }
    }
    window.addEventListener("message", receive);
    signal?.addEventListener("abort", abort, { once: true });
    try {
      document.body.append(frame);
    } catch (cause) {
      finish(cause instanceof Error ? cause : new Error("위젯 실행 공간을 열지 못했어요."));
    }
  });
}
