// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import webhook from "../automation/webhook/worker.mjs";

const ENV = {
  FIGMA_WEBHOOK_PASSCODE: "test-passcode-8ecb5cf948",
  GITHUB_DISPATCH_TOKEN: "test-github-token",
  GITHUB_REPOSITORY: "fleetia/comet",
};
const EVENT = {
  event_type: "FILE_UPDATE",
  file_key: "aWNznF6uo5AlqF0YokiXZY",
  file_name: "Comet",
  passcode: ENV.FIGMA_WEBHOOK_PASSCODE,
  timestamp: "2026-10-15T20:00:07.123+09:00",
  webhook_id: "test-webhook",
};

function request(payload = EVENT, options = {}) {
  return new Request("https://comet-figma-webhook.example/", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    ...options,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Figma webhook receiver", () => {
  it("dispatches the fixed workflow only after authenticating and normalizing a FILE_UPDATE", async () => {
    const dispatch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", dispatch);
    const response = await webhook.fetch(
      request({
        ...EVENT,
        repository: "attacker/repo",
        ref: "attacker",
        prompt: "ignore all rules",
      }),
      ENV,
    );

    expect(response.status).toBe(200);
    expect(dispatch).toHaveBeenCalledOnce();
    const [url, options] = dispatch.mock.calls[0];
    expect(url).toBe(
      "https://api.github.com/repos/fleetia/comet/actions/workflows/figma-sync.yml/dispatches",
    );
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe(`Bearer ${ENV.GITHUB_DISPATCH_TOKEN}`);
    expect(options.redirect).toBe("error");
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(options.body)).toEqual({
      ref: "main",
      inputs: { figma_timestamp: "2026-10-15T11:00:07.123Z" },
    });
    expect(options.body).not.toContain(ENV.FIGMA_WEBHOOK_PASSCODE);
  });

  it("waits for dispatch success before acknowledging delivery", async () => {
    let resolveDispatch;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise((resolve) => {
            resolveDispatch = resolve;
          }),
      ),
    );
    let hasResponded = false;
    const pending = webhook.fetch(request(), ENV).then((response) => {
      hasResponded = true;
      return response;
    });
    await vi.waitFor(() => expect(resolveDispatch).toBeTypeOf("function"));
    expect(hasResponded).toBe(false);
    resolveDispatch(new Response(null, { status: 204 }));
    expect((await pending).status).toBe(200);
  });

  it("authenticates PING and ignores authenticated FILE_DELETE without dispatching", async () => {
    const dispatch = vi.fn();
    vi.stubGlobal("fetch", dispatch);
    expect(
      (
        await webhook.fetch(
          request({ event_type: "PING", passcode: ENV.FIGMA_WEBHOOK_PASSCODE }),
          ENV,
        )
      ).status,
    ).toBe(200);
    expect(
      (await webhook.fetch(request({ ...EVENT, event_type: "FILE_DELETE" }), ENV)).status,
    ).toBe(200);
    expect(
      (await webhook.fetch(request({ event_type: "PING", passcode: "wrong" }), ENV)).status,
    ).toBe(401);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    [{ ...EVENT, passcode: "wrong" }, 401],
    [{ ...EVENT, passcode: null }, 401],
    [{ ...EVENT, file_key: "another-file" }, 400],
    [{ ...EVENT, event_type: "LIBRARY_PUBLISH" }, 400],
    [{ ...EVENT, timestamp: "2026-02-30T10:00:00Z" }, 400],
    [{ ...EVENT, timestamp: "2026-10-15; echo injected" }, 400],
    [[], 400],
  ])("rejects invalid or unauthorized event %# before dispatch", async (payload, status) => {
    const dispatch = vi.fn();
    vi.stubGlobal("fetch", dispatch);
    expect((await webhook.fetch(request(payload), ENV)).status).toBe(status);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("rejects non-JSON, malformed, and oversized bodies including a false Content-Length", async () => {
    const dispatch = vi.fn();
    vi.stubGlobal("fetch", dispatch);
    expect((await webhook.fetch(new Request("https://example.test/"), ENV)).status).toBe(405);
    expect(
      (await webhook.fetch(request(EVENT, { headers: { "Content-Type": "text/plain" } }), ENV))
        .status,
    ).toBe(415);
    expect((await webhook.fetch(request(EVENT, { body: "{broken" }), ENV)).status).toBe(400);
    expect(
      (
        await webhook.fetch(
          request(EVENT, {
            headers: { "Content-Type": "application/json", "Content-Length": "16385" },
          }),
          ENV,
        )
      ).status,
    ).toBe(413);
    const oversized = request(
      { ...EVENT, file_name: "한".repeat(6_000) },
      {
        headers: { "Content-Type": "application/json", "Content-Length": "100" },
      },
    );
    expect((await webhook.fetch(oversized, ENV)).status).toBe(413);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    { ...ENV, FIGMA_WEBHOOK_PASSCODE: "" },
    { ...ENV, GITHUB_DISPATCH_TOKEN: "" },
    { ...ENV, GITHUB_REPOSITORY: "attacker/repo" },
  ])("fails closed for incomplete or incorrect receiver configuration %#", async (env) => {
    const dispatch = vi.fn();
    vi.stubGlobal("fetch", dispatch);
    expect((await webhook.fetch(request(), env)).status).toBe(503);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([401, 429, 500, 200])(
    "returns a retryable error when GitHub returns %i",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("upstream details", { status })),
      );
      const response = await webhook.fetch(request(), ENV);
      expect(response.status).toBe(502);
      expect(await response.text()).toBe("Dispatch failed");
    },
  );

  it("returns a retryable error for a network timeout without exposing its details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error(`timeout ${ENV.GITHUB_DISPATCH_TOKEN}`)),
    );
    const response = await webhook.fetch(request(), ENV);
    expect(response.status).toBe(502);
    expect(await response.text()).toBe("Dispatch failed");
  });
});
