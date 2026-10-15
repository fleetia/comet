// @vitest-environment node
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { arePathsDsOnly, getComparison, isDsOnlyChange } from "./ci-scope.mjs";

const repositories = [];

afterEach(() => {
  for (const directory of repositories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function createRepository() {
  const cwd = mkdtempSync(join(tmpdir(), "comet-ci-scope-"));
  repositories.push(cwd);
  function git(...args) {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  }
  function write(path, value = path) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), value);
  }
  function commit() {
    git("add", "--all");
    git("commit", "--quiet", "-m", "fixture");
    return git("rev-parse", "HEAD");
  }
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.name", "CI scope test");
  git("config", "user.email", "ci-scope@example.invalid");
  git("config", "commit.gpgsign", "false");
  write("apps/comet/app.ts");
  write("ds/ui/button.ts");
  const base = commit();
  return { cwd, git, write, commit, base };
}

describe("CI change scope", () => {
  it("allows only a nonempty set of design system paths", () => {
    expect(arePathsDsOnly(["ds/ui/button.ts", "ds/token/values.json", "vitest.ds.config.ts"])).toBe(
      true,
    );
    for (const paths of [
      [],
      ["ds/ui/button.ts", "apps/comet/app.ts"],
      ["ds/ui/button.ts", "pnpm-lock.yaml"],
      ["ds/ui/button.ts", ".github/workflows/verify.yml"],
      ["ds-other/file.ts"],
      ["README.md"],
    ]) {
      expect(arePathsDsOnly(paths)).toBe(false);
    }
  });

  it("classifies real Git diffs and keeps both sides of a rename", () => {
    const repo = createRepository();
    repo.write("ds/ui/button.ts", "updated");
    const dsHead = repo.commit();
    expect(isDsOnlyChange("push", { before: repo.base, after: dsHead }, repo.cwd)).toBe(true);

    renameSync(join(repo.cwd, "apps/comet/app.ts"), join(repo.cwd, "ds/ui/app.ts"));
    const renamedHead = repo.commit();
    expect(isDsOnlyChange("push", { before: dsHead, after: renamedHead }, repo.cwd)).toBe(false);
  });

  it("uses the PR merge base so unrelated base branch edits do not change its scope", () => {
    const repo = createRepository();
    repo.git("checkout", "--quiet", "-b", "design-change");
    repo.write("ds/ui/button.ts", "updated");
    const head = repo.commit();
    repo.git("checkout", "--quiet", "main");
    repo.write("apps/comet/app.ts", "unrelated main change");
    const base = repo.commit();
    expect(
      isDsOnlyChange(
        "pull_request",
        { pull_request: { base: { sha: base }, head: { sha: head } } },
        repo.cwd,
      ),
    ).toBe(true);
  });

  it("fails closed for manual runs, malformed events, unavailable commits and empty diffs", () => {
    const repo = createRepository();
    const event = { before: repo.base, after: repo.base };
    expect(isDsOnlyChange("workflow_dispatch", event, repo.cwd)).toBe(false);
    expect(isDsOnlyChange("push", event, repo.cwd)).toBe(false);
    expect(isDsOnlyChange("push", { ...event, after: "f".repeat(40) }, repo.cwd)).toBe(false);
    expect(isDsOnlyChange("push", { ...event, before: "0".repeat(40) }, repo.cwd)).toBe(false);
    expect(getComparison("pull_request", {})).toBeNull();
    expect(getComparison("push", { ...event, before: "--output=unexpected" })).toBeNull();
  });
});
