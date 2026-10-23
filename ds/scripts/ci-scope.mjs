import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const COMMIT_SHA = /^(?!0{40}$)[0-9a-f]{40}$/;
const FULL_SCOPE = { dsOnly: false, nativeRequired: true, bundleRequired: true };
const SCOPE_SCRIPT = "ds/scripts/ci-scope.mjs";
const SHARED_NATIVE_FILES = new Set([
  "apps/comet/src/widgets/desktopKinds.json",
  "apps/comet/src/widgets/Travel/travelMoney.fixtures.json",
]);
const FRONTEND_PATHS = [
  /^ds\//,
  /^apps\/comet\/(src|public)\//,
  /^apps\/comet\/(index\.html|vite\.config\.ts|tsconfig(?:\.[^/]+)?\.json)$/,
  /^(tsconfig\.json|vitest\.[^/]+\.config\.ts)$/,
  /^\.changeset\/[^/]+\.md$/,
  /^[^/]+\.md$/,
  /^LICENSE$/,
];
const NATIVE_PATHS = [
  /^apps\/comet\/src-tauri\/(src|native|content|story|examples|tests)\//,
  /^apps\/comet\/crates\/[^/]+\/(src|tests|examples)\//,
  /^apps\/comet\/(talk|integrations|widgets|character-packs|nlp|resources)\//,
];

export function getComparison(eventName, event) {
  const isPullRequest = eventName === "pull_request";
  if (!isPullRequest && eventName !== "push") {
    return null;
  }

  const base = isPullRequest ? event?.pull_request?.base?.sha : event?.before;
  const head = isPullRequest ? event?.pull_request?.head?.sha : event?.after;
  if (!COMMIT_SHA.test(base ?? "") || !COMMIT_SHA.test(head ?? "")) {
    return null;
  }

  return `${base}${isPullRequest ? "..." : ".."}${head}`;
}

export function arePathsDsOnly(paths) {
  return (
    paths.length > 0 &&
    paths.every(
      (path) => path !== SCOPE_SCRIPT && (path.startsWith("ds/") || path === "vitest.ds.config.ts"),
    )
  );
}

export function classifyPaths(paths) {
  if (paths.length === 0) {
    return FULL_SCOPE;
  }

  const dsOnly = arePathsDsOnly(paths);
  const nativePaths = new Set(
    paths.filter(
      (path) => SHARED_NATIVE_FILES.has(path) || NATIVE_PATHS.some((pattern) => pattern.test(path)),
    ),
  );
  const bundleRequired = paths.some(
    (path) =>
      path === SCOPE_SCRIPT ||
      (!nativePaths.has(path) && !FRONTEND_PATHS.some((pattern) => pattern.test(path))),
  );

  return { dsOnly, nativeRequired: bundleRequired || nativePaths.size > 0, bundleRequired };
}

export function getChangeScope(eventName, event, cwd = process.cwd()) {
  const comparison = getComparison(eventName, event);
  if (!comparison) {
    return FULL_SCOPE;
  }

  try {
    const output = execFileSync(
      "git",
      ["diff", "--name-only", "--no-renames", "-z", comparison, "--"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 },
    );
    if (!output.endsWith("\0")) {
      return FULL_SCOPE;
    }
    return classifyPaths(output.slice(0, -1).split("\0"));
  } catch {
    return FULL_SCOPE;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let scope = FULL_SCOPE;
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    scope = getChangeScope(process.env.GITHUB_EVENT_NAME, event);
  } catch {
    // Missing or malformed event data must keep the full verification path.
  }
  process.stdout.write(
    `ds_only=${scope.dsOnly}\nnative_required=${scope.nativeRequired}\nbundle_required=${scope.bundleRequired}\n`,
  );
}
