import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transformWithEsbuild } from "vite";

const root = fileURLToPath(new URL("../../", import.meta.url));
const read = (path) => readFile(resolve(root, path), "utf8");
const [runtime, browser, fixtureText, configText] = await Promise.all([
  read("src/widgets/GeneratedWidgets/sandbox.ts"),
  read("scripts/widget-harness/browser.mjs"),
  read("scripts/widget-harness/fixtures.json"),
  read("src-tauri/tauri.conf.json"),
]);
const fixtures = JSON.parse(fixtureText);
const csp = JSON.parse(configText).app.security.csp;
const compiled = await transformWithEsbuild(runtime, "sandbox.ts", {
  loader: "ts",
  target: "es2022",
});
const prefix = `/${randomUUID()}/`;
const hash = (value) => createHash("sha256").update(value).digest("hex");
const expected = [
  ...fixtures.failures.map(({ id }) => id),
  "capabilities-and-prototypes",
  "constructor-eval-blocked",
  "bounded-runtime",
  "abort-cleans-execution",
];
const outputPath = resolve(
  root,
  "test-results/widget-harness",
  `${new Date().toISOString().replaceAll(":", "-")}.json`,
);
const escape = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const page = `<!doctype html><meta charset="utf-8"><title>Comet widget harness</title><h1>Comet widget harness</h1><p>실제 브라우저의 격리 실행환경을 검사하고 있습니다.</p><pre>Running</pre><script type="module" src="./browser.js"></script>`;
const routes = new Map([
  [prefix, ["text/html", page]],
  [`${prefix}browser.js`, ["text/javascript", browser]],
  [`${prefix}sandbox.js`, ["text/javascript", compiled.code]],
  [`${prefix}fixtures.js`, ["text/javascript", `export default ${JSON.stringify(fixtures)};`]],
]);
let origin;
let reporting = false;
let finish;
const done = new Promise((resolveDone) => {
  finish = resolveDone;
});
const server = createServer(async (request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", csp);
  response.setHeader("X-Content-Type-Options", "nosniff");
  if (request.method === "GET" && routes.has(request.url)) {
    const [type, body] = routes.get(request.url);
    response.writeHead(200, { "Content-Type": `${type}; charset=utf-8` }).end(body);
    return;
  }
  if (
    request.method !== "POST" ||
    request.url !== `${prefix}report` ||
    request.headers.origin !== origin ||
    reporting
  ) {
    response.writeHead(404).end("Not found");
    return;
  }
  reporting = true;
  try {
    let body = "";
    for await (const chunk of request) {
      body += chunk.toString("utf8");
      if (Buffer.byteLength(body) > 256 * 1024) throw new Error("Report exceeds 256KiB");
    }
    const report = JSON.parse(new URLSearchParams(body).get("report"));
    if (
      report?.version !== 1 ||
      !Array.isArray(report.results) ||
      typeof report.userAgent !== "string"
    )
      throw new Error("Invalid report");
    const ids = report.results.map(({ id }) => id);
    if (
      JSON.stringify(ids) !== JSON.stringify(expected) ||
      report.results.some(({ status }) => status !== "pass" && status !== "fail")
    )
      throw new Error("Incomplete report");
    const passed = report.results.every(({ status }) => status === "pass");
    const evidence = {
      ...report,
      passed,
      recordedAt: new Date().toISOString(),
      runtimeSha256: hash(runtime),
      fixturesSha256: hash(fixtureText),
      parentCsp: csp,
      scope:
        "Real browser sandbox and deterministic repair fixtures; no model inference, Tauri IPC or native WebView proof.",
    };
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    const summary = report.results
      .map(({ id, status, error }) => `${status.toUpperCase()} ${id}${error ? `: ${error}` : ""}`)
      .join("\n");
    response
      .writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
      .end(
        `<!doctype html><meta charset="utf-8"><title>Widget harness result</title><h1>${passed ? "PASS" : "FAIL"}</h1><pre>${escape(summary)}</pre><p>JSON report saved by the local runner.</p>`,
      );
    console.log(summary);
    console.log(`Report: ${outputPath}`);
    finish(passed ? 0 : 1);
  } catch (error) {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end(error.message);
    console.error(error.message);
    finish(1);
  }
});
server.listen(0, "127.0.0.1", () => {
  origin = `http://127.0.0.1:${server.address().port}`;
  console.log(`Open with CUA or a browser: ${origin}${prefix}`);
  console.log(
    "Waiting up to five minutes for the browser report. No browser is launched by this command.",
  );
});
server.on("error", (error) => {
  console.error(error.message);
  finish(1);
});
const timeout = setTimeout(() => {
  console.error("No browser report received. This run is not a passing browser check.");
  finish(1);
}, 300_000);
process.once("SIGINT", () => finish(130));
process.once("SIGTERM", () => finish(143));
process.exitCode = await done;
clearTimeout(timeout);
server.close();
