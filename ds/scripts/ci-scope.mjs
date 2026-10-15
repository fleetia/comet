import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const COMMIT_SHA = /^(?!0{40}$)[0-9a-f]{40}$/;

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
    paths.every((path) => path.startsWith("ds/") || path === "vitest.ds.config.ts")
  );
}

export function isDsOnlyChange(eventName, event, cwd = process.cwd()) {
  const comparison = getComparison(eventName, event);
  if (!comparison) {
    return false;
  }

  try {
    const output = execFileSync(
      "git",
      ["diff", "--name-only", "--no-renames", "-z", comparison, "--"],
      { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 },
    );
    if (!output.endsWith("\0")) {
      return false;
    }
    return arePathsDsOnly(output.slice(0, -1).split("\0"));
  } catch {
    return false;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  let dsOnly = false;
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    dsOnly = isDsOnlyChange(process.env.GITHUB_EVENT_NAME, event);
  } catch {
    // Missing or malformed event data must keep the full verification path.
  }
  process.stdout.write(`ds_only=${dsOnly}\n`);
}
