const FIGMA_FILE_KEY = "aWNznF6uo5AlqF0YokiXZY";
const GITHUB_REPOSITORY = "fleetia/comet";
const MAX_BODY_BYTES = 16 * 1024;

function respond(status, message) {
  return new Response(message, {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

async function readPayload(request) {
  if (!request.body) {
    throw new SyntaxError("Missing body");
  }

  const reader = request.body.getReader();
  const chunks = [];
  let byteLength = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      byteLength += value.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RangeError("Body too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}

async function verifyPasscode(expected, supplied) {
  const encoder = new TextEncoder();
  const expectedBytes = encoder.encode(expected);
  const key = await crypto.subtle.importKey(
    "raw",
    expectedBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, expectedBytes);
  // Delegate the fixed-size MAC comparison to WebCrypto rather than comparing secret strings.
  return crypto.subtle.verify("HMAC", key, signature, encoder.encode(supplied));
}

function normalizeTimestamp(value) {
  if (typeof value !== "string") {
    return null;
  }
  const match =
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.\d{1,9})?(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  const milliseconds = Date.parse(value);
  if (!match || !Number.isFinite(milliseconds)) {
    return null;
  }

  const offsetMinutes = match[2] === "Z" ? 0 : Number(match[4]) * 60 + Number(match[5]);
  const signedOffset = match[3] === "-" ? -offsetMinutes : offsetMinutes;
  const localDate = new Date(milliseconds + signedOffset * 60_000);
  if (localDate.toISOString().slice(0, 19) !== match[1]) {
    return null;
  }
  return new Date(milliseconds).toISOString();
}

async function handleRequest(request, env) {
  if (request.method !== "POST") {
    return respond(405, "POST required");
  }
  const contentType = request.headers.get("Content-Type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return respond(415, "JSON required");
  }
  const declaredLength = request.headers.get("Content-Length");
  if (declaredLength !== null && !/^\d+$/.test(declaredLength)) {
    return respond(400, "Invalid content length");
  }
  if (declaredLength !== null && Number(declaredLength) > MAX_BODY_BYTES) {
    return respond(413, "Body too large");
  }
  if (typeof env.FIGMA_WEBHOOK_PASSCODE !== "string" || !env.FIGMA_WEBHOOK_PASSCODE) {
    return respond(503, "Receiver is not configured");
  }

  let payload;
  try {
    payload = await readPayload(request);
  } catch (error) {
    return respond(error instanceof RangeError ? 413 : 400, "Invalid request body");
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return respond(400, "Invalid event");
  }
  if (
    typeof payload.passcode !== "string" ||
    !(await verifyPasscode(env.FIGMA_WEBHOOK_PASSCODE, payload.passcode))
  ) {
    return respond(401, "Unauthorized");
  }
  if (payload.event_type === "PING") {
    return respond(200, "Ready");
  }
  if (payload.file_key !== FIGMA_FILE_KEY) {
    return respond(400, "Unexpected file");
  }
  if (payload.event_type === "FILE_DELETE") {
    return respond(200, "Ignored");
  }
  if (payload.event_type !== "FILE_UPDATE") {
    return respond(400, "Unexpected event");
  }
  const timestamp = normalizeTimestamp(payload.timestamp);
  if (!timestamp) {
    return respond(400, "Invalid timestamp");
  }
  if (
    env.GITHUB_REPOSITORY !== GITHUB_REPOSITORY ||
    typeof env.GITHUB_DISPATCH_TOKEN !== "string" ||
    !env.GITHUB_DISPATCH_TOKEN
  ) {
    return respond(503, "Dispatch is not configured");
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${env.GITHUB_REPOSITORY}/actions/workflows/figma-sync.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
          "Content-Type": "application/json",
          "User-Agent": "comet-figma-webhook",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ ref: "main", inputs: { figma_timestamp: timestamp } }),
        redirect: "error",
        signal: AbortSignal.timeout(8_000),
      },
    );
    return response.status === 204 ? respond(200, "Accepted") : respond(502, "Dispatch failed");
  } catch {
    return respond(502, "Dispatch failed");
  }
}

export default { fetch: handleRequest };
