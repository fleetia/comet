// @vitest-environment node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  apply,
  bundle,
  dedupe,
  isAllowedPath,
  publish,
  validateExistingProposal,
  validateResult,
} from "./figma-proposal.mjs";
import { FILE_KEY } from "./figma-rest.mjs";

const roots = [];
const EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
const BASELINE = "ds/automation/figma-baseline.json";
const snapshot = {
  schemaVersion: 1,
  fileKey: FILE_KEY,
  entries: [{ id: "1:1", kind: "ui", hash: "a".repeat(64) }],
};
const result = { status: "complete", summary: "버튼 여백을 반영했습니다.", limitations: [] };

function git(root, ...args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
}
function put(root, path, value) {
  mkdirSync(dirname(resolve(root, path)), { recursive: true });
  writeFileSync(
    resolve(root, path),
    typeof value === "string" || Buffer.isBuffer(value) ? value : JSON.stringify(value),
  );
}
function fixture() {
  const root = mkdtempSync(resolve(tmpdir(), "figma-proposal-test-"));
  roots.push(root);
  git(root, "init", "-q");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.invalid");
  put(root, ".gitignore", "test-results/\n");
  put(root, "ds/ui/src/Button.tsx", 'export const size = "small";\n');
  git(root, "add", ".");
  git(root, "commit", "-qm", "Initial");
  return {
    root,
    env: {
      FIGMA_BASE_SHA: git(root, "rev-parse", "HEAD").trim(),
      GITHUB_REPOSITORY: "fleetia/comet",
      GH_TOKEN: "test-token",
    },
  };
}
function prepare(root, baselineOnly = false) {
  const entry = {
    ...snapshot.entries[0],
    url: `https://www.figma.com/design/${FILE_KEY}?node-id=1-1`,
  };
  put(root, "test-results/figma-sync/next-baseline.json", snapshot);
  put(root, "test-results/figma-sync/changes.json", {
    schemaVersion: 1,
    fileKey: FILE_KEY,
    baselineOnly,
    baselineInitialization: baselineOnly,
    sourceVersion: "version1",
    sourceLastModified: null,
    coverage: {
      components: "resolved-values-and-bindings",
      variables: "not-fetched-professional-plan",
    },
    added: [],
    changed: baselineOnly ? [] : [entry],
    removed: [],
    nodes: baselineOnly
      ? []
      : [{ id: "1:1", kind: "ui", path: "test-results/figma-sync/nodes/1-1.json" }],
    imageUrls: [],
    imageFiles: [],
    renderFailures: baselineOnly ? [] : [{ id: "1:1", reason: "No render" }],
  });
  put(root, "test-results/figma-proposal/result.json", result);
}
function pull(overrides = {}) {
  return {
    number: 3,
    state: "open",
    draft: true,
    user: { login: "github-actions[bot]" },
    head: { ref: "codex/figma-sync", sha: "b".repeat(40), repo: { full_name: "fleetia/comet" } },
    ...overrides,
  };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Figma proposal artifact boundary", () => {
  it("bundles edits and new binary files without altering the working index", () => {
    const ctx = fixture();
    put(ctx.root, "test-results/figma-proposal/result.json", result);
    put(ctx.root, "ds/ui/src/Button.tsx", 'export const size = "large";\n');
    git(ctx.root, "add", "ds/ui/src/Button.tsx");
    put(ctx.root, "ds/icon/src/new.svg", Buffer.from([0, 1, 255, 8]));
    const indexBefore = git(ctx.root, "diff", "--cached", "--binary");
    expect(bundle(ctx).paths.sort()).toEqual(["ds/icon/src/new.svg", "ds/ui/src/Button.tsx"]);
    expect(git(ctx.root, "diff", "--cached", "--binary")).toBe(indexBefore);
    const patch = readFileSync(
      resolve(ctx.root, "test-results/figma-proposal/proposal.patch"),
      "utf8",
    );
    expect(patch).toContain("GIT binary patch");
    expect(patch).toContain('export const size = "large";');
  });

  it("rejects forbidden files, nested instructions, and symlinks", () => {
    expect(isAllowedPath("ds/token/styles.css")).toBe(true);
    expect(isAllowedPath("ds/token/other.css")).toBe(false);
    expect(isAllowedPath("ds/token/package.json")).toBe(false);
    for (const path of [
      ".github/workflows/ci.yml",
      "ds/scripts/runner.mjs",
      "apps/comet/src/x.ts",
      "ds/ui/src/../../scripts/x.ts",
      "ds/ui/src/.config.json",
      "ds/ui/src/package.json",
      "ds/ui/src/AGENTS.md",
      "ds/ui/src/x.sh",
      "ds/ui/src/x\n.ts",
    ])
      expect(isAllowedPath(path)).toBe(false);
    const ctx = fixture();
    put(ctx.root, "test-results/figma-proposal/result.json", result);
    put(ctx.root, "ds/ui/src/package.json", "{}");
    expect(() => bundle(ctx)).toThrow("forbidden path");
    rmSync(resolve(ctx.root, "ds/ui/src/package.json"));
    symlinkSync("/tmp", resolve(ctx.root, "ds/ui/src/link.ts"));
    expect(() => bundle(ctx)).toThrow("symlink");
  });

  it("does not execute inherited Git configuration or write new objects to the checkout", () => {
    const ctx = fixture();
    prepare(ctx.root);
    put(ctx.root, "ds/ui/src/Button.tsx", "export const safe = true;\n");
    const marker = resolve(ctx.root, "test-results/config-executed");
    const attacker = resolve(ctx.root, "test-results/attacker.sh");
    writeFileSync(attacker, `#!/bin/sh\n/usr/bin/touch '${marker}'\n`, { mode: 0o755 });
    git(ctx.root, "config", "core.fsmonitor", attacker);
    const objectsBefore = readdirSync(resolve(ctx.root, ".git/objects"), {
      recursive: true,
    }).sort();
    const previous = process.env.GIT_EXTERNAL_DIFF;
    process.env.GIT_EXTERNAL_DIFF = attacker;
    try {
      bundle(ctx);
    } finally {
      if (previous === undefined) delete process.env.GIT_EXTERNAL_DIFF;
      else process.env.GIT_EXTERNAL_DIFF = previous;
    }
    expect(existsSync(marker)).toBe(false);
    expect(readdirSync(resolve(ctx.root, ".git/objects"), { recursive: true }).sort()).toEqual(
      objectsBefore,
    );
  });

  it("rejects artifact directory and patch symlinks without writing their destinations", () => {
    const ctx = fixture();
    prepare(ctx.root);
    const target = resolve(ctx.root, "test-results/do-not-overwrite");
    writeFileSync(target, "original");
    symlinkSync(target, resolve(ctx.root, "test-results/figma-proposal/proposal.patch"));
    expect(() => bundle(ctx)).toThrow("symlink");
    expect(() => apply(ctx)).toThrow("symlink");
    expect(readFileSync(target, "utf8")).toBe("original");
    rmSync(resolve(ctx.root, "test-results/figma-proposal/proposal.patch"));
    renameSync(
      resolve(ctx.root, "test-results/figma-proposal"),
      resolve(ctx.root, "test-results/elsewhere"),
    );
    symlinkSync("elsewhere", resolve(ctx.root, "test-results/figma-proposal"));
    expect(() => bundle(ctx)).toThrow("symlink");
    unlinkSync(resolve(ctx.root, "test-results/figma-proposal"));
    renameSync(
      resolve(ctx.root, "test-results/elsewhere"),
      resolve(ctx.root, "test-results/figma-proposal"),
    );
    renameSync(resolve(ctx.root, "test-results"), resolve(ctx.root, "elsewhere"));
    symlinkSync("elsewhere", resolve(ctx.root, "test-results"));
    expect(() => bundle(ctx)).toThrow("symlink");
    expect(() => apply(ctx)).toThrow();
  });

  it("packages only validated data into a fresh directory outside the model workspace", () => {
    const ctx = fixture();
    prepare(ctx.root);
    mkdirSync(resolve(process.cwd(), "test-results"), { recursive: true });
    const runnerTemp = mkdtempSync(resolve(process.cwd(), "test-results/private-runner-"));
    roots.push(runnerTemp);
    const output = resolve(runnerTemp, "github-output");
    put(ctx.root, "test-results/figma-proposal/proposal.patch", "untrusted existing artifact");
    put(ctx.root, "ds/ui/src/Button.tsx", "export const fresh = true;\n");
    const packaged = bundle({
      ...ctx,
      env: {
        ...ctx.env,
        RUNNER_TEMP: runnerTemp,
        GITHUB_WORKSPACE: ctx.root,
        GITHUB_OUTPUT: output,
      },
    });
    expect(packaged.artifactPath.startsWith(`${runnerTemp}/figma-proposal-`)).toBe(true);
    expect(readFileSync(resolve(packaged.artifactPath, "proposal.patch"), "utf8")).toContain(
      "fresh",
    );
    expect(JSON.parse(readFileSync(resolve(packaged.artifactPath, "result.json"), "utf8"))).toEqual(
      result,
    );
    expect(
      readFileSync(resolve(ctx.root, "test-results/figma-proposal/proposal.patch"), "utf8"),
    ).toBe("untrusted existing artifact");
    expect(readFileSync(output, "utf8")).toBe(`artifact_path=${packaged.artifactPath}\n`);
    expect(() => bundle({ ...ctx, env: { ...ctx.env, RUNNER_TEMP: ctx.root } })).toThrow(
      "model-writable",
    );
    expect(() => bundle({ ...ctx, env: { ...ctx.env, RUNNER_TEMP: "/tmp" } })).toThrow(
      "model-writable",
    );
  });

  it("rejects a changed checkout revision or blocked model result", () => {
    const ctx = fixture();
    put(ctx.root, "test-results/figma-proposal/result.json", { ...result, status: "blocked" });
    expect(() => bundle(ctx)).toThrow("complete");
    expect(() => bundle({ ...ctx, env: { FIGMA_BASE_SHA: "f".repeat(40) } })).toThrow(
      "no longer matches",
    );
    expect(() => validateResult({ ...result, summary: "x".repeat(4001) })).toThrow();
  });

  it("applies a validated patch and copies only the trusted baseline", () => {
    const ctx = fixture();
    prepare(ctx.root);
    put(ctx.root, "ds/ui/src/Button.tsx", "export const size = 48;\n");
    put(ctx.root, "ds/ui/src/New.ts", "export const gap = 8;\n");
    put(ctx.root, "ds/ui/src/Binary.svg", Buffer.from([0, 1, 254]));
    bundle(ctx);
    git(ctx.root, "checkout", "--", "ds/ui/src/Button.tsx");
    rmSync(resolve(ctx.root, "ds/ui/src/New.ts"));
    rmSync(resolve(ctx.root, "ds/ui/src/Binary.svg"));
    expect(apply(ctx)).toEqual({ baselineOnly: false });
    expect(readFileSync(resolve(ctx.root, "ds/ui/src/Button.tsx"), "utf8")).toContain("48");
    expect(readFileSync(resolve(ctx.root, "ds/ui/src/New.ts"), "utf8")).toContain("gap");
    expect(readFileSync(resolve(ctx.root, "ds/ui/src/Binary.svg"))).toEqual(
      Buffer.from([0, 1, 254]),
    );
    expect(JSON.parse(readFileSync(resolve(ctx.root, BASELINE), "utf8"))).toEqual(snapshot);
  });

  it("rejects forged patch paths and symlink modes before applying any file", () => {
    const ctx = fixture();
    prepare(ctx.root);
    put(ctx.root, "ds/ui/src/Button.tsx", "new\n");
    bundle(ctx);
    git(ctx.root, "checkout", "--", "ds/ui/src/Button.tsx");
    const patchPath = resolve(ctx.root, "test-results/figma-proposal/proposal.patch");
    const valid = readFileSync(patchPath, "utf8");
    writeFileSync(patchPath, valid.replaceAll("ds/ui/src/Button.tsx", "apps/comet/src/Button.tsx"));
    expect(() => apply(ctx)).toThrow("forbidden path");
    writeFileSync(
      patchPath,
      "diff --git a/ds/ui/src/link.ts b/ds/ui/src/link.ts\nnew file mode 120000\nindex 0000000..e69de29\n--- /dev/null\n+++ b/ds/ui/src/link.ts\n@@ -0,0 +1 @@\n+/tmp\n\\ No newline at end of file\n",
    );
    expect(() => apply(ctx)).toThrow("symlink");
    expect(existsSync(resolve(ctx.root, "ds/ui/src/link.ts"))).toBe(false);
    expect(readFileSync(resolve(ctx.root, "ds/ui/src/Button.tsx"), "utf8")).toContain("small");
  });

  it("only permits no patch for baseline initialization and rejects arbitrary baseline data", () => {
    const ctx = fixture();
    prepare(ctx.root);
    expect(() => apply(ctx)).toThrow("patch is missing");
    prepare(ctx.root, true);
    expect(apply(ctx)).toEqual({ baselineOnly: true });
    rmSync(resolve(ctx.root, BASELINE));
    put(ctx.root, "test-results/figma-proposal/proposal.patch", "");
    expect(() => apply(ctx)).toThrow("must not include");
    rmSync(resolve(ctx.root, "test-results/figma-proposal/proposal.patch"));
    put(ctx.root, "test-results/figma-sync/next-baseline.json", {
      ...snapshot,
      extra: "untrusted",
    });
    expect(() => apply(ctx)).toThrow("baseline");
  });
});

describe("Figma proposal publication boundary", () => {
  it("refuses human-owned, ready, closed-unmerged, and human-edited branches", () => {
    const head = "b".repeat(40);
    expect(validateExistingProposal([pull()], head, [`${EMAIL}\t${EMAIL}`]).number).toBe(3);
    for (const proposal of [
      pull({ user: { login: "human" } }),
      pull({ draft: false }),
      pull({ state: "closed" }),
    ]) {
      expect(() => validateExistingProposal([proposal], head, [])).toThrow("untouched bot");
    }
    expect(() => validateExistingProposal([pull()], head, [`human@example.com\t${EMAIL}`])).toThrow(
      "human commits",
    );
    expect(() => validateExistingProposal([], head, [])).toThrow();
    expect(
      validateExistingProposal([pull({ state: "closed", merged_at: "today" })], head, []),
    ).toBeNull();
  });

  it("skips a duplicate current snapshot already in an open bot proposal", async () => {
    const ctx = fixture();
    prepare(ctx.root);
    const requests = [];
    const fetchImpl = async (url, options) => {
      requests.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () =>
          url.includes("/pulls?")
            ? [pull()]
            : {
                encoding: "base64",
                size: 500,
                content: Buffer.from(JSON.stringify(snapshot)).toString("base64"),
              },
      };
    };
    expect(await dedupe({ ...ctx, fetchImpl })).toEqual({ changed: false });
    expect(requests[1].url).toContain("ref=" + "b".repeat(40));
    expect(requests.every(({ options }) => options.method === "GET")).toBe(true);
  });

  it("publishes with an absent-branch lease, bounded body, and no token in command arguments", async () => {
    const ctx = fixture();
    prepare(ctx.root, true);
    put(ctx.root, BASELINE, snapshot);
    const commands = [];
    const gitImpl = (_root, args, options = {}) => {
      commands.push({ args, options });
      if (args[0] === "rev-parse") return ctx.env.FIGMA_BASE_SHA;
      if (args[0] === "ls-remote") return `${ctx.env.FIGMA_BASE_SHA}\trefs/heads/main\n`;
      if (args[0] === "ls-files" && args.includes("--others")) return `${BASELINE}\0`;
      if (args[0] === "ls-files" && args.includes("--stage"))
        return `100644 ${"a".repeat(40)} 0\t${BASELINE}\0`;
      if (args[0] === "diff" && args.includes("--cached")) return `${BASELINE}\0`;
      return "";
    };
    const requests = [];
    const fetchImpl = async (url, options) => {
      requests.push({ url, options });
      if (url.includes("/git/ref/")) return { status: 404, ok: false };
      return {
        status: 200,
        ok: true,
        json: async () =>
          url.includes("/pulls?") ? [] : { html_url: "https://github.com/fleetia/comet/pull/9" },
      };
    };
    expect(await publish({ ...ctx, gitImpl, fetchImpl })).toEqual({
      url: "https://github.com/fleetia/comet/pull/9",
    });
    const push = commands.find(({ args }) => args[0] === "push");
    expect(push.args).toContain("--force-with-lease=refs/heads/codex/figma-sync:");
    expect(JSON.stringify(commands.map(({ args }) => args))).not.toContain("test-token");
    const body = JSON.parse(requests.at(-1).options.body);
    expect(body.draft).toBe(true);
    expect(body.body).toContain("Variables REST API");
  });

  it("stops before committing or pushing if main has advanced", async () => {
    const ctx = fixture();
    prepare(ctx.root, true);
    put(ctx.root, BASELINE, snapshot);
    const commands = [];
    const gitImpl = (_root, args) => {
      commands.push(args);
      if (args[0] === "rev-parse") return ctx.env.FIGMA_BASE_SHA;
      if (args[0] === "ls-remote") return `${"c".repeat(40)}\trefs/heads/main`;
      if (args[0] === "ls-files") return `${BASELINE}\0`;
      return "";
    };
    await expect(
      publish({
        ...ctx,
        gitImpl,
        fetchImpl: () => {
          throw new Error("Must not request API");
        },
      }),
    ).rejects.toThrow("main advanced");
    expect(commands.some((args) => args.includes("commit") || args[0] === "push")).toBe(false);
  });

  it("recovers an orphan only when its one bot commit exactly matches the validated candidate", async () => {
    for (const scenario of ["matching", "different-tree", "human-commit"]) {
      const ctx = fixture();
      prepare(ctx.root, true);
      put(ctx.root, BASELINE, snapshot);
      const head = "b".repeat(40);
      const tree = "d".repeat(40);
      const commands = [];
      const gitImpl = (_root, args) => {
        commands.push(args);
        if (args[0] === "rev-parse")
          return args[1] === "HEAD"
            ? ctx.env.FIGMA_BASE_SHA
            : args[1].includes("^{tree}")
              ? tree
              : head;
        if (args[0] === "ls-remote") return `${ctx.env.FIGMA_BASE_SHA}\trefs/heads/main`;
        if (args[0] === "merge-base" || args[0] === "show") return ctx.env.FIGMA_BASE_SHA;
        if (args[0] === "write-tree") return scenario === "different-tree" ? "e".repeat(40) : tree;
        if (args[0] === "log")
          return scenario === "human-commit" ? `human@example.com\t${EMAIL}` : `${EMAIL}\t${EMAIL}`;
        if (args[0] === "ls-tree") return `100644 blob ${"a".repeat(40)}\t${BASELINE}\0`;
        if (args[0] === "ls-files")
          return args.includes("--stage")
            ? `100644 ${"a".repeat(40)} 0\t${BASELINE}\0`
            : `${BASELINE}\0`;
        if (args[0] === "diff")
          return args.includes("--cached") || args.includes("refs/figma/proposal")
            ? `${BASELINE}\0`
            : "";
        return "";
      };
      const fetchImpl = async (url) => ({
        status: 200,
        ok: true,
        json: async () =>
          url.includes("/git/ref/")
            ? { object: { sha: head } }
            : url.includes("/pulls?")
              ? []
              : { html_url: "https://github.com/fleetia/comet/pull/10" },
      });
      if (scenario === "matching") {
        expect(await publish({ ...ctx, gitImpl, fetchImpl })).toEqual({
          url: "https://github.com/fleetia/comet/pull/10",
        });
        expect(commands.find((args) => args[0] === "push")).toContain(
          `--force-with-lease=refs/heads/codex/figma-sync:${head}`,
        );
      } else {
        await expect(publish({ ...ctx, gitImpl, fetchImpl })).rejects.toThrow(
          scenario === "human-commit" ? "human commits" : "untouched bot",
        );
        expect(commands.some((args) => args.includes("commit") || args[0] === "push")).toBe(false);
      }
    }
  });
});
