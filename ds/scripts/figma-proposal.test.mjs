// @vitest-environment node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  propertyChanges,
  publish,
  reportBody,
  validateExistingProposal,
} from "./figma-proposal.mjs";
import { FILE_KEY, stableStringify } from "./figma-rest.mjs";

const roots = [];
const EMAIL = "41898282+github-actions[bot]@users.noreply.github.com";
const BASELINE = "ds/automation/figma-baseline.json";
const NEXT = "test-results/figma-sync/next-baseline.json";
const BRANCH = "codex/figma-sync";
const REMOTE = "https://github.com/fleetia/comet.git";
const BOT_ENV = {
  GIT_AUTHOR_NAME: "github-actions[bot]",
  GIT_AUTHOR_EMAIL: EMAIL,
  GIT_COMMITTER_NAME: "github-actions[bot]",
  GIT_COMMITTER_EMAIL: EMAIL,
};

function snapshot(padding = 4, id = "1:1", name = "Button") {
  const context = {
    node: { id, type: "COMPONENT", name, paddingLeft: padding, children: [] },
    components: {},
    componentSets: {},
    styles: {},
  };
  return {
    schemaVersion: 2,
    fileKey: FILE_KEY,
    entries: [
      {
        id,
        kind: "ui",
        context,
        hash: createHash("sha256").update(stableStringify(context)).digest("hex"),
      },
    ],
  };
}

function git(root, args, options = {}) {
  return execFileSync("/usr/bin/git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    ...options,
    env: { ...process.env, ...options.env },
  });
}

function put(root, path, value) {
  mkdirSync(dirname(resolve(root, path)), { recursive: true });
  writeFileSync(resolve(root, path), typeof value === "string" ? value : JSON.stringify(value));
}

function fixture(baseline = null) {
  const directory = mkdtempSync(resolve(tmpdir(), "figma-report-test-"));
  roots.push(directory);
  const root = resolve(directory, "checkout");
  const remote = resolve(directory, "remote.git");
  mkdirSync(root);
  git(root, ["init", "-q", "--initial-branch=main"]);
  git(root, ["config", "user.name", "Test"]);
  git(root, ["config", "user.email", "test@example.invalid"]);
  put(root, ".gitignore", "test-results/\n");
  put(root, "ds/ui/src/Button.tsx", 'export const size = "small";\n');
  if (baseline) put(root, BASELINE, baseline);
  git(root, ["add", "."]);
  git(root, ["commit", "-qm", "Initial"]);
  git(root, ["clone", "--bare", "-q", root, remote]);
  const commands = [];
  const ctx = {
    root,
    remote,
    commands,
    env: {
      FIGMA_BASE_SHA: git(root, ["rev-parse", "HEAD"]).trim(),
      GITHUB_REPOSITORY: "fleetia/comet",
      GH_TOKEN: "test-token",
    },
    gitImpl: (_root, args, options = {}) => {
      commands.push({ args, options });
      return git(
        root,
        args.map((arg) => (arg === REMOTE ? remote : arg)),
        options,
      );
    },
  };
  ctx.seedReport = (next, human = false) => {
    git(root, ["checkout", "-qb", BRANCH]);
    put(root, BASELINE, next);
    git(root, ["add", BASELINE]);
    git(root, ["commit", "-qm", "Figma report"], { env: human ? {} : BOT_ENV });
    git(root, ["push", "-q", remote, BRANCH]);
    const head = git(root, ["rev-parse", "HEAD"]).trim();
    git(root, ["checkout", "-q", "main"]);
    return head;
  };
  return ctx;
}

function remoteHead(ctx) {
  try {
    return git(ctx.remote, ["rev-parse", `refs/heads/${BRANCH}`]).trim();
  } catch {
    return "";
  }
}

function pull(head, body, overrides = {}) {
  return {
    number: 3,
    state: "open",
    draft: true,
    title: "chore: Figma 컴포넌트 변경 보고",
    body,
    user: { login: "github-actions[bot]" },
    head: { ref: BRANCH, sha: head, repo: { full_name: "fleetia/comet" } },
    base: { ref: "main", repo: { full_name: "fleetia/comet" } },
    html_url: "https://github.com/fleetia/comet/pull/3",
    ...overrides,
  };
}

function github(ctx, initial = [], { failCreate = false, failUpdate = false } = {}) {
  const pulls = structuredClone(initial);
  const requests = [];
  const refresh = (item) =>
    item.state === "open" ? { ...item, head: { ...item.head, sha: remoteHead(ctx) } } : item;
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    const pathname = new URL(url).pathname;
    const response = (value, status = 200) => ({
      status,
      ok: status >= 200 && status < 300,
      json: async () => structuredClone(value),
    });
    if (pathname.includes("/git/ref/")) {
      const head = remoteHead(ctx);
      return head ? response({ object: { sha: head } }) : response(null, 404);
    }
    if (url.includes("/pulls?")) return response(pulls.map(refresh));
    if (pathname.endsWith("/pulls") && options.method === "POST") {
      if (failCreate) {
        failCreate = false;
        return response(null, 503);
      }
      const body = JSON.parse(options.body);
      const number = pulls.length + 3;
      const item = pull(remoteHead(ctx), body.body, {
        number,
        title: body.title,
        html_url: `https://github.com/fleetia/comet/pull/${number}`,
      });
      pulls.unshift(item);
      return response(item);
    }
    const number = Number(pathname.split("/").at(-1));
    const index = pulls.findIndex((item) => item.number === number);
    if (index < 0) throw new Error(`Unexpected request ${url}`);
    pulls[index] = refresh(pulls[index]);
    if (options.method === "PATCH") {
      if (failUpdate) {
        failUpdate = false;
        return response(null, 503);
      }
      Object.assign(pulls[index], JSON.parse(options.body));
    }
    return response(pulls[index]);
  };
  return { pulls, requests, fetchImpl };
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Figma change reporting", () => {
  it("treats prototype-like property names as data when added or removed", () => {
    const before = { componentPropertyDefinitions: JSON.parse('{"toString":"old","__proto__":2}') };
    const after = { componentPropertyDefinitions: { constructor: "new" } };
    expect(propertyChanges(before, after).changes).toEqual([
      { path: "componentPropertyDefinitions.__proto__", before: 2, after: undefined },
      { path: "componentPropertyDefinitions.constructor", before: undefined, after: "new" },
      { path: "componentPropertyDefinitions.toString", before: "old", after: undefined },
    ]);
  });
  it("compares children by ID and reports real order changes without index noise", () => {
    const before = {
      children: [
        { id: "1:2", padding: 4 },
        { id: "1:3", padding: 8 },
      ],
    };
    const after = {
      children: [
        { id: "1:4", padding: 0 },
        { id: "1:2", padding: 6 },
        { id: "1:3", padding: 8 },
      ],
    };
    expect(propertyChanges(before, after).changes).toEqual([
      { path: "children[id=1:2].padding", before: 4, after: 6 },
      { path: "children[id=1:4]", before: undefined, after: { id: "1:4", padding: 0 } },
    ]);
    expect(propertyChanges(before, { children: [...before.children].reverse() }).changes).toEqual([
      { path: "children.순서", before: ["1:2", "1:3"], after: ["1:3", "1:2"] },
    ]);
  });

  it("reports before/after values and escapes Figma links, tables, HTML, and mentions", () => {
    const body = reportBody(
      snapshot(),
      snapshot(12, "1:1", "[click](https://evil.invalid) | @codex <img>\n#9"),
      "a".repeat(40),
      "b".repeat(40),
    );
    expect(body).toContain("node\\.paddingLeft | 4 | 12");
    expect(body).toContain(`https://www.figma.com/design/${FILE_KEY}?node-id=1-1`);
    expect(body).toContain("@\u200bcodex");
    expect(body).not.toContain("@codex");
    expect(body).not.toContain("<img>");
    expect(body).not.toContain("[click](https://evil.invalid)");
    expect(body).toContain("비교의 기준만 갱신");
    expect(body).toContain("추가 0개 · 변경 1개 · 삭제 0개");
    expect(reportBody(null, snapshot(), "a".repeat(40), "b".repeat(40))).toContain(
      "최초 기준 스냅샷",
    );
    expect(reportBody(null, snapshot(), "a".repeat(40), "b".repeat(40))).not.toContain("추가 1개");
  });

  it("bounds large reports and links to the complete snapshot diff", () => {
    const baseline = { schemaVersion: 2, fileKey: FILE_KEY, entries: [] };
    const next = {
      ...baseline,
      entries: Array.from(
        { length: 500 },
        (_, i) => snapshot(4, `1:${i + 1}`, "이름".repeat(180)).entries[0],
      ),
    };
    const body = reportBody(baseline, next, "a".repeat(40), "b".repeat(40));
    expect(Buffer.byteLength(body)).toBeLessThan(50_000);
    expect(body).toContain("일부 컴포넌트를 생략");
    expect(body).toContain("전체 JSON 차이");
    expect(propertyChanges({ a: 1, b: 2 }, { a: 2, b: 3 }, 1).truncated).toBe(true);
  });
});

describe("Figma report publication", () => {
  it("creates only a baseline commit and preserves dirty work, the index, and local HEAD", async () => {
    const ctx = fixture();
    put(ctx.root, NEXT, snapshot());
    put(ctx.root, "ds/ui/src/Button.tsx", "unrelated staged edit\n");
    git(ctx.root, ["add", "ds/ui/src/Button.tsx"]);
    put(ctx.root, "untracked.txt", "unrelated file");
    const index = git(ctx.root, ["diff", "--cached"]);
    const api = github(ctx);
    expect(await publish({ ...ctx, fetchImpl: api.fetchImpl })).toEqual({
      status: "created",
      url: "https://github.com/fleetia/comet/pull/3",
    });
    const head = remoteHead(ctx);
    expect(git(ctx.remote, ["diff", "--name-only", ctx.env.FIGMA_BASE_SHA, head]).trim()).toBe(
      BASELINE,
    );
    expect(JSON.parse(git(ctx.remote, ["show", `${head}:${BASELINE}`]))).toEqual(snapshot());
    expect(git(ctx.root, ["rev-parse", "HEAD"]).trim()).toBe(ctx.env.FIGMA_BASE_SHA);
    expect(git(ctx.root, ["diff", "--cached"])).toBe(index);
    expect(readFileSync(resolve(ctx.root, "untracked.txt"), "utf8")).toBe("unrelated file");
    expect(api.pulls[0].draft).toBe(true);
    expect(api.pulls[0].body).toContain("최초 기준 스냅샷");
    const push = ctx.commands.find(({ args }) => args[0] === "push");
    expect(push.args).toContain(`--force-with-lease=refs/heads/${BRANCH}:`);
    expect(JSON.stringify(ctx.commands.map(({ args }) => args))).not.toContain("test-token");
  });

  it("does nothing when the current snapshot is already merged", async () => {
    const ctx = fixture(snapshot());
    put(ctx.root, NEXT, snapshot());
    const api = github(ctx);
    expect(await publish({ ...ctx, fetchImpl: api.fetchImpl })).toEqual({ status: "unchanged" });
    expect(api.requests.every(({ options }) => options.method === "GET")).toBe(true);
    expect(ctx.commands.some(({ args }) => args[0] === "push")).toBe(false);
  });

  it("skips identical pending snapshots and updates one draft while preserving manual notes", async () => {
    const baseline = snapshot();
    const pending = snapshot(8);
    const ctx = fixture(baseline);
    const head = ctx.seedReport(pending);
    const api = github(ctx, [
      pull(
        head,
        `My note before\n${reportBody(baseline, pending, ctx.env.FIGMA_BASE_SHA, head)}\nMy note after`,
      ),
    ]);
    put(ctx.root, NEXT, pending);
    expect((await publish({ ...ctx, fetchImpl: api.fetchImpl })).status).toBe("unchanged");
    expect(api.requests.every(({ options }) => options.method === "GET")).toBe(true);
    expect(remoteHead(ctx)).toBe(head);
    put(ctx.root, NEXT, snapshot(12));
    expect((await publish({ ...ctx, fetchImpl: api.fetchImpl })).status).toBe("updated");
    expect(api.pulls).toHaveLength(1);
    expect(api.pulls[0].body).toMatch(/^My note before\n/);
    expect(api.pulls[0].body).toMatch(/\nMy note after$/);
    expect(api.pulls[0].body).toContain("node\\.paddingLeft | 4 | 12");
    expect(ctx.commands.filter(({ args }) => args[0] === "push").at(-1).args).toContain(
      `--force-with-lease=refs/heads/${BRANCH}:${head}`,
    );
  });

  it("closes a stale bot draft after a Figma reversion and allows a later new report", async () => {
    const baseline = snapshot();
    const pending = snapshot(8);
    const ctx = fixture(baseline);
    const head = ctx.seedReport(pending);
    const api = github(ctx, [
      pull(head, `${reportBody(baseline, pending, ctx.env.FIGMA_BASE_SHA, head)}\nManual note`),
    ]);
    put(ctx.root, NEXT, baseline);
    expect((await publish({ ...ctx, fetchImpl: api.fetchImpl })).status).toBe("closed");
    expect(api.pulls[0].state).toBe("closed");
    expect(api.pulls[0].body).toContain("figma-report:closed-after-revert");
    expect(api.pulls[0].body).toMatch(/\nManual note$/);
    expect(remoteHead(ctx)).toBe(head);
    put(ctx.root, NEXT, snapshot(12));
    expect((await publish({ ...ctx, fetchImpl: api.fetchImpl })).status).toBe("created");
    expect(api.pulls).toHaveLength(2);
    expect(api.pulls[0].state).toBe("open");
    expect(api.pulls[1].state).toBe("closed");
    expect(api.pulls[1].body).toContain(`/blob/${head}/${BASELINE}`);
    expect(api.pulls[1].body).toContain(`/compare/${ctx.env.FIGMA_BASE_SHA}...${head}`);
    expect(api.pulls[0].body).toContain(`/blob/${remoteHead(ctx)}/${BASELINE}`);
    expect(api.pulls[1].body).not.toContain(`/blob/${remoteHead(ctx)}/${BASELINE}`);
  });

  it("repairs a stale report body after a successful push without another push", async () => {
    const baseline = snapshot();
    const pending = snapshot(8);
    const ctx = fixture(baseline);
    const head = ctx.seedReport(pending);
    const api = github(
      ctx,
      [pull(head, reportBody(baseline, pending, ctx.env.FIGMA_BASE_SHA, head))],
      {
        failUpdate: true,
      },
    );
    put(ctx.root, NEXT, snapshot(12));
    await expect(publish({ ...ctx, fetchImpl: api.fetchImpl })).rejects.toThrow("HTTP 503");
    const pushedHead = remoteHead(ctx);
    expect(pushedHead).not.toBe(head);
    expect(api.pulls[0].body).toContain("node\\.paddingLeft | 4 | 8");
    const pushes = ctx.commands.filter(({ args }) => args[0] === "push").length;
    expect((await publish({ ...ctx, fetchImpl: api.fetchImpl })).status).toBe("updated");
    expect(remoteHead(ctx)).toBe(pushedHead);
    expect(ctx.commands.filter(({ args }) => args[0] === "push")).toHaveLength(pushes);
    expect(api.pulls[0].body).toContain("node\\.paddingLeft | 4 | 12");
  });

  it("rebases an identical pending snapshot when main advances", async () => {
    const baseline = snapshot();
    const pending = snapshot(8);
    const ctx = fixture(baseline);
    const head = ctx.seedReport(pending);
    const api = github(ctx, [
      pull(head, reportBody(baseline, pending, ctx.env.FIGMA_BASE_SHA, head)),
    ]);
    git(ctx.root, ["commit", "--allow-empty", "-qm", "Advance main"]);
    git(ctx.root, ["push", "-q", ctx.remote, "main"]);
    ctx.env.FIGMA_BASE_SHA = git(ctx.root, ["rev-parse", "HEAD"]).trim();
    put(ctx.root, NEXT, pending);
    expect((await publish({ ...ctx, fetchImpl: api.fetchImpl })).status).toBe("updated");
    expect(git(ctx.remote, ["show", "--no-patch", "--format=%P", remoteHead(ctx)]).trim()).toBe(
      ctx.env.FIGMA_BASE_SHA,
    );
    expect(api.pulls[0].body).toContain(`/compare/${ctx.env.FIGMA_BASE_SHA}...`);
  });

  it("preserves manual notes added while the report branch is being pushed", async () => {
    const baseline = snapshot();
    const pending = snapshot(8);
    const ctx = fixture(baseline);
    const head = ctx.seedReport(pending);
    const api = github(ctx, [
      pull(head, reportBody(baseline, pending, ctx.env.FIGMA_BASE_SHA, head)),
    ]);
    put(ctx.root, NEXT, snapshot(12));
    const gitImpl = (root, args, options) => {
      const output = ctx.gitImpl(root, args, options);
      if (args[0] === "push") api.pulls[0].body += "\nNew manual note";
      return output;
    };
    expect((await publish({ ...ctx, gitImpl, fetchImpl: api.fetchImpl })).status).toBe("updated");
    expect(api.pulls[0].body).toMatch(/\nNew manual note$/);
  });

  it("protects human commits and rejects non-baseline files on the report branch", async () => {
    for (const extraFile of [false, true]) {
      const ctx = fixture(snapshot());
      const head = ctx.seedReport(snapshot(8), !extraFile);
      if (extraFile) {
        git(ctx.root, ["checkout", "-q", BRANCH]);
        put(ctx.root, "ds/ui/src/Button.tsx", "unexpected bot edit\n");
        git(ctx.root, ["add", "."]);
        git(ctx.root, ["commit", "-qm", "Unexpected code"], { env: BOT_ENV });
        git(ctx.root, ["push", "-q", ctx.remote, BRANCH]);
        git(ctx.root, ["checkout", "-q", "main"]);
      }
      put(ctx.root, NEXT, snapshot(12));
      const api = github(ctx, [
        pull(head, reportBody(snapshot(), snapshot(8), ctx.env.FIGMA_BASE_SHA, head)),
      ]);
      await expect(publish({ ...ctx, fetchImpl: api.fetchImpl })).rejects.toThrow(
        extraFile ? "other than the Figma baseline" : "human commits",
      );
      expect(api.requests.every(({ options }) => options.method === "GET")).toBe(true);
    }
  });

  it("protects ready, manually closed, non-bot, and marker-removed reports", () => {
    const head = "b".repeat(40);
    const body = reportBody(snapshot(), snapshot(8), "a".repeat(40), head);
    for (const overrides of [
      { draft: false },
      { user: { login: "person" } },
      { state: "closed" },
      { body: "Manual replacement" },
      { base: { ref: "another-branch", repo: { full_name: "fleetia/comet" } } },
    ])
      expect(() =>
        validateExistingProposal([pull(head, body, overrides)], head, [`${EMAIL}\t${EMAIL}`]),
      ).toThrow();
    expect(() => validateExistingProposal([pull(head, body, { state: "closed" })], "", [])).toThrow(
      "closed without merging",
    );
  });

  it("recovers a successfully pushed orphan after PR creation fails", async () => {
    const ctx = fixture(snapshot());
    put(ctx.root, NEXT, snapshot(8));
    const api = github(ctx, [], { failCreate: true });
    await expect(publish({ ...ctx, fetchImpl: api.fetchImpl })).rejects.toThrow("HTTP 503");
    const orphan = remoteHead(ctx);
    expect(orphan).toMatch(/^[a-f0-9]{40}$/);
    expect((await publish({ ...ctx, fetchImpl: api.fetchImpl })).status).toBe("created");
    expect(api.pulls).toHaveLength(1);
    expect(ctx.commands.filter(({ args }) => args[0] === "push").at(-1).args).toContain(
      `--force-with-lease=refs/heads/${BRANCH}:${orphan}`,
    );
  });

  it("refuses a different orphan snapshot and stops if main advanced", async () => {
    const ctx = fixture(snapshot());
    put(ctx.root, NEXT, snapshot(8));
    const api = github(ctx, [], { failCreate: true });
    await expect(publish({ ...ctx, fetchImpl: api.fetchImpl })).rejects.toThrow("HTTP 503");
    put(ctx.root, NEXT, snapshot(12));
    await expect(publish({ ...ctx, fetchImpl: api.fetchImpl })).rejects.toThrow("untouched bot");
    git(ctx.root, ["commit", "--allow-empty", "-qm", "Advance main"]);
    git(ctx.root, ["push", "-q", ctx.remote, "main"]);
    git(ctx.root, ["checkout", "-q", "--detach", ctx.env.FIGMA_BASE_SHA]);
    await expect(publish({ ...ctx, fetchImpl: api.fetchImpl })).rejects.toThrow("main advanced");
  });

  it("rejects invalid snapshot hashes and symlink artifacts before contacting GitHub", async () => {
    const ctx = fixture();
    const invalid = snapshot();
    invalid.entries[0].context.node.paddingLeft = 999;
    put(ctx.root, NEXT, invalid);
    const api = github(ctx);
    await expect(publish({ ...ctx, fetchImpl: api.fetchImpl })).rejects.toThrow("context or hash");
    rmSync(resolve(ctx.root, NEXT));
    put(ctx.root, "test-results/actual.json", snapshot());
    symlinkSync(resolve(ctx.root, "test-results/actual.json"), resolve(ctx.root, NEXT));
    await expect(publish({ ...ctx, fetchImpl: api.fetchImpl })).rejects.toThrow("symlink");
    expect(api.requests).toHaveLength(0);
  });
});
